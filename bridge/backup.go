package bridge

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Only portable GUI data is replaced. The destination keeps its token, core,
// running configuration, logs, cache, and snapshot history.
var backupFiles = []string{"user.yaml", "profiles.yaml", "subscribes.yaml", "node-groups.yaml", "rulesets.yaml", "scheduledtasks.yaml", "plugins.yaml"}
var backupDirs = []string{"subscribes", "rulesets", "plugins", "local", "locales"}
var backupRPCMu sync.RWMutex

const (
	backupFormat             = "gui-for-singbox/v1"
	backupMaxBytes     int64 = 256 << 20
	backupMaxFiles           = 8192
	backupRetention          = 5
	backupManifestName       = "manifest.json"
)

type backupEntry struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	Hash string `json:"sha256"`
}

type backupManifest struct {
	Format  string        `json:"format"`
	Created time.Time     `json:"created"`
	Files   []backupEntry `json:"files"`
}

type backupPreview struct {
	Created  time.Time      `json:"created"`
	Files    int            `json:"files"`
	Bytes    int64          `json:"bytes"`
	Counts   map[string]int `json:"counts"`
	External []string       `json:"external"`
}

func managedBackupPath(name string) bool {
	if !fs.ValidPath(name) || strings.ContainsAny(name, "\\:\x00") {
		return false
	}
	dir, _, grouped := strings.Cut(name, "/")
	if !grouped {
		return slices.Contains(backupFiles, name)
	}
	return slices.Contains(backupDirs, dir)
}

func isTransientBackupTempFile(base string) bool {
	if !strings.HasPrefix(base, ".") {
		return false
	}
	return strings.Contains(base, ".tmp-") ||
		strings.Contains(base, ".download-") ||
		strings.HasPrefix(base, ".new-") ||
		strings.HasSuffix(base, ".bak")
}

func backupRoots() []string { return append(slices.Clone(backupFiles), backupDirs...) }

func writeBackup(root string, out io.Writer) error {
	z := zip.NewWriter(out)
	m := backupManifest{Format: backupFormat, Created: time.Now().UTC(), Files: []backupEntry{}}
	var total int64
	for _, name := range backupRoots() {
		source := filepath.Join(root, name)
		if _, err := os.Lstat(source); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		err := filepath.WalkDir(source, func(file string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			if isTransientBackupTempFile(d.Name()) {
				return nil
			}
			name, err := filepath.Rel(root, file)
			if err != nil {
				return err
			}
			name = filepath.ToSlash(name)
			info, err := d.Info()
			if err != nil {
				return err
			}
			if !info.Mode().IsRegular() || !managedBackupPath(name) {
				return fmt.Errorf("unsupported backup entry %q", name)
			}
			if len(m.Files) >= backupMaxFiles || info.Size() > backupMaxBytes-total {
				return errors.New("backup size or entry limit exceeded")
			}
			f, err := os.Open(file)
			if err != nil {
				return err
			}
			defer f.Close()
			w, err := z.Create(name)
			if err != nil {
				return err
			}
			h := sha256.New()
			size, err := io.Copy(io.MultiWriter(w, h), io.LimitReader(f, info.Size()+1))
			if err != nil {
				return err
			}
			if size != info.Size() {
				return fmt.Errorf("%s changed during backup", name)
			}
			m.Files = append(m.Files, backupEntry{Name: name, Size: size, Hash: hex.EncodeToString(h.Sum(nil))})
			total += size
			return nil
		})
		if err != nil {
			return err
		}
	}
	w, err := z.Create(backupManifestName)
	if err != nil {
		return err
	}
	if err = json.NewEncoder(w).Encode(m); err != nil {
		return err
	}
	return z.Close()
}

// Validate the entire archive, including every checksum, before installing
// any entry. Extraction only uses a fresh private staging directory.
func stageBackup(archive, stage string) (backupPreview, error) {
	var preview backupPreview
	z, err := zip.OpenReader(archive)
	if err != nil {
		return preview, err
	}
	defer z.Close()
	if len(z.File) > backupMaxFiles+1 {
		return preview, errors.New("too many backup entries")
	}
	index := make(map[string]*zip.File, len(z.File))
	for _, f := range z.File {
		if f.Name != backupManifestName && !managedBackupPath(f.Name) || !f.Mode().IsRegular() || index[f.Name] != nil {
			return preview, fmt.Errorf("invalid backup entry %q", f.Name)
		}
		index[f.Name] = f
	}
	manifest := index[backupManifestName]
	if manifest == nil || manifest.UncompressedSize64 > 4<<20 {
		return preview, errors.New("invalid backup manifest")
	}
	reader, err := manifest.Open()
	if err != nil {
		return preview, err
	}
	b, err := io.ReadAll(io.LimitReader(reader, 4<<20+1))
	reader.Close()
	if err != nil {
		return preview, err
	}
	var m backupManifest
	if err = json.Unmarshal(b, &m); err != nil {
		return preview, err
	}
	delete(index, backupManifestName)
	if m.Format != backupFormat || m.Created.IsZero() || m.Files == nil || len(index) != len(m.Files) {
		return preview, errors.New("incomplete or unsupported backup manifest")
	}
	preview.Created = m.Created
	preview.Files = len(m.Files)
	preview.Counts = map[string]int{}
	preview.External = []string{}
	for _, e := range m.Files {
		f := index[e.Name]
		if f == nil || e.Size < 0 || e.Size > backupMaxBytes-preview.Bytes || uint64(e.Size) != f.UncompressedSize64 {
			return preview, fmt.Errorf("invalid backup entry size or name %q", e.Name)
		}
		delete(index, e.Name)
		if err = extractBackupEntry(f, stage, e); err != nil {
			return preview, err
		}
		preview.Bytes += e.Size
	}
	err = inspectBackup(stage, &preview)
	return preview, err
}

func extractBackupEntry(f *zip.File, stage string, e backupEntry) error {
	dest := filepath.Join(stage, filepath.FromSlash(e.Name))
	if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		return err
	}
	r, err := f.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(r, e.Size+1))
	closeErr := out.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if n != e.Size || hex.EncodeToString(h.Sum(nil)) != e.Hash {
		return fmt.Errorf("checksum mismatch for %s", e.Name)
	}
	return nil
}

func nilBackupItem(item map[string]any) bool { return item == nil }

func inspectBackup(stage string, p *backupPreview) error {
	paths := map[string]bool{}
	addPath := func(name string) {
		if name == "" {
			return
		}
		portable := strings.TrimPrefix(path.Clean(name), "data/")
		if !strings.HasPrefix(name, "data/") || !managedBackupPath(portable) {
			paths[name] = true
			return
		}
		if _, err := os.Stat(filepath.Join(stage, filepath.FromSlash(portable))); err != nil {
			paths[name] = true
		}
	}
	for _, name := range backupFiles {
		b, err := os.ReadFile(filepath.Join(stage, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if name == "user.yaml" {
			var settings map[string]any
			if err = yaml.Unmarshal(b, &settings); err != nil || settings == nil {
				return fmt.Errorf("%s must contain a settings object", name)
			}
			continue
		}
		var objects []struct {
			ID        string           `yaml:"id"`
			Type      string           `yaml:"type"`
			URL       string           `yaml:"url"`
			Path      string           `yaml:"path"`
			Outbounds []map[string]any `yaml:"outbounds"`
			DNS       struct {
				Rules []map[string]any `yaml:"rules"`
			} `yaml:"dns"`
			Route struct {
				Rules    []map[string]any `yaml:"rules"`
				Rulesets []struct {
					NativePath string `yaml:"native_path"`
				} `yaml:"rule_set"`
			} `yaml:"route"`
		}
		if err = yaml.Unmarshal(b, &objects); err != nil {
			return fmt.Errorf("%s must contain a resource list", name)
		}
		ids := map[string]bool{}
		for _, o := range objects {
			if o.ID == "" || ids[o.ID] {
				return fmt.Errorf("missing or duplicate id in %s", name)
			}
			ids[o.ID] = true
			// The profile migration run at every WebUI startup requires these lists.
			if name == "profiles.yaml" {
				if o.Outbounds == nil || o.DNS.Rules == nil || o.Route.Rules == nil ||
					slices.ContainsFunc(o.Outbounds, nilBackupItem) || slices.ContainsFunc(o.DNS.Rules, nilBackupItem) || slices.ContainsFunc(o.Route.Rules, nilBackupItem) {
					return fmt.Errorf("profile %s requires valid outbounds, dns.rules and route.rules lists", o.ID)
				}
			}
			if o.Type == "File" {
				addPath(o.URL)
			}
			addPath(o.Path)
			for _, r := range o.Route.Rulesets {
				addPath(r.NativePath)
			}
		}
		p.Counts[strings.TrimSuffix(name, ".yaml")] = len(objects)
	}
	for name := range paths {
		p.External = append(p.External, name)
	}
	slices.Sort(p.External)
	return nil
}

// A journal records which roots existed before the swap. On an interrupted
// restore the next startup completes rollback before any worker can read data.
const restoreJournalDir = ".backup-restore"

func recoverBackup(root string) error {
	txn := filepath.Join(root, restoreJournalDir)
	b, err := os.ReadFile(filepath.Join(txn, "original.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var original map[string]bool
	if err = json.Unmarshal(b, &original); err != nil {
		return err
	}
	for _, name := range backupRoots() {
		existed, ok := original[name]
		if !ok {
			return errors.New("incomplete backup recovery journal")
		}
		old := filepath.Join(txn, "old", name)
		_, err = os.Lstat(old)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if existed && errors.Is(err, os.ErrNotExist) {
			continue
		}
		target := filepath.Join(root, name)
		if err = os.RemoveAll(target); err != nil {
			return err
		}
		if existed {
			if err = os.Rename(old, target); err != nil {
				return err
			}
		}
	}
	return os.RemoveAll(txn)
}

func installBackup(root, stage string, activate func() error) (err error) {
	if err = recoverBackup(root); err != nil {
		return err
	}
	temp, err := os.MkdirTemp(root, ".prepare-restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	if err = os.Mkdir(filepath.Join(temp, "old"), 0700); err != nil {
		return err
	}
	original := map[string]bool{}
	for _, name := range backupRoots() {
		_, err := os.Lstat(filepath.Join(root, name))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		original[name] = err == nil
	}
	b, _ := json.Marshal(original)
	if err = os.WriteFile(filepath.Join(temp, "original.json"), b, 0600); err != nil {
		return err
	}
	txn := filepath.Join(root, restoreJournalDir)
	if err = os.Rename(temp, txn); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, recoverBackup(root))
		}
	}()
	for _, name := range backupRoots() {
		target := filepath.Join(root, name)
		if original[name] {
			if err = os.Rename(target, filepath.Join(txn, "old", name)); err != nil {
				return err
			}
		}
		source := filepath.Join(stage, name)
		if _, e := os.Lstat(source); errors.Is(e, os.ErrNotExist) {
			continue
		} else if e != nil {
			return e
		}
		if err = os.Rename(source, target); err != nil {
			return err
		}
	}
	if activate != nil {
		if err = activate(); err != nil {
			return fmt.Errorf("loading restored task configuration: %w", err)
		}
	}
	// Atomically retire the journal before cleaning up replaced files.
	return os.Rename(txn, temp)
}
