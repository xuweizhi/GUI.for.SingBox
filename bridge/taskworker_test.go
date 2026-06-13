package bridge

import (
	"net/http"
	"net/http/httptest"
	"os"
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

func TestValidateSubscriptionTaskSupportRejectsCustomScript(t *testing.T) {
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
	if err == nil {
		t.Fatal("expected custom subscription script to be rejected")
	}
}

func TestValidateSubscriptionTaskSupportRejectsActiveSubscribePlugin(t *testing.T) {
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
	if err == nil {
		t.Fatal("expected active onSubscribe plugin to be rejected")
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
