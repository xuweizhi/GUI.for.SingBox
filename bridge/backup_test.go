package bridge

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func backupFixture(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		if err := atomicWriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func backupTestArchive(t *testing.T, root string) string {
	t.Helper()
	archive := filepath.Join(t.TempDir(), "config.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	if err = writeBackup(root, f); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	return archive
}

func TestBackupMigrationRestoresReferencesAndKeepsRuntime(t *testing.T) {
	src, dst := t.TempDir(), t.TempDir()
	files := map[string]string{
		"profiles.yaml":       "- id: profile\n  dns: {rules: []}\n  outbounds:\n    - id: selector\n      outbounds: [{type: NodeGroup, id: group}]\n  route:\n    rules: []\n    rule_set: [{id: rule, type: local, path: rs}]\n",
		"subscribes.yaml":     "- id: sub\n  path: data/subscribes/sub.json\n  proxies: [{id: node, tag: HK}]\n",
		"subscribes/sub.json": `[{"tag":"HK","type":"socks"}]`,
		"node-groups.yaml":    "- id: group\n  members: [{subscription_id: sub, node_id: node}]\n",
		"rulesets.yaml":       "- id: rs\n  path: data/rulesets/rs.json\n",
		"rulesets/rs.json":    `{"version":3,"rules":[]}`,
		"scheduledtasks.yaml": "- id: task\n  subscriptions: [sub]\n  type: 'update::subscription'\n",
		"user.yaml":           "kernel: {profile: profile}\n",
	}
	backupFixture(t, src, files)
	backupFixture(t, src, map[string]string{"webui-token": "source-secret", "sing-box/config.json": "source runtime", ".backups/enabled": "on"})
	backupFixture(t, dst, map[string]string{"webui-token": "destination-secret", "sing-box/config.json": "destination runtime", "subscribes/obsolete.json": "old", "plugins.yaml": "- id: outdated"})
	stage := t.TempDir()
	preview, err := stageBackup(backupTestArchive(t, src), stage)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Files != len(files) || preview.Counts["profiles"] != 1 || len(preview.External) != 0 {
		t.Fatalf("preview %#v", preview)
	}
	if err = installBackup(dst, stage, nil); err != nil {
		t.Fatal(err)
	}
	for name, want := range files {
		got, err := os.ReadFile(filepath.Join(dst, name))
		if err != nil || string(got) != want {
			t.Errorf("restored %s: %v", name, err)
		}
	}
	for name, want := range map[string]string{"webui-token": "destination-secret", "sing-box/config.json": "destination runtime"} {
		b, _ := os.ReadFile(filepath.Join(dst, name))
		if string(b) != want {
			t.Errorf("%s overwritten", name)
		}
	}
	for _, name := range []string{"plugins.yaml", "subscribes/obsolete.json", ".backups/enabled"} {
		if _, err := os.Stat(filepath.Join(dst, name)); !os.IsNotExist(err) {
			t.Errorf("unexpected %s", name)
		}
	}
}

func TestBackupRejectsInvalidArchiveBeforeInstall(t *testing.T) {
	for _, tc := range []struct{ name, extra, manifest string }{
		{"unexpected", "webui-token", "{}"},
		{"incomplete", "profiles.yaml", `{"format":"gui-for-singbox/v1","created":"2025-01-01T00:00:00Z","files":[]}`},
		{"bad-content", "profiles.yaml", `{"format":"gui-for-singbox/v1","created":"2025-01-01T00:00:00Z","files":[{"name":"profiles.yaml","size":2,"sha256":"wrong"}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "archive.zip")
			f, _ := os.Create(p)
			z := zip.NewWriter(f)
			out, _ := z.Create(tc.extra)
			_, _ = io.WriteString(out, "[]")
			out, _ = z.Create(backupManifestName)
			_, _ = io.WriteString(out, tc.manifest)
			if err := z.Close(); err != nil {
				t.Fatal(err)
			}
			f.Close()
			if _, err := stageBackup(p, t.TempDir()); err == nil {
				t.Fatal("invalid archive accepted")
			}
		})
	}
}

func TestBackupRecoveryAndSnapshotRetention(t *testing.T) {
	root := t.TempDir()
	backupFixture(t, root, map[string]string{"profiles.yaml": "- id: original", ".backups/enabled": "1"})
	if err := snapshotBeforeProfileChange(root, []byte("- id: original\n  name: renamed")); err != nil {
		t.Fatal(err)
	}
	if names, err := autoBackupNames(root); err != nil || len(names) != 0 {
		t.Fatal("captured an unrelated edit")
	}
	for i := 0; i < backupRetention+2; i++ {
		if err := snapshotBeforeProfileChange(root, []byte("[]")); err != nil {
			t.Fatal(err)
		}
	}
	if names, err := autoBackupNames(root); err != nil || len(names) != backupRetention {
		t.Fatalf("retention %v %v", names, err)
	}

	original := map[string]bool{}
	for _, name := range backupRoots() {
		original[name] = name == "profiles.yaml"
	}
	b, _ := json.Marshal(original)
	backupFixture(t, root, map[string]string{".backup-restore/original.json": string(b), ".backup-restore/old/profiles.yaml": "- id: original", "profiles.yaml": "- id: incomplete", "node-groups.yaml": "[]"})
	if err := recoverBackup(root); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(root, "profiles.yaml"))
	if string(got) != "- id: original" {
		t.Fatal("did not roll back")
	}
	if _, err := os.Stat(filepath.Join(root, "node-groups.yaml")); !os.IsNotExist(err) {
		t.Fatal("partial install remains")
	}
}

func TestBackupWebDAVRoundTrip(t *testing.T) {
	var stored []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "test" || password != "pass" {
			w.WriteHeader(401)
			return
		}
		switch r.Method {
		case http.MethodPut:
			stored, _ = io.ReadAll(r.Body)
			w.WriteHeader(201)
		case http.MethodGet:
			w.Write(stored)
		default:
			w.WriteHeader(405)
		}
	}))
	defer server.Close()
	dir := t.TempDir()
	backupFixture(t, dir, map[string]string{"profiles.yaml": "- id: profile\n  outbounds: []\n  dns: {rules: []}\n  route: {rules: []}"})
	archive := backupTestArchive(t, dir)
	f, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	dav := webDAVBackupTarget{URL: server.URL + "/backup.zip", Username: "test", Password: "pass"}
	if err := dav.transfer(context.Background(), http.MethodPut, f); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "restored.zip")
	out, _ := os.Create(dest)
	if err := dav.transfer(context.Background(), http.MethodGet, out); err != nil {
		t.Fatal(err)
	}
	out.Close()
	got, _ := os.ReadFile(dest)
	source, _ := os.ReadFile(archive)
	if !bytes.Equal(got, source) {
		t.Fatal("remote backup changed")
	}
	preview, err := stageBackup(dest, t.TempDir())
	if err != nil || preview.Counts["profiles"] != 1 {
		t.Fatalf("remote preview: %#v %v", preview, err)
	}
}

func TestBackupPreviewIdentifiesHostPaths(t *testing.T) {
	root := t.TempDir()
	backupFixture(t, root, map[string]string{"rulesets.yaml": "- id: rs\n  path: /etc/example/rule.srs\n", "profiles.yaml": "- id: profile\n  outbounds: []\n  dns: {rules: []}\n  route:\n    rules: []\n    rule_set: [{native_path: /usr/local/share/custom.srs}]\n"})
	preview, err := stageBackup(backupTestArchive(t, root), t.TempDir())
	if err != nil || !slices.Equal(preview.External, []string{"/etc/example/rule.srs", "/usr/local/share/custom.srs"}) {
		t.Fatalf("%#v %v", preview, err)
	}
	backupFixture(t, root, map[string]string{"profiles.yaml": "invalid"})
	if _, err := stageBackup(backupTestArchive(t, root), t.TempDir()); err == nil || !strings.Contains(err.Error(), "profiles.yaml") {
		t.Fatal("invalid resource list accepted")
	}
}

func TestBackupActivationFailureRollsBack(t *testing.T) {
	root := t.TempDir()
	stage := t.TempDir()
	backupFixture(t, root, map[string]string{"profiles.yaml": "- id: original"})
	backupFixture(t, stage, map[string]string{"node-groups.yaml": "[]", "profiles.yaml": "- id: changed"})
	err := installBackup(root, stage, func() error { return io.ErrUnexpectedEOF })
	if err == nil {
		t.Fatal("activation failure ignored")
	}
	b, _ := os.ReadFile(filepath.Join(root, "profiles.yaml"))
	if string(b) != "- id: original" {
		t.Fatal("old configuration not restored")
	}
	if _, err := os.Stat(filepath.Join(root, "node-groups.yaml")); !os.IsNotExist(err) {
		t.Fatal("partial restore")
	}
}

func TestBackupHTTPRestoresTemporaryInstance(t *testing.T) {
	previous := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = previous })
	data := resolvePath("data")
	backupFixture(t, data, map[string]string{"user.yaml": "kernel: {profile: from-backup}", "profiles.yaml": "- id: from-backup\n  outbounds: []\n  dns: {rules: []}\n  route: {rules: []}", "scheduledtasks.yaml": "[]"})
	app := NewApp()
	t.Cleanup(app.StopScheduledTaskWorker)
	handler := sameOriginOnly((&headlessAuth{token: "fixture"}).wrap(http.HandlerFunc(app.handleBackup)))
	call := func(action string, body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, backupEndpoint+action, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer fixture")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	res := call("export", nil)
	if res.Code != 200 {
		t.Fatalf("export: %s", res.Body)
	}
	archive := slices.Clone(res.Body.Bytes())
	backupFixture(t, data, map[string]string{"profiles.yaml": "- id: overwritten", "webui-token": "keep"})
	res = call("preview", archive)
	if res.Code != 200 {
		t.Fatalf("preview: %s", res.Body)
	}
	b, _ := os.ReadFile(filepath.Join(data, "profiles.yaml"))
	if !strings.Contains(string(b), "overwritten") {
		t.Fatal("preview mutated data")
	}
	notified := false
	app.EventsOn("configurationRestored", func(...any) { notified = true })
	res = call("restore", archive)
	if res.Code != 200 || !notified {
		t.Fatalf("restore failed %d %s", res.Code, res.Body)
	}
	items, err := loadProfiles()
	if err != nil || len(items) != 1 || items[0].ID != "from-backup" {
		t.Fatalf("restored profiles: %v %v", items, err)
	}
	b, _ = os.ReadFile(filepath.Join(data, "webui-token"))
	if string(b) != "keep" {
		t.Fatal("destination token overwritten")
	}
}

func TestBackupSkipsTransientTempFiles(t *testing.T) {
	root := t.TempDir()
	backupFixture(t, root, map[string]string{
		"profiles.yaml":                         "- id: p1\n  outbounds: []\n  dns: {rules: []}\n  route: {rules: []}\n",
		"subscribes/sub.json":                   `[{"tag":"HK","type":"socks"}]`,
		"subscribes/.sub.json.download-12345":   "partial",
		"rulesets/.rs.srs.tmp-67890":            "partial",
		"rulesets/rs.json":                      `{"version":3,"rules":[]}`,
	})
	archive := backupTestArchive(t, root)
	preview, err := stageBackup(archive, t.TempDir())
	if err != nil {
		t.Fatalf("writeBackup/stageBackup failed with transient temp files present: %v", err)
	}
	if preview.Files != 3 {
		t.Fatalf("expected 3 non-temp files in backup, got %d (%+v)", preview.Files, preview)
	}
}
