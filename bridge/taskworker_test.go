package bridge

import (
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

func TestNormalizeScheduledTaskSpec(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{
			name:  "prepends seconds for five-part cron",
			input: "*/5 * * * *",
			want:  "0 */5 * * * *",
		},
		{
			name:  "keeps six-part cron unchanged",
			input: "*/10 * * * * *",
			want:  "*/10 * * * * *",
		},
		{
			name:    "rejects unsupported field count",
			input:   "* * * *",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeScheduledTaskSpec(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Fatalf("normalizeScheduledTaskSpec returned error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("normalizeScheduledTaskSpec = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestUpdateScheduledTaskLastTime(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	tasks := []scheduledTaskConfig{
		{
			ID:       "task-1",
			Name:     "Example",
			Type:     "run::script",
			Script:   "return 1",
			Cron:     "*/5 * * * *",
			Disabled: false,
		},
	}

	if err := saveScheduledTasks(tasks); err != nil {
		t.Fatalf("saveScheduledTasks: %v", err)
	}

	if err := updateScheduledTaskLastTime("task-1", 123456789); err != nil {
		t.Fatalf("updateScheduledTaskLastTime: %v", err)
	}

	loaded, err := loadScheduledTasks()
	if err != nil {
		t.Fatalf("loadScheduledTasks: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected 1 scheduled task, got %d", len(loaded))
	}
	if loaded[0].LastTime != 123456789 {
		t.Fatalf("LastTime = %d, want 123456789", loaded[0].LastTime)
	}
}

func TestRecordScheduledTaskLogPersistsLastTimeAndAppendsLog(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	if err := saveScheduledTasks([]scheduledTaskConfig{{
		ID:   "task-1",
		Name: "Example",
		Type: "run::script",
		Cron: "*/5 * * * *",
	}}); err != nil {
		t.Fatalf("saveScheduledTasks: %v", err)
	}

	app := &App{}
	result := app.RecordScheduledTaskLog(`{"id":"task-1","name":"Example","startTime":111,"endTime":222,"result":[{"ok":true,"result":"ok"}]}`)
	if !result.Flag {
		t.Fatalf("RecordScheduledTaskLog failed: %s", result.Data)
	}

	loaded, err := loadScheduledTasks()
	if err != nil {
		t.Fatalf("loadScheduledTasks: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected 1 scheduled task, got %d", len(loaded))
	}
	if loaded[0].LastTime != 111 {
		t.Fatalf("LastTime = %d, want 111", loaded[0].LastTime)
	}

	logs := app.taskWorker().snapshotLogs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log record, got %d", len(logs))
	}
	if logs[0].ID != "task-1" {
		t.Fatalf("log ID = %q, want %q", logs[0].ID, "task-1")
	}
	if logs[0].StartTime != 111 || logs[0].EndTime != 222 {
		t.Fatalf("unexpected log times: start=%d end=%d", logs[0].StartTime, logs[0].EndTime)
	}
	if len(logs[0].Result) != 1 || !logs[0].Result[0].OK || logs[0].Result[0].Result != "ok" {
		t.Fatalf("unexpected log result payload: %+v", logs[0].Result)
	}
}

func TestRecordScheduledTaskLogPersistsToDiskAndHydratesNewWorker(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	app := &App{}
	result := app.RecordScheduledTaskLog(`{"id":"task-1","name":"Example","startTime":111,"endTime":222,"result":[{"ok":true,"result":"ok"}]}`)
	if !result.Flag {
		t.Fatalf("RecordScheduledTaskLog failed: %s", result.Data)
	}

	newApp := &App{}
	logsResult := newApp.GetScheduledTaskWorkerLogs()
	if !logsResult.Flag {
		t.Fatalf("GetScheduledTaskWorkerLogs failed: %s", logsResult.Data)
	}
	if logsResult.Data != `[{"id":"task-1","name":"Example","startTime":111,"endTime":222,"result":[{"ok":true,"result":"ok"}]}]` {
		t.Fatalf("unexpected persisted logs: %s", logsResult.Data)
	}
}

func TestUpdateScheduledTaskLastTimeConcurrent(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	tasks := []scheduledTaskConfig{
		{ID: "task-1", Name: "One", Type: "run::script", Cron: "*/5 * * * *"},
		{ID: "task-2", Name: "Two", Type: "run::script", Cron: "*/5 * * * *"},
		{ID: "task-3", Name: "Three", Type: "run::script", Cron: "*/5 * * * *"},
	}
	if err := saveScheduledTasks(tasks); err != nil {
		t.Fatalf("saveScheduledTasks: %v", err)
	}

	expected := map[string]int64{
		"task-1": 101,
		"task-2": 202,
		"task-3": 303,
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	for id, ts := range expected {
		wg.Add(1)
		go func(id string, ts int64) {
			defer wg.Done()
			<-start
			if err := updateScheduledTaskLastTime(id, ts); err != nil {
				t.Errorf("updateScheduledTaskLastTime(%s): %v", id, err)
			}
		}(id, ts)
	}

	close(start)
	wg.Wait()

	loaded, err := loadScheduledTasks()
	if err != nil {
		t.Fatalf("loadScheduledTasks: %v", err)
	}
	for _, task := range loaded {
		if got := task.LastTime; got != expected[task.ID] {
			t.Fatalf("LastTime for %s = %d, want %d", task.ID, got, expected[task.ID])
		}
	}
}

func TestNormalizeSourceRulesetBody(t *testing.T) {
	count, pretty, err := normalizeSourceRulesetBody(
		`{"version":1,"rules":[{"domain":["a.example","b.example"],"outbound":"direct"},{"ip_cidr":"1.1.1.1/32"}]}`,
	)
	if err != nil {
		t.Fatalf("normalizeSourceRulesetBody: %v", err)
	}
	if count != 4 {
		t.Fatalf("count = %d, want 4", count)
	}
	if pretty == "" {
		t.Fatal("expected pretty-printed ruleset body")
	}
}

func TestDoUpdateRulesetCreatesMissingManualSourceFile(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	worker := (&App{}).taskWorker()
	ruleset := &rulesetConfig{
		ID:     "ruleset-1",
		Name:   "Manual Ruleset",
		Type:   "Manual",
		Format: "source",
		Path:   "data/rulesets/manual.json",
	}

	if err := worker.doUpdateRuleset(ruleset); err != nil {
		t.Fatalf("doUpdateRuleset: %v", err)
	}

	content, err := os.ReadFile(resolvePath(ruleset.Path))
	if err != nil {
		t.Fatalf("expected ruleset file to be created: %v", err)
	}
	if string(content) == "" {
		t.Fatal("expected created ruleset file to contain JSON")
	}
	if ruleset.Count != 0 {
		t.Fatalf("ruleset.Count = %d, want 0", ruleset.Count)
	}
	if ruleset.UpdateTime == 0 {
		t.Fatal("expected UpdateTime to be set")
	}
}

func TestValidateSubscriptionTaskSupportAllowsCustomScript(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	if err := saveSubscriptions([]subscriptionConfig{
		{
			ID:               "sub-1",
			Name:             "Subscription",
			Type:             "Http",
			URL:              "https://example.com/sub",
			Path:             "data/subscribes/sub-1.json",
			RequestProxyMode: "none",
			RequestMethod:    "GET",
			RequestTimeout:   15,
			Script:           "const onSubscribe = async () => ({})",
		},
	}); err != nil {
		t.Fatalf("saveSubscriptions: %v", err)
	}

	worker := (&App{}).taskWorker()
	err := worker.validateSubscriptionTaskSupport(scheduledTaskConfig{
		Type:          "update::subscription",
		Subscriptions: []string{"sub-1"},
	})
	if err != nil {
		t.Fatalf("expected custom subscription script to be allowed, got %v", err)
	}
}

func TestValidateSubscriptionTaskSupportAllowsActiveSubscribePlugin(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	if err := saveSubscriptions([]subscriptionConfig{
		{
			ID:               "sub-1",
			Name:             "Subscription",
			Type:             "Http",
			URL:              "https://example.com/sub",
			Path:             "data/subscribes/sub-1.json",
			RequestProxyMode: "none",
			RequestMethod:    "GET",
			RequestTimeout:   15,
			Script:           defaultSubscribeScript,
		},
	}); err != nil {
		t.Fatalf("saveSubscriptions: %v", err)
	}

	pluginYAML := "- id: plugin-1\n  name: Subscribe Hook\n  triggers:\n    - on::subscribe\n  disabled: false\n"
	if err := os.WriteFile(resolvePath(pluginsFilePath), []byte(pluginYAML), 0644); err != nil {
		t.Fatalf("write plugins yaml: %v", err)
	}

	worker := (&App{}).taskWorker()
	err := worker.validateSubscriptionTaskSupport(scheduledTaskConfig{
		Type:          "update::subscription",
		Subscriptions: []string{"sub-1"},
	})
	if err != nil {
		t.Fatalf("expected active onSubscribe plugin to be allowed, got %v", err)
	}
}

func TestParseSubscriptionProxiesTreatsShareLinksAsPluginInput(t *testing.T) {
	proxies, err := parseSubscriptionProxies("vmess://example\nvless://example-2", "Http")
	if err != nil {
		t.Fatalf("parseSubscriptionProxies: %v", err)
	}
	if len(proxies) != 1 {
		t.Fatalf("expected 1 proxy placeholder, got %d", len(proxies))
	}
	if proxies[0]["base64"] == nil {
		t.Fatalf("expected base64 placeholder, got %+v", proxies[0])
	}
}

func TestDoUpdateSubscriptionManualPurePath(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	worker := (&App{}).taskWorker()
	subscribe := &subscriptionConfig{
		ID:              "sub-1",
		Name:            "Manual Subscription",
		Type:            "Manual",
		Path:            "data/subscribes/sub-1.json",
		Include:         "us|jp",
		ExcludeProtocol: "reject",
		ProxyPrefix:     "PRE-",
		Script:          defaultSubscribeScript,
	}

	if err := os.MkdirAll(resolvePath("data/subscribes"), 0755); err != nil {
		t.Fatalf("mkdir subscribes: %v", err)
	}
	payload := `[{"tag":"us-a","type":"vmess"},{"tag":"jp-b","type":"trojan"},{"tag":"block","type":"reject"}]`
	if err := os.WriteFile(resolvePath(subscribe.Path), []byte(payload), 0644); err != nil {
		t.Fatalf("write subscription file: %v", err)
	}

	if err := worker.doUpdateSubscription(subscribe, backendNetworkSettings{RequestProxyMode: "none"}); err != nil {
		t.Fatalf("doUpdateSubscription: %v", err)
	}

	if subscribe.UpdateTime == 0 {
		t.Fatal("expected UpdateTime to be set")
	}
	if len(subscribe.Proxies) != 2 {
		t.Fatalf("expected 2 proxies after filtering, got %d", len(subscribe.Proxies))
	}
	if subscribe.Proxies[0].Tag != "PRE-us-a" {
		t.Fatalf("unexpected first proxy tag: %s", subscribe.Proxies[0].Tag)
	}
}

func TestDoUpdateSubscriptionHTTPFollowsRedirect(t *testing.T) {
	previousBasePath := Env.BasePath
	previousOS := Env.OS
	Env.BasePath = t.TempDir()
	Env.OS = "linux"
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
		Env.OS = previousOS
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "/final", http.StatusFound)
		case "/final":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"outbounds":[{"tag":"node-a","type":"vmess"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	worker := (&App{}).taskWorker()
	subscribe := &subscriptionConfig{
		ID:               "sub-redirect",
		Name:             "Redirect Subscription",
		Type:             "Http",
		URL:              server.URL + "/redirect",
		Path:             "data/subscribes/sub-redirect.json",
		RequestMethod:    "GET",
		RequestTimeout:   15,
		RequestProxyMode: "none",
		Header: struct {
			Request  map[string]string `json:"request" yaml:"request"`
			Response map[string]string `json:"response" yaml:"response"`
		}{
			Request:  map[string]string{},
			Response: map[string]string{},
		},
	}

	if err := worker.doUpdateSubscription(subscribe, backendNetworkSettings{RequestProxyMode: "none"}); err != nil {
		t.Fatalf("doUpdateSubscription: %v", err)
	}
	if len(subscribe.Proxies) != 1 {
		t.Fatalf("expected 1 proxy after redirect follow, got %d", len(subscribe.Proxies))
	}
	if subscribe.Proxies[0].Tag != "node-a" {
		t.Fatalf("unexpected proxy tag: %s", subscribe.Proxies[0].Tag)
	}
}

func TestValidateBackendTaskSupportRejectsPluginKernelProxyMode(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	if err := os.MkdirAll(resolvePath("data"), 0755); err != nil {
		t.Fatalf("mkdir data: %v", err)
	}
	if err := os.WriteFile(resolvePath("data/user.yaml"), []byte("requestProxyMode: kernel\n"), 0644); err != nil {
		t.Fatalf("write user settings: %v", err)
	}

	worker := (&App{}).taskWorker()
	err := worker.validateBackendTaskSupport(scheduledTaskConfig{Type: "update::plugin"})
	if err == nil {
		t.Fatal("expected kernel proxy mode to be rejected for backend plugin updates")
	}
}

func TestRunAllSubscriptionsAndSyncOutboundRefsTask(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	if err := os.MkdirAll(resolvePath("data/subscribes"), 0755); err != nil {
		t.Fatalf("mkdir subscribes: %v", err)
	}
	if err := os.WriteFile(resolvePath("data/user.yaml"), []byte("kernel:\n  profile: profile-1\nrequestProxyMode: none\n"), 0644); err != nil {
		t.Fatalf("write user settings: %v", err)
	}
	if err := os.WriteFile(resolvePath("data/subscribes/sub-1.json"), []byte(`[{"tag":"node-a","type":"vmess"}]`), 0644); err != nil {
		t.Fatalf("write subscription file: %v", err)
	}
	if err := saveSubscriptions([]subscriptionConfig{{
		ID:     "sub-1",
		Name:   "Sub 1",
		Type:   "Manual",
		Path:   "data/subscribes/sub-1.json",
		Script: defaultSubscribeScript,
	}}); err != nil {
		t.Fatalf("saveSubscriptions: %v", err)
	}

	profilesYAML := `- id: profile-1
  outbounds:
    - id: outbound-select
      tag: Select
      type: selector
      outbounds:
        - id: stale-sub
          tag: stale-sub
          type: Subscription
    - id: outbound-urltest
      tag: Auto
      type: urltest
      outbounds: []
- id: profile-2
  outbounds:
    - id: outbound-select
      tag: Other Select
      type: selector
      outbounds:
        - id: stale-sub
          tag: stale-sub
          type: Subscription
`
	if err := os.WriteFile(resolvePath("data/profiles.yaml"), []byte(profilesYAML), 0644); err != nil {
		t.Fatalf("write profiles yaml: %v", err)
	}

	worker := (&App{}).taskWorker()
	result, err := worker.runGoTask(scheduledTaskConfig{Type: "update::all::subscription::sync-outbound-refs"})
	if err != nil {
		t.Fatalf("runGoTask: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected update and sync results, got %d", len(result))
	}

	profiles, err := loadProfiles()
	if err != nil {
		t.Fatalf("loadProfiles: %v", err)
	}
	firstSelect := profiles[0].Outbounds[0].Outbounds
	firstAuto := profiles[0].Outbounds[1].Outbounds
	secondSelect := profiles[1].Outbounds[0].Outbounds
	if len(firstSelect) != 1 || firstSelect[0].ID != "sub-1" || firstSelect[0].Type != "Subscription" {
		t.Fatalf("unexpected current profile select refs: %+v", firstSelect)
	}
	if len(firstAuto) != 1 || firstAuto[0].ID != "sub-1" || firstAuto[0].Type != "Subscription" {
		t.Fatalf("unexpected current profile auto refs: %+v", firstAuto)
	}
	if len(secondSelect) != 0 {
		t.Fatalf("expected stale refs removed from second profile, got %+v", secondSelect)
	}
}

func TestDoUpdatePluginHTTPWritesPluginFile(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("export const onRun = () => 'ok'\n"))
	}))
	defer server.Close()

	worker := (&App{}).taskWorker()
	plugins := []pluginConfig{
		{
			ID:      "custom-http-plugin",
			Name:    "HTTP Plugin",
			Type:    "Http",
			URL:     server.URL,
			Path:    "data/plugins/http-plugin.js",
			Version: "v1.0.0",
		},
	}

	if err := worker.doUpdatePlugin(&plugins[0], &plugins, backendNetworkSettings{RequestProxyMode: "none"}); err != nil {
		t.Fatalf("doUpdatePlugin: %v", err)
	}

	content, err := os.ReadFile(resolvePath(plugins[0].Path))
	if err != nil {
		t.Fatalf("expected plugin file to be written: %v", err)
	}
	if string(content) == "" {
		t.Fatal("expected plugin file content to be non-empty")
	}
}
