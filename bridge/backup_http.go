package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const backupEndpoint = "/__webui/api/backup/"
const backupHistoryDir = ".backups"

func autoBackupNames(root string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(root, backupHistoryDir))
	names := []string{}
	if errors.Is(err, os.ErrNotExist) {
		return names, nil
	}
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasPrefix(e.Name(), "profile-") && strings.HasSuffix(e.Name(), ".zip") {
			names = append(names, e.Name())
		}
	}
	slices.Sort(names)
	slices.Reverse(names)
	return names, nil
}

func autoBackupEnabled(root string) (bool, error) {
	_, err := os.Stat(filepath.Join(root, backupHistoryDir, "enabled"))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// Called under the file mutation lock before the new profile list is installed.
func snapshotBeforeProfileChange(root string, next []byte) error {
	enabled, err := autoBackupEnabled(root)
	if err != nil || !enabled {
		return err
	}
	type resource struct {
		ID string `yaml:"id"`
	}
	var oldIDs, newIDs []resource
	previous, err := os.ReadFile(filepath.Join(root, "profiles.yaml"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err = yaml.Unmarshal(previous, &oldIDs); err != nil {
		return err
	}
	if err = yaml.Unmarshal(next, &newIDs); err != nil {
		return err
	}
	ids := map[string]bool{}
	for _, o := range oldIDs {
		ids[o.ID] = true
	}
	for _, o := range newIDs {
		if ids[o.ID] {
			delete(ids, o.ID)
		} else {
			ids[o.ID] = true
		}
	}
	if len(ids) == 0 {
		return nil
	}
	dir := filepath.Join(root, backupHistoryDir)
	tmp, err := os.CreateTemp(dir, ".new-")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	err = writeBackup(root, tmp)
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	name := "profile-" + time.Now().UTC().Format("20060102T150405.000000000Z") + ".zip"
	if err = os.Rename(tmp.Name(), filepath.Join(dir, name)); err != nil {
		return err
	}
	names, err := autoBackupNames(root)
	if err != nil {
		return err
	}
	for i := backupRetention; i < len(names); i++ {
		if err = os.Remove(filepath.Join(dir, names[i])); err != nil {
			return err
		}
	}
	return nil
}

type webDAVBackupTarget struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func (d webDAVBackupTarget) transfer(ctx context.Context, method string, file *os.File) error {
	u, err := url.Parse(d.URL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Fragment != "" {
		return errors.New("enter a complete HTTP(S) WebDAV file URL")
	}
	var body io.Reader
	if method == http.MethodPut {
		body = file
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return errors.New("invalid WebDAV request")
	}
	if d.Username != "" || d.Password != "" {
		req.SetBasicAuth(d.Username, d.Password)
	}
	if method == http.MethodPut {
		stat, err := file.Stat()
		if err != nil {
			return err
		}
		req.ContentLength = stat.Size()
		req.Header.Set("Content-Type", "application/zip")
	}
	client := http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		// A signed URL may contain credentials in its query string.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			return fmt.Errorf("WebDAV: %w", urlErr.Err)
		}
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("WebDAV HTTP %d", resp.StatusCode)
	}
	if method == http.MethodGet {
		n, err := io.Copy(file, io.LimitReader(resp.Body, backupUploadLimit+1))
		if err != nil {
			return err
		}
		if n > backupUploadLimit {
			return errors.New("WebDAV file exceeds backup limit")
		}
	}
	return nil
}

// ZIP with incompressible entries can be slightly larger than its contents.
const backupUploadLimit = backupMaxBytes + (8 << 20)

func sendBackup(w http.ResponseWriter, file, name string) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	_, err = io.Copy(w, f)
	return err
}

func (a *App) handleBackup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if err := a.backupRequest(w, r); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
	}
}

func (a *App) backupRequest(w http.ResponseWriter, r *http.Request) error {
	root := resolvePath("data")
	action := strings.TrimPrefix(r.URL.Path, backupEndpoint)
	if action == "history" && r.Method == http.MethodGet {
		names, err := autoBackupNames(root)
		if err != nil {
			return err
		}
		enabled, err := autoBackupEnabled(root)
		if err != nil {
			return err
		}
		writeHeadlessJSON(w, map[string]any{"enabled": enabled, "files": names})
		return nil
	}
	if action == "history" && r.Method == http.MethodPut {
		var config struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&config); err != nil {
			return err
		}
		if config.Enabled == nil {
			return errors.New("expected enabled flag")
		}
		dataMutationMu.Lock()
		defer dataMutationMu.Unlock()
		dir := filepath.Join(root, backupHistoryDir)
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		path := filepath.Join(dir, "enabled")
		if *config.Enabled {
			return atomicWriteFile(path, []byte("1"), 0600)
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if action == "snapshot" && r.Method == http.MethodGet {
		name := r.URL.Query().Get("name")
		names, err := autoBackupNames(root)
		if err != nil {
			return err
		}
		if !slices.Contains(names, name) {
			return errors.New("snapshot unavailable")
		}
		return sendBackup(w, filepath.Join(root, backupHistoryDir, name), name)
	}
	if r.Method != http.MethodPost || !slices.Contains([]string{"export", "preview", "restore", "webdav-upload", "webdav-download"}, action) {
		http.Error(w, "unknown backup action or method", http.StatusMethodNotAllowed)
		return nil
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	work, err := os.MkdirTemp(root, ".backup-work-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	archive := filepath.Join(work, "config.zip")
	f, err := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if action == "export" || action == "webdav-upload" {
		if err := snapshotPortableData(root, f); err != nil {
			return err
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return err
		}
	}
	switch action {
	case "export":
		return sendBackup(w, archive, "gui-for-singbox.zip")
	case "webdav-upload", "webdav-download":
		var target webDAVBackupTarget
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&target); err != nil {
			return err
		}
		if action == "webdav-upload" {
			return target.transfer(r.Context(), http.MethodPut, f)
		}
		if err := target.transfer(r.Context(), http.MethodGet, f); err != nil {
			return err
		}
		return sendBackup(w, archive, "webdav-backup.zip")
	case "preview", "restore":
		if _, err := io.Copy(f, http.MaxBytesReader(w, r.Body, backupUploadLimit)); err != nil {
			return err
		}
		stage := filepath.Join(work, "stage")
		if err := os.Mkdir(stage, 0700); err != nil {
			return err
		}
		preview, err := stageBackup(archive, stage)
		if err != nil {
			return err
		}
		if action == "restore" {
			if err := a.restorePortableData(root, stage); err != nil {
				return err
			}
		}
		writeHeadlessJSON(w, preview)
	}
	return nil
}

func snapshotPortableData(root string, out io.Writer) error {
	backupRPCMu.Lock()
	defer backupRPCMu.Unlock()
	dataMutationMu.Lock()
	defer dataMutationMu.Unlock()
	return writeBackup(root, out)
}

func (a *App) restorePortableData(root, stage string) error {
	backupRPCMu.Lock()
	defer backupRPCMu.Unlock()
	worker := a.taskWorker()
	// Drain already scheduled runs before installing a different set of tasks.
	worker.reloadMu.Lock()
	worker.mu.Lock()
	scheduler := worker.scheduler
	worker.scheduler = nil
	worker.managedTaskIDs = nil
	worker.mu.Unlock()
	worker.reloadMu.Unlock()
	if scheduler != nil {
		<-scheduler.Stop().Done()
	}
	dataMutationMu.Lock()
	a.StopScheduledTaskWorker()
	defer dataMutationMu.Unlock()
	if err := installBackup(root, stage, a.StartScheduledTaskWorker); err != nil {
		// The install rolled files back. Reinitialize the previous scheduler
		// before admitting any new RPCs or scheduled mutations.
		a.StopScheduledTaskWorker()
		return errors.Join(err, a.StartScheduledTaskWorker())
	}
	loadConfig()
	a.EventsEmit("configurationRestored")
	return nil
}
