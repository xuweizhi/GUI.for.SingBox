package bridge

import (
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"sync/atomic"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestRefreshSubscriptionUsage(t *testing.T) {
	old := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = old })

	var header atomic.Value
	header.Store("download=0; total=bad; expire=15; upload=-1")
	methods := make(chan string, 6)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods <- r.Method
		if r.Header.Get("User-Agent") != "custom-agent" || r.Header.Get("Authorization") != "demo" {
			http.Error(w, "headers missing", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Subscription-Userinfo", header.Load().(string))
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		// A usage request must finish as soon as it receives the headers.
		<-r.Context().Done()
	}))
	defer provider.Close()
	sub := subscriptionConfig{ID: "id", URL: provider.URL, Type: "Http", Path: "data/subscribes/id.json",
		Total: 55, Upload: 20, Download: 7, UpdateTime: 99, RequestTimeout: 5,
		Header:  subscriptionHeaderConfig{Request: map[string]string{"User-Agent": "custom-agent", "Authorization": "demo"}},
		Proxies: []subscriptionProxyConfig{{ID: "stable-id", Tag: "node"}},
	}
	if err := saveSubscriptions([]subscriptionConfig{sub}); err != nil {
		t.Fatal(err)
	}
	got, err := refreshSubscriptionUsage("id", "direct", "default")
	if err != nil || !got.Reported || got.Download != 0 || got.Total != 55 || got.Upload != 20 || got.Expire != 15000 || got.UsageUpdatedAt == 0 {
		t.Fatalf("report: %+v, err %v", got, err)
	}
	if calls := []string{<-methods, <-methods}; !slices.Equal(calls, []string{"HEAD", "GET"}) {
		t.Fatal(calls)
	}
	current, _ := loadSubscriptions()
	if current[0].UpdateTime != 99 || current[0].Proxies[0].ID != "stable-id" {
		t.Fatal("node metadata changed")
	}
	if _, err := os.Stat(resolvePath(sub.Path)); !os.IsNotExist(err) {
		t.Fatal("a node cache was written")
	}
	before, err := os.ReadFile(resolvePath(subscribesFilePath))
	if err != nil {
		t.Fatal(err)
	}
	header.Store("unknown=87; expire=12oops")
	stale, err := refreshSubscriptionUsage("id", "direct", "default")
	if err != nil || stale.Reported || stale.UsageUpdatedAt != got.UsageUpdatedAt {
		t.Fatalf("missing header: %+v, %v", stale, err)
	}
	after, err := os.ReadFile(resolvePath(subscribesFilePath))
	if err != nil || string(before) != string(after) {
		t.Fatal("missing usage changed data")
	}
}

func TestUsageResponseCannotUndoConcurrentEdit(t *testing.T) {
	old := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = old })
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.Header().Set("Subscription-Userinfo", "upload=9")
	}))
	defer server.Close()
	subs := []subscriptionConfig{{ID: "sub", Type: "Http", URL: server.URL, Upload: 2}}
	if err := saveSubscriptions(subs); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := refreshSubscriptionUsage("sub", "direct", "test"); result <- err }()
	<-started
	subs[0].URL = "https://new.example/path"
	err := saveSubscriptions(subs)
	close(release)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-result; err == nil {
		t.Fatal("stale response was accepted")
	}
	current, err := loadSubscriptions()
	if err != nil || current[0].Upload != 2 || current[0].URL != subs[0].URL {
		t.Fatal("concurrent change lost")
	}
}

func TestLegacySubscriptionUsageWithoutExpiry(t *testing.T) {
	var record subscriptionConfig
	err := yaml.Unmarshal([]byte("expire: .nan\ntotal: 100\ncustom-provider-field: retained\n"), &record)
	if err != nil || record.Expire != 0 || record.Total != 100 || record.Extra["custom-provider-field"] != "retained" {
		t.Fatalf("legacy record: %+v, err %v", record, err)
	}
}
