package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestWorkerPluginAPIsAndUpdatedContext(t *testing.T) {
	backendFixtureBase(t)
	t.Setenv("GUI_BACKEND_PLUGIN_TEST", "expected")
	worker := backendFixtureWorker(t)
	backendFixtureWrite(t, "data/plugin.mjs", `const onTask = async () => {
 const output = await Plugins.Exec('/bin/echo', ['ok'])
 const env = await Plugins.GetEnv('GUI_BACKEND_PLUGIN_TEST')
 if (output !== 'ok' || env !== 'expected') throw new Error('worker API result mismatch')
 return Plugin.value
}`)
	for _, value := range []int{1, 2, 3} {
		raw, err := worker.call("task.run", map[string]any{
			"task":           map[string]any{"type": "run::plugin", "plugins": []string{"p"}},
			"plugins":        []map[string]any{{"id": "p", "name": "test", "path": "data/plugin.mjs"}},
			"pluginSettings": map[string]any{"p": map[string]any{"value": value}},
		}, 5*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			Result        []scheduledTaskWorkerResultItem   `json:"result"`
			PluginUpdates []scheduledTaskWorkerPluginUpdate `json:"pluginUpdates"`
		}
		if err = json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Result) != 1 || !response.Result[0].OK || len(response.PluginUpdates) != 1 || response.PluginUpdates[0].Status != value {
			t.Fatalf("updated plugin context not observed: %s", raw)
		}
	}
	// Subscription plugin handlers use the same API/context wrapper.
	backendFixtureWrite(t, "data/subscribe-plugin.mjs", `const onSubscribe = async (proxies) => { await Plugins.Exec('/bin/echo', ['ok']); return proxies }`)
	raw, err := worker.call("subscription.applyPlugins", map[string]any{"proxies": []map[string]any{{"tag": "node", "type": "socks"}}, "plugins": []map[string]any{{"id": "sub", "path": "data/subscribe-plugin.mjs", "name": "sub"}}}, 5*time.Second)
	if err != nil || !strings.Contains(string(raw), "node") {
		t.Fatalf("onSubscribe API failed: %s %v", raw, err)
	}
}

func TestWorkerLargeResponsesAndRecovery(t *testing.T) {
	backendFixtureBase(t)
	worker := backendFixtureWorker(t)
	raw, err := worker.call("task.run", map[string]any{"task": map[string]any{"type": "run::script", "script": "return 'x'.repeat(1100000)"}}, 5*time.Second)
	if err != nil || len(raw) < 1100000 {
		t.Fatalf("valid >1 MiB response rejected: %d %v", len(raw), err)
	}
	worker.mu.Lock()
	oldCmd, oldDone := worker.cmd, worker.processDone
	worker.mu.Unlock()
	results := make(chan error, 2)
	go func() {
		_, err := worker.callProcess("task.run", map[string]any{"task": map[string]any{"type": "run::script", "script": fmt.Sprintf("await new Promise(r => setTimeout(r, 100)); return 'x'.repeat(%d)", scheduledTaskWorkerMaxResponse+64)}}, 5*time.Second)
		results <- err
	}()
	// Ensure both requests are pending before the oversized response arrives.
	deadline := time.Now().Add(time.Second)
	for {
		worker.mu.Lock()
		pending := len(worker.pending)
		worker.mu.Unlock()
		if pending > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first request never became pending")
		}
		time.Sleep(time.Millisecond)
	}
	go func() {
		_, err := worker.callProcess("task.run", map[string]any{"task": map[string]any{"type": "run::script", "script": "await new Promise(() => {})"}}, 5*time.Second)
		results <- err
	}()
	for range 2 {
		select {
		case err := <-results:
			if err == nil {
				t.Fatal("oversize response must fail pending requests")
			}
			if strings.Contains(err.Error(), "timed out") {
				t.Fatalf("transport failure must release pending requests immediately: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("pending worker call hung")
		}
	}
	<-oldDone
	if err = worker.ensureStarted(); err != nil {
		t.Fatal(err)
	}
	worker.mu.Lock()
	newCmd := worker.cmd
	worker.mu.Unlock()
	if newCmd == oldCmd {
		t.Fatal("failed worker was not replaced")
	}
	worker.failProcess(oldCmd, errors.New("late error from old process"))
	raw, err = worker.callProcess("worker.info", map[string]any{}, time.Second)
	if err != nil || !strings.Contains(string(raw), "supportedTypes") {
		t.Fatalf("new worker poisoned by old process: %s %v", raw, err)
	}
}

func TestWorkerTimeoutTerminatesUnfinishedTaskAndRestarts(t *testing.T) {
	backendFixtureBase(t)
	worker := backendFixtureWorker(t)
	if err := worker.ensureStarted(); err != nil {
		t.Fatal(err)
	}
	worker.mu.Lock()
	done := worker.processDone
	worker.mu.Unlock()
	_, err := worker.callProcess("task.run", map[string]any{"task": map[string]any{"type": "run::script", "script": "await new Promise(() => {})"}}, 30*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected task timeout: %v", err)
	}
	<-done
	raw, err := worker.call("worker.info", map[string]any{}, time.Second)
	if err != nil || !strings.Contains(string(raw), "supportedTypes") {
		t.Fatalf("worker failed recovery: %s %v", raw, err)
	}
}

func TestWorkerReportsActualManagedTasksAndLogSources(t *testing.T) {
	backendFixtureBase(t)
	worker := backendFixtureWorker(t)
	backendFixtureWrite(t, subscribesFilePath, "- id: kernel-sub\n  name: Kernel\n  requestProxyMode: kernel\n")
	tasks := []scheduledTaskConfig{{ID: "go", Name: "Go", Type: "update::all::ruleset", Cron: "0 0 1 1 *"}, {ID: "kernel", Name: "Kernel", Type: "update::subscription", Subscriptions: []string{"kernel-sub"}, Cron: "0 0 1 1 *"}, {ID: "invalid", Name: "Invalid", Type: "update::all::ruleset", Cron: "bad"}}
	if err := worker.reloadTasks(tasks); err != nil {
		t.Fatal(err)
	}
	info := worker.info()
	if len(info.ManagedTaskIDs) != 1 || info.ManagedTaskIDs[0] != "go" {
		t.Fatalf("incorrect managed task IDs: %+v", info.ManagedTaskIDs)
	}
	if err := saveScheduledTasks(tasks); err != nil {
		t.Fatal(err)
	}
	if _, err := worker.executeTask(tasks[0]); err != nil {
		t.Fatal(err)
	}
	logs := worker.snapshotLogs()
	if len(logs) != 1 || logs[0].Source != "backend" || logs[0].Type != "update::all::ruleset" {
		t.Fatalf("backend log source missing: %+v", logs)
	}
	result := worker.app.RecordScheduledTaskLog(`{"id":"kernel","name":"Kernel","source":"backend","startTime":1,"endTime":2,"result":[]}`)
	if !result.Flag {
		t.Fatal(result.Data)
	}
	logs = worker.snapshotLogs()
	if logs[0].Source != "frontend" || logs[0].Type != "update::subscription" {
		t.Fatalf("frontend source/type not populated: %+v", logs[0])
	}
}
