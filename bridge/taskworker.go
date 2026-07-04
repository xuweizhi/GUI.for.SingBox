package bridge

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	cron "github.com/robfig/cron/v3"
	"gopkg.in/yaml.v3"
)

const (
	scheduledTasksFilePath           = "data/scheduledtasks.yaml"
	subscribesFilePath               = "data/subscribes.yaml"
	profilesFilePath                 = "data/profiles.yaml"
	pluginsFilePath                  = "data/plugins.yaml"
	pluginHubFilePath                = "data/.cache/plugin-list.json"
	rulesetsFilePath                 = "data/rulesets.yaml"
	scheduledTaskWorkerScriptSrc     = "taskworker/worker.mjs"
	scheduledTaskWorkerScriptDst     = "data/.cache/taskworker/worker.mjs"
	scheduledTaskWorkerProxyUtilsSrc = "frontend/src/vendor/proxy-utils.esm.mjs"
	scheduledTaskWorkerProxyUtilsDst = "data/.cache/taskworker/proxy-utils.esm.mjs"
	scheduledTaskLogEventName        = "scheduledTaskLog"
	scheduledTaskLogFileCategory     = "scheduledtasks"
	scheduledTaskWorkerLogsMaxLen    = 200
	defaultSubscribeScript           = "const onSubscribe = async (proxies, subscription) => {\n  return { proxies, subscription }\n}"
	subscriptionEncryptionHeader     = "Subscription-Encryption"
	subscriptionEncryptionValue      = "true"
)

var goScheduledTaskTypes = map[string]struct{}{
	"update::subscription":                          {},
	"update::all::subscription":                     {},
	"update::all::subscription::sync-outbound-refs": {},
	"update::plugin":                                {},
	"update::all::plugin":                           {},
	"update::ruleset":                               {},
	"update::all::ruleset":                          {},
}

var subscriptionShareLinkPattern = regexp.MustCompile(`(?i)^(?:ss|ssr|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard|anytls)://`)
var scheduledTasksFileMu sync.Mutex

type scheduledTaskConfig struct {
	ID            string   `json:"id" yaml:"id"`
	Name          string   `json:"name" yaml:"name"`
	Type          string   `json:"type" yaml:"type"`
	Subscriptions []string `json:"subscriptions" yaml:"subscriptions"`
	Rulesets      []string `json:"rulesets" yaml:"rulesets"`
	Plugins       []string `json:"plugins" yaml:"plugins"`
	Script        string   `json:"script" yaml:"script"`
	Cron          string   `json:"cron" yaml:"cron"`
	Notification  bool     `json:"notification" yaml:"notification"`
	Disabled      bool     `json:"disabled" yaml:"disabled"`
	LastTime      int64    `json:"lastTime" yaml:"lastTime"`
}

type rulesetConfig struct {
	ID         string `json:"id" yaml:"id"`
	Name       string `json:"name" yaml:"name"`
	UpdateTime int64  `json:"updateTime" yaml:"updateTime"`
	Disabled   bool   `json:"disabled" yaml:"disabled"`
	Type       string `json:"type" yaml:"type"`
	Format     string `json:"format" yaml:"format"`
	Path       string `json:"path" yaml:"path"`
	URL        string `json:"url" yaml:"url"`
	Count      int    `json:"count" yaml:"count"`
}

type subscriptionProxyConfig struct {
	ID   string `json:"id" yaml:"id"`
	Tag  string `json:"tag" yaml:"tag"`
	Type string `json:"type" yaml:"type"`
}

type subscriptionConfig struct {
	ID               string                    `json:"id" yaml:"id"`
	Name             string                    `json:"name" yaml:"name"`
	Upload           int64                     `json:"upload" yaml:"upload"`
	Download         int64                     `json:"download" yaml:"download"`
	Total            int64                     `json:"total" yaml:"total"`
	Expire           int64                     `json:"expire" yaml:"expire"`
	UpdateTime       int64                     `json:"updateTime" yaml:"updateTime"`
	Type             string                    `json:"type" yaml:"type"`
	URL              string                    `json:"url" yaml:"url"`
	Website          string                    `json:"website" yaml:"website"`
	DecryptPassword  string                    `json:"decryptPassword" yaml:"decryptPassword"`
	Path             string                    `json:"path" yaml:"path"`
	Include          string                    `json:"include" yaml:"include"`
	Exclude          string                    `json:"exclude" yaml:"exclude"`
	IncludeProtocol  string                    `json:"includeProtocol" yaml:"includeProtocol"`
	ExcludeProtocol  string                    `json:"excludeProtocol" yaml:"excludeProtocol"`
	ProxyPrefix      string                    `json:"proxyPrefix" yaml:"proxyPrefix"`
	RequestProxyMode string                    `json:"requestProxyMode" yaml:"requestProxyMode"`
	CustomProxy      string                    `json:"customProxy" yaml:"customProxy"`
	Disabled         bool                      `json:"disabled" yaml:"disabled"`
	InSecure         bool                      `json:"inSecure" yaml:"inSecure"`
	Proxies          []subscriptionProxyConfig `json:"proxies" yaml:"proxies"`
	RequestMethod    string                    `json:"requestMethod" yaml:"requestMethod"`
	RequestTimeout   int                       `json:"requestTimeout" yaml:"requestTimeout"`
	Header           struct {
		Request  map[string]string `json:"request" yaml:"request"`
		Response map[string]string `json:"response" yaml:"response"`
	} `json:"header" yaml:"header"`
	Script string `json:"script" yaml:"script"`
}

type profileOutboundRefConfig struct {
	ID   string `json:"id" yaml:"id"`
	Tag  string `json:"tag" yaml:"tag"`
	Type string `json:"type" yaml:"type"`
}

type profileOutboundConfig struct {
	ID        string                     `json:"id" yaml:"id"`
	Tag       string                     `json:"tag" yaml:"tag"`
	Type      string                     `json:"type" yaml:"type"`
	Outbounds []profileOutboundRefConfig `json:"outbounds" yaml:"outbounds"`
}

type profileConfig struct {
	Extra     map[string]any          `json:",inline" yaml:",inline"`
	ID        string                  `json:"id" yaml:"id"`
	Outbounds []profileOutboundConfig `json:"outbounds" yaml:"outbounds"`
}

type pluginConfigurationConfig struct {
	ID          string `json:"id" yaml:"id"`
	Title       string `json:"title" yaml:"title"`
	Description string `json:"description" yaml:"description"`
	Key         string `json:"key" yaml:"key"`
	Component   string `json:"component" yaml:"component"`
	Value       any    `json:"value" yaml:"value"`
	Options     any    `json:"options" yaml:"options"`
}

type pluginConfig struct {
	ID            string                       `json:"id" yaml:"id"`
	Version       string                       `json:"version" yaml:"version"`
	Name          string                       `json:"name" yaml:"name"`
	Description   string                       `json:"description" yaml:"description"`
	Type          string                       `json:"type" yaml:"type"`
	URL           string                       `json:"url" yaml:"url"`
	Path          string                       `json:"path" yaml:"path"`
	Triggers      []string                     `json:"triggers" yaml:"triggers"`
	Tags          []string                     `json:"tags" yaml:"tags"`
	HasUI         bool                         `json:"hasUI" yaml:"hasUI"`
	Group         string                       `json:"group" yaml:"group"`
	Menus         map[string]string            `json:"menus" yaml:"menus"`
	Context       map[string]map[string]string `json:"context" yaml:"context"`
	Configuration []pluginConfigurationConfig  `json:"configuration" yaml:"configuration"`
	Disabled      bool                         `json:"disabled" yaml:"disabled"`
	Status        int                          `json:"status" yaml:"status"`
}

type backendNetworkSettings struct {
	RequestProxyMode string `yaml:"requestProxyMode"`
	CustomProxy      string `yaml:"customProxy"`
	Kernel           struct {
		Profile string `yaml:"profile"`
	} `yaml:"kernel"`
}

type scheduledTaskWorkerResultItem struct {
	OK     bool   `json:"ok"`
	Result string `json:"result"`
}

type scheduledTaskWorkerLogRecord struct {
	ID        string                          `json:"id"`
	Name      string                          `json:"name"`
	StartTime int64                           `json:"startTime"`
	EndTime   int64                           `json:"endTime"`
	Result    []scheduledTaskWorkerResultItem `json:"result"`
}

type scheduledTaskWorkerInfo struct {
	Available      bool     `json:"available"`
	NodePath       string   `json:"nodePath"`
	SupportedTypes []string `json:"supportedTypes"`
}

type scheduledTaskWorkerMessage struct {
	Type   string          `json:"type,omitempty"`
	ID     string          `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type scheduledTaskWorkerResponse struct {
	Result json.RawMessage
	Error  string
}

type scheduledTaskWorkerPluginUpdate struct {
	ID     string `json:"id"`
	Status int    `json:"status"`
}

type scheduledTaskWorkerSupervisor struct {
	app *App

	startMu        sync.Mutex
	mu             sync.Mutex
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	pending        map[string]chan scheduledTaskWorkerResponse
	supportedTypes map[string]struct{}
	nodePath       string
	available      bool
	requestCounter uint64

	scheduler *cron.Cron
	entryIDs  map[string]cron.EntryID
	logs      []scheduledTaskWorkerLogRecord
}

func (a *App) taskWorker() *scheduledTaskWorkerSupervisor {
	if a.TaskWorker == nil {
		a.TaskWorker = &scheduledTaskWorkerSupervisor{
			app:            a,
			pending:        map[string]chan scheduledTaskWorkerResponse{},
			supportedTypes: map[string]struct{}{},
			entryIDs:       map[string]cron.EntryID{},
		}
	}
	return a.TaskWorker
}

func (a *App) StartScheduledTaskWorker() error {
	return a.taskWorker().reloadFromDisk()
}

func (a *App) StopScheduledTaskWorker() {
	a.taskWorker().stop()
}

func (a *App) GetScheduledTaskWorkerStatus() FlagResult {
	worker := a.taskWorker()
	if err := worker.ensureStarted(); err != nil {
		log.Printf("Scheduled task worker unavailable: %v", err)
	}

	data, err := json.Marshal(worker.info())
	if err != nil {
		return FlagResult{false, err.Error()}
	}
	return FlagResult{true, string(data)}
}

func (a *App) GetScheduledTaskWorkerLogs() FlagResult {
	logs, err := loadScheduledTaskWorkerLogs()
	if err != nil {
		return FlagResult{false, err.Error()}
	}
	data, err := json.Marshal(logs)
	if err != nil {
		return FlagResult{false, err.Error()}
	}
	return FlagResult{true, string(data)}
}

func (a *App) ClearScheduledTaskWorkerLogs() FlagResult {
	a.taskWorker().clearLogs()
	if err := clearScheduledTaskWorkerLogs(); err != nil {
		return FlagResult{false, err.Error()}
	}
	return FlagResult{true, "Success"}
}

func (a *App) RecordScheduledTaskLog(payload string) FlagResult {
	var record scheduledTaskWorkerLogRecord
	if err := json.Unmarshal([]byte(payload), &record); err != nil {
		return FlagResult{false, err.Error()}
	}
	if err := validateScheduledTaskLogRecord(record); err != nil {
		return FlagResult{false, err.Error()}
	}
	if record.ID != "" {
		if err := updateScheduledTaskLastTime(record.ID, record.StartTime); err != nil {
			return FlagResult{false, err.Error()}
		}
	}
	a.taskWorker().recordLog(record)
	return FlagResult{true, "Success"}
}

func (a *App) ReloadScheduledTaskWorker() FlagResult {
	if err := a.taskWorker().reloadFromDisk(); err != nil {
		return FlagResult{false, err.Error()}
	}
	return FlagResult{true, "Success"}
}

func (a *App) RunScheduledTaskWorker(id string) FlagResult {
	worker := a.taskWorker()
	if err := worker.ensureStarted(); err != nil {
		return FlagResult{false, err.Error()}
	}
	tasks, err := loadScheduledTasks()
	if err != nil {
		return FlagResult{false, err.Error()}
	}

	var task *scheduledTaskConfig
	for i := range tasks {
		if tasks[i].ID == id {
			task = &tasks[i]
			break
		}
	}

	if task == nil {
		return FlagResult{false, "scheduled task not found"}
	}
	if task.Disabled {
		return FlagResult{false, "scheduled task is disabled"}
	}
	if !worker.supportsType(task.Type) {
		return FlagResult{false, "scheduled task type is not handled by the backend runtime"}
	}
	if err := worker.validateBackendTaskSupport(*task); err != nil {
		return FlagResult{false, err.Error()}
	}

	if _, err := worker.executeTask(*task); err != nil {
		return FlagResult{false, err.Error()}
	}

	return FlagResult{true, "Success"}
}

func (w *scheduledTaskWorkerSupervisor) info() scheduledTaskWorkerInfo {
	w.mu.Lock()
	defer w.mu.Unlock()

	supportedTypes := w.supportedTypesSliceLocked()
	return scheduledTaskWorkerInfo{
		Available:      len(supportedTypes) > 0,
		NodePath:       w.nodePath,
		SupportedTypes: supportedTypes,
	}
}

func (w *scheduledTaskWorkerSupervisor) snapshotLogs() []scheduledTaskWorkerLogRecord {
	w.mu.Lock()
	defer w.mu.Unlock()

	logs := make([]scheduledTaskWorkerLogRecord, len(w.logs))
	copy(logs, w.logs)
	return logs
}

func (w *scheduledTaskWorkerSupervisor) clearLogs() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.logs = nil
}

func appendScheduledTaskWorkerLog(record scheduledTaskWorkerLogRecord) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return appendManagedLog(scheduledTaskLogFileCategory, string(data))
}

func loadScheduledTaskWorkerLogs() ([]scheduledTaskWorkerLogRecord, error) {
	dir := resolvePath(logsDirectory)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []scheduledTaskWorkerLogRecord{}, nil
	}
	if err != nil {
		return nil, err
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() || !managedLogPattern.MatchString(entry.Name()) || !strings.HasPrefix(entry.Name(), scheduledTaskLogFileCategory+"-") {
			continue
		}
		files = append(files, filepath.Join(dir, entry.Name()))
	}
	sort.Sort(sort.Reverse(sort.StringSlice(files)))

	logs := make([]scheduledTaskWorkerLogRecord, 0)
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		lines := strings.Split(string(data), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if line == "" {
				continue
			}
			var record scheduledTaskWorkerLogRecord
			if err := json.Unmarshal([]byte(line), &record); err != nil {
				log.Printf("Invalid scheduled task log record in %s: %v", file, err)
				continue
			}
			logs = append(logs, record)
			if len(logs) >= scheduledTaskWorkerLogsMaxLen {
				return logs, nil
			}
		}
	}

	return logs, nil
}

func clearScheduledTaskWorkerLogs() error {
	dir := resolvePath(logsDirectory)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !managedLogPattern.MatchString(entry.Name()) || !strings.HasPrefix(entry.Name(), scheduledTaskLogFileCategory+"-") {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func validateScheduledTaskLogRecord(record scheduledTaskWorkerLogRecord) error {
	if strings.TrimSpace(record.Name) == "" {
		return errors.New("scheduled task log name is required")
	}
	if record.StartTime <= 0 {
		return errors.New("scheduled task log startTime is required")
	}
	if record.EndTime < record.StartTime {
		return errors.New("scheduled task log endTime must be greater than or equal to startTime")
	}
	return nil
}

func (w *scheduledTaskWorkerSupervisor) supportsType(taskType string) bool {
	if _, ok := goScheduledTaskTypes[taskType]; ok {
		return true
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	_, ok := w.supportedTypes[taskType]
	return ok
}

func (w *scheduledTaskWorkerSupervisor) supportedTypesSliceLocked() []string {
	types := make([]string, 0, len(goScheduledTaskTypes)+len(w.supportedTypes))
	for taskType := range goScheduledTaskTypes {
		types = append(types, taskType)
	}
	for taskType := range w.supportedTypes {
		types = append(types, taskType)
	}
	return types
}

func (w *scheduledTaskWorkerSupervisor) ensureStarted() error {
	w.mu.Lock()
	if w.cmd != nil && w.available {
		w.mu.Unlock()
		return nil
	}
	w.mu.Unlock()

	w.startMu.Lock()
	defer w.startMu.Unlock()

	w.mu.Lock()
	if w.cmd != nil && w.available {
		w.mu.Unlock()
		return nil
	}
	w.mu.Unlock()

	nodePath, err := findNodeBinary()
	if err != nil {
		return err
	}

	scriptPath := resolvePath(scheduledTaskWorkerScriptDst)
	if _, statErr := os.Stat(scriptPath); statErr != nil {
		return fmt.Errorf("scheduled task worker script is missing: %w", statErr)
	}

	cmd := exec.Command(nodePath, scriptPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	w.mu.Lock()
	w.cmd = cmd
	w.stdin = stdin
	w.pending = map[string]chan scheduledTaskWorkerResponse{}
	w.nodePath = nodePath
	w.available = false
	w.mu.Unlock()

	go w.readLoop(stdout)
	go w.readStderr(stderr)
	go w.waitLoop(cmd)

	initPayload := map[string]any{
		"basePath": Env.BasePath,
		"env": map[string]any{
			"appName":     Env.AppName,
			"appVersion":  Env.AppVersion,
			"basePath":    Env.BasePath,
			"os":          Env.OS,
			"arch":        Env.ARCH,
			"runtimeMode": Env.RuntimeMode,
		},
	}

	if _, err := w.callProcess("worker.init", initPayload, 10*time.Second); err != nil {
		w.stopWithStartMuHeld()
		return err
	}

	rawInfo, err := w.callProcess("worker.info", map[string]any{}, 10*time.Second)
	if err != nil {
		w.stopWithStartMuHeld()
		return err
	}

	var info scheduledTaskWorkerInfo
	if err := json.Unmarshal(rawInfo, &info); err != nil {
		w.stopWithStartMuHeld()
		return err
	}

	supportedTypes := make(map[string]struct{}, len(info.SupportedTypes))
	for _, taskType := range info.SupportedTypes {
		supportedTypes[taskType] = struct{}{}
	}

	w.mu.Lock()
	w.available = true
	w.supportedTypes = supportedTypes
	w.mu.Unlock()

	return nil
}

func (w *scheduledTaskWorkerSupervisor) stop() {
	w.startMu.Lock()
	defer w.startMu.Unlock()
	w.stopWithStartMuHeld()
}

func (w *scheduledTaskWorkerSupervisor) stopWithStartMuHeld() {
	w.stopScheduler()

	w.mu.Lock()
	cmd := w.cmd
	w.available = false
	w.supportedTypes = map[string]struct{}{}
	w.mu.Unlock()
	if cmd == nil {
		return
	}

	_, _ = w.callProcess("worker.shutdown", map[string]any{}, 2*time.Second)
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func (w *scheduledTaskWorkerSupervisor) reloadFromDisk() error {
	if err := w.ensureStarted(); err != nil {
		log.Printf("Scheduled task node worker unavailable, continuing with Go-native task types only: %v", err)
	}

	tasks, err := loadScheduledTasks()
	if err != nil {
		w.stopScheduler()
		return err
	}

	return w.reloadTasks(tasks)
}

func (w *scheduledTaskWorkerSupervisor) reloadTasks(tasks []scheduledTaskConfig) error {
	w.stopScheduler()

	scheduler := cron.New(cron.WithSeconds())
	nextEntries := map[string]cron.EntryID{}

	for _, task := range tasks {
		if task.Disabled || !w.supportsType(task.Type) {
			continue
		}
		if err := w.validateBackendTaskSupport(task); err != nil {
			log.Printf("Scheduled task [%s] stays on the local path: %v", task.Name, err)
			continue
		}

		spec, err := normalizeScheduledTaskSpec(task.Cron)
		if err != nil {
			log.Printf("Scheduled task [%s] skipped: %v", task.Name, err)
			continue
		}

		taskCopy := task
		entryID, err := scheduler.AddFunc(spec, func() {
			if _, runErr := w.executeTask(taskCopy); runErr != nil {
				log.Printf("Scheduled task [%s] failed: %v", taskCopy.Name, runErr)
			}
		})
		if err != nil {
			log.Printf("Failed to register scheduled task [%s]: %v", task.Name, err)
			continue
		}
		nextEntries[task.ID] = entryID
	}

	scheduler.Start()

	w.mu.Lock()
	w.scheduler = scheduler
	w.entryIDs = nextEntries
	w.mu.Unlock()

	return nil
}

func (w *scheduledTaskWorkerSupervisor) stopScheduler() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.scheduler != nil {
		w.scheduler.Stop()
	}
	w.scheduler = nil
	w.entryIDs = map[string]cron.EntryID{}
}

func (w *scheduledTaskWorkerSupervisor) executeTask(task scheduledTaskConfig) ([]scheduledTaskWorkerResultItem, error) {
	startTime := time.Now().UnixMilli()

	if err := updateScheduledTaskLastTime(task.ID, startTime); err != nil {
		log.Printf("Failed to persist scheduled task lastTime [%s]: %v", task.Name, err)
	}

	var result []scheduledTaskWorkerResultItem
	if _, ok := goScheduledTaskTypes[task.Type]; ok {
		var err error
		result, err = w.runGoTask(task)
		if err != nil {
			result = []scheduledTaskWorkerResultItem{{OK: false, Result: err.Error()}}
		}
	} else {
		payload, payloadErr := w.buildWorkerTaskPayload(task)
		if payloadErr != nil {
			result = []scheduledTaskWorkerResultItem{{OK: false, Result: payloadErr.Error()}}
			goto finalize
		}

		rawResult, err := w.call("task.run", payload, 2*time.Minute)
		if err != nil {
			result = []scheduledTaskWorkerResultItem{{OK: false, Result: err.Error()}}
		} else {
			var workerPayload struct {
				Result        []scheduledTaskWorkerResultItem   `json:"result"`
				PluginUpdates []scheduledTaskWorkerPluginUpdate `json:"pluginUpdates"`
			}
			if err := json.Unmarshal(rawResult, &workerPayload); err == nil && workerPayload.Result != nil {
				result = workerPayload.Result
				if applyErr := applyPluginStatusUpdates(workerPayload.PluginUpdates); applyErr != nil {
					result = append(result, scheduledTaskWorkerResultItem{OK: false, Result: applyErr.Error()})
				}
			} else if err := json.Unmarshal(rawResult, &result); err != nil {
				result = []scheduledTaskWorkerResultItem{{OK: false, Result: err.Error()}}
			}
		}
	}

finalize:
	if task.Notification {
		log.Printf("Scheduled task [%s] requested notifications, but node worker notifications are not implemented yet", task.Name)
	}

	record := scheduledTaskWorkerLogRecord{
		ID:        task.ID,
		Name:      task.Name,
		StartTime: startTime,
		EndTime:   time.Now().UnixMilli(),
		Result:    result,
	}

	w.recordLog(record)

	return result, nil
}

func (w *scheduledTaskWorkerSupervisor) appendLog(record scheduledTaskWorkerLogRecord) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.logs = append([]scheduledTaskWorkerLogRecord{record}, w.logs...)
	if len(w.logs) > scheduledTaskWorkerLogsMaxLen {
		w.logs = w.logs[:scheduledTaskWorkerLogsMaxLen]
	}
}

func (w *scheduledTaskWorkerSupervisor) recordLog(record scheduledTaskWorkerLogRecord) {
	if record.Result == nil {
		record.Result = []scheduledTaskWorkerResultItem{}
	}
	w.appendLog(record)
	if err := appendScheduledTaskWorkerLog(record); err != nil {
		log.Printf("Scheduled task log persist failed: %v", err)
	}
	if w.app == nil || (!w.app.IsHeadless() && w.app.Ctx == nil) {
		return
	}
	w.app.EventsEmit(scheduledTaskLogEventName, record)
}

func (w *scheduledTaskWorkerSupervisor) call(method string, params any, timeout time.Duration) (json.RawMessage, error) {
	if err := w.ensureStarted(); err != nil {
		return nil, err
	}
	return w.callProcess(method, params, timeout)
}

func (w *scheduledTaskWorkerSupervisor) callProcess(
	method string,
	params any,
	timeout time.Duration,
) (json.RawMessage, error) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	requestID := fmt.Sprintf("worker-%d", atomic.AddUint64(&w.requestCounter, 1))
	resultCh := make(chan scheduledTaskWorkerResponse, 1)

	var payload json.RawMessage
	if params != nil {
		bytes, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		payload = bytes
	}

	message := scheduledTaskWorkerMessage{
		Type:   "request",
		ID:     requestID,
		Method: method,
		Params: payload,
	}

	line, err := json.Marshal(message)
	if err != nil {
		return nil, err
	}

	w.mu.Lock()
	if w.stdin == nil {
		w.mu.Unlock()
		return nil, errors.New("scheduled task worker is not running")
	}
	w.pending[requestID] = resultCh
	_, writeErr := w.stdin.Write(append(line, '\n'))
	w.mu.Unlock()

	if writeErr != nil {
		w.mu.Lock()
		delete(w.pending, requestID)
		w.mu.Unlock()
		return nil, writeErr
	}

	select {
	case response := <-resultCh:
		if response.Error != "" {
			return nil, errors.New(response.Error)
		}
		return response.Result, nil
	case <-time.After(timeout):
		w.mu.Lock()
		delete(w.pending, requestID)
		w.mu.Unlock()
		return nil, fmt.Errorf("scheduled task worker timed out on %s", method)
	}
}

func (w *scheduledTaskWorkerSupervisor) readLoop(stdout io.ReadCloser) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var message scheduledTaskWorkerMessage
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			log.Printf("Invalid scheduled task worker message: %s", line)
			continue
		}

		if message.Type != "response" {
			continue
		}

		w.mu.Lock()
		resultCh := w.pending[message.ID]
		delete(w.pending, message.ID)
		w.mu.Unlock()

		if resultCh != nil {
			resultCh <- scheduledTaskWorkerResponse{Result: message.Result, Error: message.Error}
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("Scheduled task worker stdout error: %v", err)
	}
}

func (w *scheduledTaskWorkerSupervisor) readStderr(stderr io.ReadCloser) {
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			if err := appendManagedLog("taskworker", line); err != nil {
				log.Printf("Scheduled task worker log persist failed: %v", err)
			}
			log.Printf("Scheduled task worker: %s", line)
		}
	}
}

func (w *scheduledTaskWorkerSupervisor) waitLoop(cmd *exec.Cmd) {
	if err := cmd.Wait(); err != nil {
		log.Printf("Scheduled task worker exited: %v", err)
	}

	w.mu.Lock()
	if w.cmd == cmd {
		w.cmd = nil
		w.stdin = nil
		w.available = false
		pending := w.pending
		w.pending = map[string]chan scheduledTaskWorkerResponse{}
		w.mu.Unlock()
		for _, ch := range pending {
			ch <- scheduledTaskWorkerResponse{Error: "scheduled task worker exited"}
		}
		return
	}
	w.mu.Unlock()
}

func findNodeBinary() (string, error) {
	candidates := []string{
		strings.TrimSpace(os.Getenv("GUI_FOR_CORES_NODE_PATH")),
		"node",
		"nodejs",
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}

	return "", errors.New("node runtime not found in PATH")
}

func normalizeScheduledTaskSpec(spec string) (string, error) {
	fields := strings.Fields(spec)
	switch len(fields) {
	case 5:
		return "0 " + strings.Join(fields, " "), nil
	case 6:
		return strings.Join(fields, " "), nil
	default:
		return "", fmt.Errorf("unsupported cron field count: %d", len(fields))
	}
}

func loadScheduledTasksUnlocked() ([]scheduledTaskConfig, error) {
	content, err := os.ReadFile(resolvePath(scheduledTasksFilePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []scheduledTaskConfig{}, nil
		}
		return nil, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return []scheduledTaskConfig{}, nil
	}

	var tasks []scheduledTaskConfig
	if err := yaml.Unmarshal(content, &tasks); err != nil {
		return nil, err
	}
	return tasks, nil
}

func loadScheduledTasks() ([]scheduledTaskConfig, error) {
	scheduledTasksFileMu.Lock()
	defer scheduledTasksFileMu.Unlock()
	return loadScheduledTasksUnlocked()
}

func saveScheduledTasksUnlocked(tasks []scheduledTaskConfig) error {
	content, err := yaml.Marshal(tasks)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
		return err
	}
	return os.WriteFile(resolvePath(scheduledTasksFilePath), content, 0644)
}

func saveScheduledTasks(tasks []scheduledTaskConfig) error {
	scheduledTasksFileMu.Lock()
	defer scheduledTasksFileMu.Unlock()
	return saveScheduledTasksUnlocked(tasks)
}

func updateScheduledTaskLastTime(id string, lastTime int64) error {
	scheduledTasksFileMu.Lock()
	defer scheduledTasksFileMu.Unlock()

	tasks, err := loadScheduledTasksUnlocked()
	if err != nil {
		return err
	}

	updated := false
	for index := range tasks {
		if tasks[index].ID == id {
			tasks[index].LastTime = lastTime
			updated = true
			break
		}
	}

	if !updated {
		return nil
	}

	return saveScheduledTasksUnlocked(tasks)
}

func loadRulesets() ([]rulesetConfig, error) {
	content, err := os.ReadFile(resolvePath(rulesetsFilePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []rulesetConfig{}, nil
		}
		return nil, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return []rulesetConfig{}, nil
	}

	var rulesets []rulesetConfig
	if err := yaml.Unmarshal(content, &rulesets); err != nil {
		return nil, err
	}
	return rulesets, nil
}

func saveRulesets(rulesets []rulesetConfig) error {
	content, err := yaml.Marshal(rulesets)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
		return err
	}
	return os.WriteFile(resolvePath(rulesetsFilePath), content, 0644)
}

func loadSubscriptions() ([]subscriptionConfig, error) {
	content, err := os.ReadFile(resolvePath(subscribesFilePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []subscriptionConfig{}, nil
		}
		return nil, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return []subscriptionConfig{}, nil
	}

	var subscribes []subscriptionConfig
	if err := yaml.Unmarshal(content, &subscribes); err != nil {
		return nil, err
	}
	return subscribes, nil
}

func saveSubscriptions(subscribes []subscriptionConfig) error {
	content, err := yaml.Marshal(subscribes)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
		return err
	}
	return os.WriteFile(resolvePath(subscribesFilePath), content, 0644)
}

func loadProfiles() ([]profileConfig, error) {
	content, err := os.ReadFile(resolvePath(profilesFilePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []profileConfig{}, nil
		}
		return nil, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return []profileConfig{}, nil
	}

	var profiles []profileConfig
	if err := yaml.Unmarshal(content, &profiles); err != nil {
		return nil, err
	}
	return profiles, nil
}

func saveProfiles(profiles []profileConfig) error {
	content, err := yaml.Marshal(profiles)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
		return err
	}
	return os.WriteFile(resolvePath(profilesFilePath), content, 0644)
}

func loadPlugins() ([]pluginConfig, error) {
	content, err := os.ReadFile(resolvePath(pluginsFilePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []pluginConfig{}, nil
		}
		return nil, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return []pluginConfig{}, nil
	}

	var plugins []pluginConfig
	if err := yaml.Unmarshal(content, &plugins); err != nil {
		return nil, err
	}
	return plugins, nil
}

func savePlugins(plugins []pluginConfig) error {
	content, err := yaml.Marshal(plugins)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
		return err
	}
	return os.WriteFile(resolvePath(pluginsFilePath), content, 0644)
}

func loadPluginHub() ([]pluginConfig, error) {
	content, err := os.ReadFile(resolvePath(pluginHubFilePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []pluginConfig{}, nil
		}
		return nil, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return []pluginConfig{}, nil
	}

	var plugins []pluginConfig
	if err := json.Unmarshal(content, &plugins); err != nil {
		return nil, err
	}
	return plugins, nil
}

func loadUserSettingsMap() (map[string]any, error) {
	content, err := os.ReadFile(resolvePath("data/user.yaml"))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(content))) == 0 {
		return map[string]any{}, nil
	}

	var settings map[string]any
	if err := yaml.Unmarshal(content, &settings); err != nil {
		return nil, err
	}
	return settings, nil
}

func saveUserSettingsMap(settings map[string]any) error {
	content, err := yaml.Marshal(settings)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
		return err
	}
	return os.WriteFile(resolvePath("data/user.yaml"), content, 0644)
}

func loadPluginSettingsMap() (map[string]any, error) {
	settings, err := loadUserSettingsMap()
	if err != nil {
		return nil, err
	}

	pluginSettings, _ := settings["pluginSettings"].(map[string]any)
	if pluginSettings == nil {
		pluginSettings = map[string]any{}
	}
	return pluginSettings, nil
}

func (w *scheduledTaskWorkerSupervisor) buildWorkerTaskPayload(task scheduledTaskConfig) (map[string]any, error) {
	payload := map[string]any{"task": task}
	if task.Type != "run::plugin" {
		return payload, nil
	}

	plugins, err := loadPlugins()
	if err != nil {
		return nil, err
	}

	targets := make([]pluginConfig, 0, len(task.Plugins))
	for _, id := range task.Plugins {
		for _, plugin := range plugins {
			if plugin.ID == id {
				targets = append(targets, plugin)
				break
			}
		}
	}

	pluginSettings, err := loadPluginSettingsMap()
	if err != nil {
		return nil, err
	}

	payload["plugins"] = targets
	payload["pluginSettings"] = pluginSettings
	return payload, nil
}

func applyPluginStatusUpdates(updates []scheduledTaskWorkerPluginUpdate) error {
	if len(updates) == 0 {
		return nil
	}

	plugins, err := loadPlugins()
	if err != nil {
		return err
	}

	changed := false
	for _, update := range updates {
		for index := range plugins {
			if plugins[index].ID == update.ID {
				plugins[index].Status = update.Status
				changed = true
				break
			}
		}
	}

	if !changed {
		return nil
	}

	return savePlugins(plugins)
}

func loadBackendNetworkSettings() (backendNetworkSettings, error) {
	settings := backendNetworkSettings{
		RequestProxyMode: "system",
	}

	content, err := os.ReadFile(resolvePath("data/user.yaml"))
	if err != nil {
		if os.IsNotExist(err) {
			return settings, nil
		}
		return settings, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return settings, nil
	}

	if err := yaml.Unmarshal(content, &settings); err != nil {
		return settings, err
	}

	if settings.RequestProxyMode == "" {
		settings.RequestProxyMode = "system"
	}

	return settings, nil
}

func (w *scheduledTaskWorkerSupervisor) validateBackendTaskSupport(task scheduledTaskConfig) error {
	switch task.Type {
	case "update::subscription", "update::all::subscription", "update::all::subscription::sync-outbound-refs":
		return w.validateSubscriptionTaskSupport(task)
	case "update::plugin", "update::all::plugin":
		settings, err := loadBackendNetworkSettings()
		if err != nil {
			return err
		}
		if settings.RequestProxyMode == "kernel" {
			return errors.New("plugin updates are not supported by the backend executor when requestProxyMode is kernel")
		}
		return nil
	case "run::plugin":
		plugins, err := loadPlugins()
		if err != nil {
			return err
		}
		for _, pluginID := range task.Plugins {
			for _, plugin := range plugins {
				if plugin.ID == pluginID && plugin.HasUI {
					return fmt.Errorf("plugin [%s] requires UI and is not supported by the backend executor", plugin.Name)
				}
			}
		}
		return nil
	default:
		return nil
	}
}

func (w *scheduledTaskWorkerSupervisor) validateSubscriptionTaskSupport(task scheduledTaskConfig) error {
	subscribes, err := loadSubscriptions()
	if err != nil {
		return err
	}
	settings, err := loadBackendNetworkSettings()
	if err != nil {
		return err
	}

	targets := collectTargetSubscriptions(task, subscribes)
	for _, subscribe := range targets {
		mode := resolveSubscriptionProxyMode(subscribe, settings)
		if mode == "kernel" {
			return fmt.Errorf(
				"subscription [%s] uses kernel proxy mode, which is not supported by the backend executor",
				subscribe.Name,
			)
		}
	}

	return nil
}

func loadActiveSubscribePlugins() ([]pluginConfig, error) {
	plugins, err := loadPlugins()
	if err != nil {
		return nil, err
	}

	active := make([]pluginConfig, 0, len(plugins))
	for _, plugin := range plugins {
		if plugin.Disabled {
			continue
		}
		for _, trigger := range plugin.Triggers {
			if trigger == "on::subscribe" {
				active = append(active, plugin)
				break
			}
		}
	}

	return active, nil
}

func loadActiveSubscribePluginNames() ([]string, error) {
	plugins, err := loadActiveSubscribePlugins()
	if err != nil {
		return nil, err
	}

	names := []string{}
	for _, plugin := range plugins {
		names = append(names, plugin.Name)
	}

	return names, nil
}

func collectTargetSubscriptions(
	task scheduledTaskConfig,
	subscribes []subscriptionConfig,
) []subscriptionConfig {
	if task.Type == "update::all::subscription" || task.Type == "update::all::subscription::sync-outbound-refs" {
		return subscribes
	}

	targets := make([]subscriptionConfig, 0, len(task.Subscriptions))
	for _, id := range task.Subscriptions {
		for _, subscribe := range subscribes {
			if subscribe.ID == id {
				targets = append(targets, subscribe)
				break
			}
		}
	}
	return targets
}

func isDefaultSubscribeScript(script string) bool {
	trimmed := strings.TrimSpace(script)
	return trimmed == "" || trimmed == strings.TrimSpace(defaultSubscribeScript)
}

func resolveSubscriptionProxyMode(
	subscribe subscriptionConfig,
	settings backendNetworkSettings,
) string {
	mode := strings.TrimSpace(subscribe.RequestProxyMode)
	if mode == "" || mode == "global" {
		mode = strings.TrimSpace(settings.RequestProxyMode)
	}
	if mode == "" {
		return "system"
	}
	return mode
}

func (w *scheduledTaskWorkerSupervisor) runGoTask(
	task scheduledTaskConfig,
) ([]scheduledTaskWorkerResultItem, error) {
	switch task.Type {
	case "update::subscription":
		return w.runSubscriptionTask(task.Subscriptions), nil
	case "update::all::subscription":
		return w.runAllSubscriptionsTask()
	case "update::all::subscription::sync-outbound-refs":
		return w.runAllSubscriptionsAndSyncOutboundRefsTask()
	case "update::plugin":
		return w.runPluginTask(task.Plugins), nil
	case "update::all::plugin":
		return w.runAllPluginsTask()
	case "update::ruleset":
		return w.runRulesetTask(task.Rulesets), nil
	case "update::all::ruleset":
		return w.runAllRulesetsTask()
	default:
		return nil, fmt.Errorf("unsupported Go-side scheduled task type: %s", task.Type)
	}
}

func (w *scheduledTaskWorkerSupervisor) runRulesetTask(
	ids []string,
) []scheduledTaskWorkerResultItem {
	output := make([]scheduledTaskWorkerResultItem, 0, len(ids))
	for _, id := range ids {
		message, err := w.updateRulesetByID(id)
		if err != nil {
			output = append(output, scheduledTaskWorkerResultItem{OK: false, Result: err.Error()})
			continue
		}
		output = append(output, scheduledTaskWorkerResultItem{OK: true, Result: message})
	}
	return output
}

func (w *scheduledTaskWorkerSupervisor) runSubscriptionTask(
	ids []string,
) []scheduledTaskWorkerResultItem {
	output := make([]scheduledTaskWorkerResultItem, 0, len(ids))
	settings, err := loadBackendNetworkSettings()
	if err != nil {
		return []scheduledTaskWorkerResultItem{{OK: false, Result: err.Error()}}
	}
	for _, id := range ids {
		message, updateErr := w.updateSubscriptionByID(id, settings)
		if updateErr != nil {
			output = append(output, scheduledTaskWorkerResultItem{OK: false, Result: updateErr.Error()})
			continue
		}
		output = append(output, scheduledTaskWorkerResultItem{OK: true, Result: message})
	}
	return output
}

func (w *scheduledTaskWorkerSupervisor) runAllSubscriptionsTask() ([]scheduledTaskWorkerResultItem, error) {
	subscribes, err := loadSubscriptions()
	if err != nil {
		return nil, err
	}
	settings, err := loadBackendNetworkSettings()
	if err != nil {
		return nil, err
	}

	output := make([]scheduledTaskWorkerResultItem, 0, len(subscribes))
	needSave := false
	for index := range subscribes {
		subscribe := &subscribes[index]
		if subscribe.Disabled {
			continue
		}

		if err := w.doUpdateSubscription(subscribe, settings); err != nil {
			output = append(output, scheduledTaskWorkerResultItem{
				OK:     false,
				Result: fmt.Sprintf("Failed to update subscription [%s]. Reason: %v", subscribe.Name, err),
			})
			continue
		}

		needSave = true
		output = append(output, scheduledTaskWorkerResultItem{
			OK:     true,
			Result: fmt.Sprintf("Subscription [%s] updated successfully.", subscribe.Name),
		})
	}

	if needSave {
		if err := saveSubscriptions(subscribes); err != nil {
			return nil, err
		}
	}

	return output, nil
}

func (w *scheduledTaskWorkerSupervisor) runAllSubscriptionsAndSyncOutboundRefsTask() ([]scheduledTaskWorkerResultItem, error) {
	output, err := w.runAllSubscriptionsTask()
	if err != nil {
		return output, err
	}

	added, removed, err := syncSubscriptionOutboundRefs()
	if err != nil {
		output = append(output, scheduledTaskWorkerResultItem{OK: false, Result: err.Error()})
		return output, nil
	}

	output = append(output, scheduledTaskWorkerResultItem{
		OK:     true,
		Result: fmt.Sprintf("Subscription outbound refs synced. Added: %d; Removed: %d.", added, removed),
	})
	return output, nil
}

func syncSubscriptionOutboundRefs() (int, int, error) {
	subscribes, err := loadSubscriptions()
	if err != nil {
		return 0, 0, err
	}
	profiles, err := loadProfiles()
	if err != nil {
		return 0, 0, err
	}
	settings, err := loadBackendNetworkSettings()
	if err != nil {
		return 0, 0, err
	}

	subscriptionIDs := make(map[string]struct{}, len(subscribes))
	for _, subscribe := range subscribes {
		subscriptionIDs[subscribe.ID] = struct{}{}
	}

	added := 0
	removed := 0
	changed := false
	for profileIdx := range profiles {
		for outboundIdx := range profiles[profileIdx].Outbounds {
			outbound := &profiles[profileIdx].Outbounds[outboundIdx]
			next := outbound.Outbounds[:0]
			for _, ref := range outbound.Outbounds {
				if ref.Type == "Subscription" {
					if _, ok := subscriptionIDs[ref.ID]; !ok {
						removed++
						changed = true
						continue
					}
				}
				next = append(next, ref)
			}
			outbound.Outbounds = next
		}
	}

	for profileIdx := range profiles {
		if profiles[profileIdx].ID != settings.Kernel.Profile {
			continue
		}
		for outboundIdx := range profiles[profileIdx].Outbounds {
			outbound := &profiles[profileIdx].Outbounds[outboundIdx]
			if outbound.ID != "outbound-select" && outbound.ID != "outbound-urltest" {
				continue
			}
			if outbound.Type != "selector" && outbound.Type != "urltest" {
				continue
			}
			for _, subscribe := range subscribes {
				exists := false
				for _, ref := range outbound.Outbounds {
					if ref.Type == "Subscription" && ref.ID == subscribe.ID {
						exists = true
						break
					}
				}
				if exists {
					continue
				}
				outbound.Outbounds = append(outbound.Outbounds, profileOutboundRefConfig{
					ID:   subscribe.ID,
					Tag:  subscribe.ID,
					Type: "Subscription",
				})
				added++
				changed = true
			}
		}
	}

	if changed {
		if err := saveProfiles(profiles); err != nil {
			return 0, 0, err
		}
	}
	return added, removed, nil
}

func (w *scheduledTaskWorkerSupervisor) runPluginTask(ids []string) []scheduledTaskWorkerResultItem {
	output := make([]scheduledTaskWorkerResultItem, 0, len(ids))
	settings, err := loadBackendNetworkSettings()
	if err != nil {
		return []scheduledTaskWorkerResultItem{{OK: false, Result: err.Error()}}
	}
	for _, id := range ids {
		message, updateErr := w.updatePluginByID(id, settings)
		if updateErr != nil {
			output = append(output, scheduledTaskWorkerResultItem{OK: false, Result: updateErr.Error()})
			continue
		}
		output = append(output, scheduledTaskWorkerResultItem{OK: true, Result: message})
	}
	return output
}

func (w *scheduledTaskWorkerSupervisor) runAllPluginsTask() ([]scheduledTaskWorkerResultItem, error) {
	plugins, err := loadPlugins()
	if err != nil {
		return nil, err
	}
	settings, err := loadBackendNetworkSettings()
	if err != nil {
		return nil, err
	}

	output := make([]scheduledTaskWorkerResultItem, 0, len(plugins))
	for index := range plugins {
		plugin := &plugins[index]
		if plugin.Disabled {
			continue
		}
		if err := w.doUpdatePlugin(plugin, &plugins, settings); err != nil {
			output = append(output, scheduledTaskWorkerResultItem{
				OK:     false,
				Result: fmt.Sprintf("Failed to update plugin [%s]. Reason: %v", plugin.Name, err),
			})
			continue
		}
		output = append(output, scheduledTaskWorkerResultItem{
			OK:     true,
			Result: fmt.Sprintf("Plugin [%s] updated successfully.", plugin.Name),
		})
	}

	if err := savePlugins(plugins); err != nil {
		return nil, err
	}

	return output, nil
}

func (w *scheduledTaskWorkerSupervisor) updatePluginByID(
	id string,
	settings backendNetworkSettings,
) (string, error) {
	plugins, err := loadPlugins()
	if err != nil {
		return "", err
	}

	for index := range plugins {
		plugin := &plugins[index]
		if plugin.ID != id {
			continue
		}
		if plugin.Disabled {
			return "", fmt.Errorf("%s is Disabled", plugin.Name)
		}
		if err := w.doUpdatePlugin(plugin, &plugins, settings); err != nil {
			return "", fmt.Errorf("Failed to update plugin [%s]. Reason: %v", plugin.Name, err)
		}
		if err := savePlugins(plugins); err != nil {
			return "", err
		}
		return fmt.Sprintf("Plugin [%s] updated successfully.", plugin.Name), nil
	}

	return "", fmt.Errorf("%s Not Found", id)
}

func (w *scheduledTaskWorkerSupervisor) doUpdatePlugin(
	plugin *pluginConfig,
	plugins *[]pluginConfig,
	settings backendNetworkSettings,
) error {
	nextPlugin := *plugin

	if strings.HasPrefix(plugin.ID, "plugin-") {
		pluginHub, err := loadPluginHub()
		if err != nil {
			return err
		}
		var hubPlugin *pluginConfig
		for index := range pluginHub {
			if pluginHub[index].ID == plugin.ID {
				hubPlugin = &pluginHub[index]
				break
			}
		}
		if hubPlugin == nil {
			return errors.New("Plugin not found. Please update the Plugin-Hub.")
		}

		currentMajor := pluginMajorVersion(plugin.Version)
		nextMajor := pluginMajorVersion(hubPlugin.Version)
		if currentMajor != "" && nextMajor != "" && currentMajor != nextMajor {
			nextPlugin = *hubPlugin
			if err := reconcilePluginUserSettings(plugin.ID, plugin.Configuration, nextPlugin.Configuration); err != nil {
				return err
			}
			replacePluginInSlice(plugins, plugin.ID, nextPlugin)
			*plugin = nextPlugin
		} else if hubPlugin.Version != "" {
			plugin.Version = hubPlugin.Version
			nextPlugin.Version = hubPlugin.Version
		}
	}

	code := ""
	switch nextPlugin.Type {
	case "File":
		content, err := os.ReadFile(resolvePath(nextPlugin.Path))
		if err == nil {
			code = string(content)
		}
	case "Http":
		proxy, err := w.resolveGlobalRequestProxy(settings)
		if err != nil {
			return err
		}
		result := w.app.Requests("GET", nextPlugin.URL, map[string]string{}, "", RequestOptions{
			Proxy:   proxy,
			Timeout: 15,
		})
		if !result.Flag {
			return errors.New(result.Body)
		}
		if result.Status != 200 {
			return fmt.Errorf("Failed to fetch plugin code from %s. Status: %d", nextPlugin.URL, result.Status)
		}
		code = result.Body
	default:
		return fmt.Errorf("unsupported plugin type: %s", nextPlugin.Type)
	}

	if nextPlugin.Type != "File" {
		if err := os.MkdirAll(filepath.Dir(resolvePath(nextPlugin.Path)), os.ModePerm); err != nil {
			return err
		}
		if err := os.WriteFile(resolvePath(nextPlugin.Path), []byte(code), 0644); err != nil {
			return err
		}
	}

	return nil
}

func (w *scheduledTaskWorkerSupervisor) updateSubscriptionByID(
	id string,
	settings backendNetworkSettings,
) (string, error) {
	subscribes, err := loadSubscriptions()
	if err != nil {
		return "", err
	}

	for index := range subscribes {
		subscribe := &subscribes[index]
		if subscribe.ID != id {
			continue
		}
		if subscribe.Disabled {
			return "", fmt.Errorf("%s Disabled", subscribe.Name)
		}
		if err := w.doUpdateSubscription(subscribe, settings); err != nil {
			return "", fmt.Errorf("Failed to update subscription [%s]. Reason: %v", subscribe.Name, err)
		}
		if err := saveSubscriptions(subscribes); err != nil {
			return "", err
		}
		return fmt.Sprintf("Subscription [%s] updated successfully.", subscribe.Name), nil
	}

	return "", fmt.Errorf("%s Not Found", id)
}

func (w *scheduledTaskWorkerSupervisor) doUpdateSubscription(
	subscribe *subscriptionConfig,
	settings backendNetworkSettings,
) error {
	body, userInfo, err := w.loadSubscriptionBody(subscribe, settings)
	if err != nil {
		return err
	}

	proxies, err := parseSubscriptionProxies(body, subscribe.Type)
	if err != nil {
		return err
	}

	proxies, err = w.applySubscriptionPluginsWithWorker(*subscribe, proxies)
	if err != nil {
		return err
	}

	if needsNativeSubscriptionConvert(proxies) {
		proxies, err = w.normalizeSubscriptionProxiesWithWorker(proxies)
		if err != nil {
			return err
		}
	}

	proxies, err = applySubscriptionFilters(proxies, subscribe)
	if err != nil {
		return err
	}

	subscribe.Upload = userInfo["upload"]
	subscribe.Download = userInfo["download"]
	subscribe.Total = userInfo["total"]
	subscribe.Expire = userInfo["expire"] * 1000
	subscribe.UpdateTime = time.Now().UnixMilli()
	subscribe.Proxies = mapSubscriptionProxies(proxies, subscribe.Proxies)

	if !isDefaultSubscribeScript(subscribe.Script) {
		nextProxies, nextSubscription, err := w.runSubscriptionScriptWithWorker(*subscribe, proxies)
		if err != nil {
			return err
		}
		proxies = nextProxies
		*subscribe = nextSubscription
		subscribe.Proxies = mapSubscriptionProxies(proxies, subscribe.Proxies)
	}

	if subscribe.Type == "Http" || (subscribe.Type == "File" && subscribe.URL != subscribe.Path) {
		payload, err := json.MarshalIndent(proxies, "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(resolvePath(subscribe.Path)), os.ModePerm); err != nil {
			return err
		}
		if err := os.WriteFile(resolvePath(subscribe.Path), payload, 0644); err != nil {
			return err
		}
	}

	return nil
}

func (w *scheduledTaskWorkerSupervisor) applySubscriptionPluginsWithWorker(
	subscribe subscriptionConfig,
	proxies []map[string]any,
) ([]map[string]any, error) {
	activePlugins, err := loadActiveSubscribePlugins()
	if err != nil {
		return nil, err
	}
	if len(activePlugins) == 0 {
		return proxies, nil
	}

	pluginSettings, err := loadPluginSettingsMap()
	if err != nil {
		return nil, err
	}

	rawResult, err := w.call("subscription.applyPlugins", map[string]any{
		"proxies":        proxies,
		"subscription":   subscribe,
		"plugins":        activePlugins,
		"pluginSettings": pluginSettings,
	}, 2*time.Minute)
	if err != nil {
		return nil, err
	}

	var nextProxies []map[string]any
	if err := json.Unmarshal(rawResult, &nextProxies); err != nil {
		return nil, err
	}
	if nextProxies == nil {
		return []map[string]any{}, nil
	}
	return nextProxies, nil
}

func (w *scheduledTaskWorkerSupervisor) normalizeSubscriptionProxiesWithWorker(
	proxies []map[string]any,
) ([]map[string]any, error) {
	rawResult, err := w.call("subscription.normalizeNative", map[string]any{
		"proxies": proxies,
	}, 2*time.Minute)
	if err != nil {
		return nil, err
	}

	var nextProxies []map[string]any
	if err := json.Unmarshal(rawResult, &nextProxies); err != nil {
		return nil, err
	}
	if nextProxies == nil {
		return []map[string]any{}, nil
	}
	return nextProxies, nil
}

func (w *scheduledTaskWorkerSupervisor) runSubscriptionScriptWithWorker(
	subscribe subscriptionConfig,
	proxies []map[string]any,
) ([]map[string]any, subscriptionConfig, error) {
	rawResult, err := w.call("subscription.runScript", map[string]any{
		"proxies":      proxies,
		"subscription": subscribe,
		"script":       subscribe.Script,
	}, 2*time.Minute)
	if err != nil {
		return nil, subscriptionConfig{}, err
	}

	var response struct {
		Proxies      []map[string]any   `json:"proxies"`
		Subscription subscriptionConfig `json:"subscription"`
	}
	if err := json.Unmarshal(rawResult, &response); err != nil {
		return nil, subscriptionConfig{}, err
	}
	if response.Proxies == nil {
		response.Proxies = []map[string]any{}
	}
	return response.Proxies, response.Subscription, nil
}

func (w *scheduledTaskWorkerSupervisor) loadSubscriptionBody(
	subscribe *subscriptionConfig,
	settings backendNetworkSettings,
) (string, map[string]int64, error) {
	userInfo := map[string]int64{
		"upload":   0,
		"download": 0,
		"total":    0,
		"expire":   0,
	}

	switch subscribe.Type {
	case "Manual":
		content, err := os.ReadFile(resolvePath(subscribe.Path))
		return string(content), userInfo, err
	case "File":
		content, err := os.ReadFile(resolvePath(subscribe.URL))
		return string(content), userInfo, err
	case "Http":
		proxy, err := w.resolveSubscriptionProxy(subscribe, settings)
		if err != nil {
			return "", userInfo, err
		}
		headers := map[string]string{}
		for key, value := range subscribe.Header.Request {
			headers[key] = value
		}
		result := w.app.Requests(
			subscribe.RequestMethod,
			subscribe.URL,
			headers,
			"",
			RequestOptions{
				Redirect: true,
				Proxy:    proxy,
				Insecure: subscribe.InSecure,
				Timeout:  subscribe.RequestTimeout,
			},
		)
		if !result.Flag {
			return "", userInfo, errors.New(result.Body)
		}
		for key, value := range subscribe.Header.Response {
			result.Headers.Set(key, value)
		}
		parseSubscriptionUserInfo(userInfo, result.Headers.Get("Subscription-Userinfo"))
		if isEncryptedSubscription(result.Headers.Values(subscriptionEncryptionHeader)) {
			decryptPassword := strings.TrimSpace(subscribe.DecryptPassword)
			if decryptPassword == "" {
				return "", userInfo, errors.New("Subscription is encrypted. Set a decrypt password first")
			}

			decryptedBody, err := decryptEncryptedSubscription(decryptPassword, result.Body)
			if err != nil {
				return "", userInfo, err
			}
			return decryptedBody, userInfo, nil
		}
		return result.Body, userInfo, nil
	default:
		return "", userInfo, fmt.Errorf("unsupported subscription type: %s", subscribe.Type)
	}
}

func (w *scheduledTaskWorkerSupervisor) resolveSubscriptionProxy(
	subscribe *subscriptionConfig,
	settings backendNetworkSettings,
) (string, error) {
	mode := resolveSubscriptionProxyMode(*subscribe, settings)
	switch mode {
	case "", "none":
		return "", nil
	case "custom":
		return normalizeRequestProxyGo(firstNonEmpty(subscribe.CustomProxy, settings.CustomProxy)), nil
	case "system":
		return w.getSystemProxy()
	case "kernel":
		return "", errors.New("kernel proxy mode is not supported by the backend executor")
	default:
		return "", nil
	}
}

func (w *scheduledTaskWorkerSupervisor) resolveGlobalRequestProxy(
	settings backendNetworkSettings,
) (string, error) {
	switch settings.RequestProxyMode {
	case "", "none":
		return "", nil
	case "custom":
		return normalizeRequestProxyGo(settings.CustomProxy), nil
	case "system":
		return w.getSystemProxy()
	case "kernel":
		return "", errors.New("kernel proxy mode is not supported by the backend executor")
	default:
		return "", nil
	}
}

func parseSubscriptionUserInfo(target map[string]int64, header string) {
	for _, part := range strings.Split(header, ";") {
		segments := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(segments) != 2 {
			continue
		}
		if value, err := parseInt64(strings.TrimSpace(segments[1])); err == nil {
			target[strings.TrimSpace(segments[0])] = value
		}
	}
}

func isEncryptedSubscription(headerValues []string) bool {
	for _, value := range headerValues {
		if strings.EqualFold(strings.TrimSpace(value), subscriptionEncryptionValue) {
			return true
		}
	}
	return false
}

func decryptEncryptedSubscription(password string, base64Data string) (string, error) {
	normalized := strings.TrimSpace(base64Data)
	if password == "" || normalized == "" {
		return "", errors.New("Failed to decrypt subscription. Check the decrypt password")
	}

	normalized = strings.ReplaceAll(normalized, "\n", "")
	normalized = strings.ReplaceAll(normalized, "\r", "")
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.ReplaceAll(normalized, "\t", "")
	normalized = strings.ReplaceAll(normalized, "-", "+")
	normalized = strings.ReplaceAll(normalized, "_", "/")
	switch len(normalized) % 4 {
	case 2:
		normalized += "=="
	case 3:
		normalized += "="
	}

	raw, err := base64.StdEncoding.DecodeString(normalized)
	if err != nil || len(raw) <= aes.BlockSize {
		return "", errors.New("Failed to decrypt subscription. Check the decrypt password")
	}

	sum := md5.Sum([]byte(password))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return "", errors.New("Failed to decrypt subscription. Check the decrypt password")
	}

	iv := raw[:aes.BlockSize]
	ciphertext := raw[aes.BlockSize:]
	if len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return "", errors.New("Failed to decrypt subscription. Check the decrypt password")
	}

	plaintext := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plaintext, ciphertext)
	plaintext, err = unpadPKCS7(plaintext, aes.BlockSize)
	if err != nil {
		return "", errors.New("Failed to decrypt subscription. Check the decrypt password")
	}

	return string(plaintext), nil
}

func unpadPKCS7(payload []byte, blockSize int) ([]byte, error) {
	if len(payload) == 0 || len(payload)%blockSize != 0 {
		return nil, errors.New("invalid PKCS7 payload")
	}

	padding := int(payload[len(payload)-1])
	if padding == 0 || padding > blockSize || padding > len(payload) {
		return nil, errors.New("invalid PKCS7 padding")
	}

	for _, value := range payload[len(payload)-padding:] {
		if int(value) != padding {
			return nil, errors.New("invalid PKCS7 padding")
		}
	}

	return payload[:len(payload)-padding], nil
}

func parseSubscriptionProxies(body string, subscriptionType string) ([]map[string]any, error) {
	if outbounds, ok := parseSubscriptionJSONOutbounds(body); ok {
		return outbounds, nil
	}
	if proxies, ok := parseSubscriptionYAMLProxies(body); ok {
		return proxies, nil
	}
	if looksLikeBase64(body) || looksLikeSubscriptionShareLinkList(body) {
		return []map[string]any{{"base64": body}}, nil
	}
	if subscriptionType == "Manual" {
		var proxies []map[string]any
		if err := json.Unmarshal([]byte(body), &proxies); err != nil {
			return nil, err
		}
		return proxies, nil
	}
	return nil, errors.New("Not a valid subscription data")
}

func parseSubscriptionJSONOutbounds(body string) ([]map[string]any, bool) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return nil, false
	}
	items, ok := payload["outbounds"].([]any)
	if !ok {
		return nil, false
	}
	return anySliceToMapSlice(items), true
}

func parseSubscriptionYAMLProxies(body string) ([]map[string]any, bool) {
	var payload map[string]any
	if err := yaml.Unmarshal([]byte(body), &payload); err != nil {
		return nil, false
	}
	items, ok := payload["proxies"].([]any)
	if !ok {
		return nil, false
	}
	return anySliceToMapSlice(items), true
}

func anySliceToMapSlice(items []any) []map[string]any {
	output := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapping, ok := item.(map[string]any); ok {
			output = append(output, mapping)
		}
	}
	return output
}

func needsNativeSubscriptionConvert(proxies []map[string]any) bool {
	if len(proxies) == 0 {
		return false
	}
	if _, ok := proxies[0]["base64"]; ok {
		return true
	}
	for _, proxy := range proxies {
		if stringValue(proxy["name"]) != "" && stringValue(proxy["tag"]) == "" {
			return true
		}
	}
	return false
}

func applySubscriptionFilters(
	proxies []map[string]any,
	subscribe *subscriptionConfig,
) ([]map[string]any, error) {
	includeRegex, err := compileSmartRegexp(subscribe.Include)
	if err != nil {
		return nil, err
	}
	excludeRegex, err := compileSmartRegexp(subscribe.Exclude)
	if err != nil {
		return nil, err
	}
	includeProtocolRegex, err := compileSmartRegexp(subscribe.IncludeProtocol)
	if err != nil {
		return nil, err
	}
	excludeProtocolRegex, err := compileSmartRegexp(subscribe.ExcludeProtocol)
	if err != nil {
		return nil, err
	}

	output := make([]map[string]any, 0, len(proxies))
	for _, proxy := range proxies {
		if _, ok := proxy["base64"]; ok {
			return nil, errors.New("You need to install the [节点转换] plugin first")
		}

		tag := stringValue(proxy["tag"])
		name := stringValue(proxy["name"])
		if name != "" && tag == "" {
			return nil, errors.New("You need to install the [节点转换] plugin first")
		}
		proxyType := stringValue(proxy["type"])

		if includeRegex != nil && !includeRegex.MatchString(tag) {
			continue
		}
		if excludeRegex != nil && excludeRegex.MatchString(tag) {
			continue
		}
		if includeProtocolRegex != nil && !includeProtocolRegex.MatchString(proxyType) {
			continue
		}
		if excludeProtocolRegex != nil && excludeProtocolRegex.MatchString(proxyType) {
			continue
		}

		if subscribe.ProxyPrefix != "" && tag != "" && !strings.HasPrefix(tag, subscribe.ProxyPrefix) {
			tag = subscribe.ProxyPrefix + tag
			proxy["tag"] = tag
		}

		output = append(output, proxy)
	}

	return output, nil
}

func compileSmartRegexp(pattern string) (*regexp.Regexp, error) {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return nil, nil
	}
	r, err := regexp.Compile(trimmed)
	if err == nil {
		return r, nil
	}
	return regexp.Compile(regexp.QuoteMeta(trimmed))
}

func mapSubscriptionProxies(
	proxies []map[string]any,
	previous []subscriptionProxyConfig,
) []subscriptionProxyConfig {
	output := make([]subscriptionProxyConfig, 0, len(proxies))
	for index, proxy := range proxies {
		tag := stringValue(proxy["tag"])
		proxyType := stringValue(proxy["type"])
		if tag == "" {
			tag = fmt.Sprintf("proxy-%d-%d", time.Now().UnixNano(), index)
		}
		id := ""
		for _, item := range previous {
			if item.Tag == tag {
				id = item.ID
				break
			}
		}
		if id == "" {
			id = fmt.Sprintf("proxy-%d-%d", time.Now().UnixNano(), index)
		}
		output = append(output, subscriptionProxyConfig{
			ID:   id,
			Tag:  tag,
			Type: proxyType,
		})
	}
	return output
}

func looksLikeBase64(content string) bool {
	normalized := strings.TrimSpace(content)
	if normalized == "" {
		return false
	}
	normalized = strings.ReplaceAll(normalized, "\n", "")
	normalized = strings.ReplaceAll(normalized, "\r", "")
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.ReplaceAll(normalized, "-", "+")
	normalized = strings.ReplaceAll(normalized, "_", "/")
	switch len(normalized) % 4 {
	case 2:
		normalized += "=="
	case 3:
		normalized += "="
	}
	_, err := base64.StdEncoding.DecodeString(normalized)
	return err == nil
}

func looksLikeSubscriptionShareLinkList(content string) bool {
	lines := strings.Split(content, "\n")
	seen := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if trimmed == "" {
			continue
		}
		seen = true
		if !subscriptionShareLinkPattern.MatchString(trimmed) {
			return false
		}
	}
	return seen
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func parseInt64(value string) (int64, error) {
	var parsed int64
	_, err := fmt.Sscan(value, &parsed)
	return parsed, err
}

func normalizeRequestProxyGo(proxy string) string {
	trimmed := strings.TrimSpace(proxy)
	if trimmed == "" {
		return ""
	}
	if matched, _ := regexp.MatchString(`^[a-z][a-z\d+\-.]*://`, strings.ToLower(trimmed)); matched {
		return trimmed
	}
	return "http://" + trimmed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func pluginMajorVersion(version string) string {
	trimmed := strings.TrimSpace(strings.TrimPrefix(version, "v"))
	parts := strings.Split(trimmed, ".")
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func replacePluginInSlice(plugins *[]pluginConfig, id string, next pluginConfig) {
	for index := range *plugins {
		if (*plugins)[index].ID == id {
			(*plugins)[index] = next
			return
		}
	}
}

func reconcilePluginUserSettings(
	pluginID string,
	currentConfig []pluginConfigurationConfig,
	nextConfig []pluginConfigurationConfig,
) error {
	settings, err := loadUserSettingsMap()
	if err != nil {
		return err
	}

	pluginSettings, ok := settings["pluginSettings"].(map[string]any)
	if !ok || pluginSettings == nil {
		return nil
	}

	currentValues, ok := pluginSettings[pluginID].(map[string]any)
	if !ok || currentValues == nil {
		return nil
	}

	nextValues := map[string]any{}
	for _, config := range nextConfig {
		currentValue, exists := currentValues[config.Key]
		if exists && sameConfigValueType(currentValue, config.Value) {
			nextValues[config.Key] = currentValue
			continue
		}
		nextValues[config.Key] = config.Value
	}

	pluginSettings[pluginID] = nextValues
	settings["pluginSettings"] = pluginSettings
	return saveUserSettingsMap(settings)
}

func sameConfigValueType(current any, next any) bool {
	currentIsArray := isArrayLike(current)
	nextIsArray := isArrayLike(next)
	if currentIsArray || nextIsArray {
		return currentIsArray == nextIsArray
	}
	return fmt.Sprintf("%T", current) == fmt.Sprintf("%T", next)
}

func isArrayLike(value any) bool {
	switch value.(type) {
	case []any:
		return true
	case []string:
		return true
	case []int:
		return true
	default:
		return false
	}
}

func (w *scheduledTaskWorkerSupervisor) getSystemProxy() (string, error) {
	switch Env.OS {
	case "windows":
		enabled := w.app.Exec("reg", []string{
			"query",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
			"/v",
			"ProxyEnable",
			"/t",
			"REG_DWORD",
		}, ExecOptions{Convert: true})
		if !enabled.Flag {
			return "", nil
		}
		if strings.Contains(enabled.Data, "0x0") {
			return "", nil
		}
		server := w.app.Exec("reg", []string{
			"query",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
			"/v",
			"ProxyServer",
			"/t",
			"REG_SZ",
		}, ExecOptions{Convert: true})
		if !server.Flag {
			return "", nil
		}
		matches := regexp.MustCompile(`ProxyServer\s+REG_SZ\s+(\S+)`).FindStringSubmatch(server.Data)
		if len(matches) < 2 {
			return "", nil
		}
		if strings.HasPrefix(matches[1], "socks") {
			return matches[1], nil
		}
		return "http://" + matches[1], nil
	case "darwin":
		out := w.app.Exec("scutil", []string{"--proxy"}, ExecOptions{})
		if !out.Flag {
			return "", nil
		}
		lines := strings.Split(out.Data, "\n")
		values := map[string]string{}
		for _, line := range lines {
			segments := strings.SplitN(strings.TrimSpace(line), ":", 2)
			if len(segments) != 2 {
				continue
			}
			values[strings.TrimSpace(segments[0])] = strings.TrimSpace(segments[1])
		}
		if values["HTTPEnable"] == "1" {
			return "http://" + values["HTTPProxy"] + ":" + values["HTTPPort"], nil
		}
		if values["SOCKSEnable"] == "1" {
			return "socks5://" + values["SOCKSProxy"] + ":" + values["SOCKSPort"], nil
		}
		return "", nil
	case "linux":
		desktop := os.Getenv("XDG_CURRENT_DESKTOP")
		if strings.Contains(desktop, "KDE") {
			out := w.app.Exec("kreadconfig5", []string{
				"--file",
				"kioslaverc",
				"--group",
				"Proxy Settings",
				"--key",
				"ProxyType",
			}, ExecOptions{})
			if out.Flag && strings.Contains(out.Data, "1") {
				httpOut := w.app.Exec("kreadconfig5", []string{
					"--file",
					"kioslaverc",
					"--group",
					"Proxy Settings",
					"--key",
					"httpProxy",
				}, ExecOptions{})
				httpProxy := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(httpOut.Data), "'", ""), "\"", "")
				if httpOut.Flag && httpProxy != "" {
					return strings.ReplaceAll(httpProxy, " ", ":"), nil
				}

				socksOut := w.app.Exec("kreadconfig5", []string{
					"--file",
					"kioslaverc",
					"--group",
					"Proxy Settings",
					"--key",
					"socksProxy",
				}, ExecOptions{})
				socksProxy := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(socksOut.Data), "'", ""), "\"", "")
				if socksOut.Flag && socksProxy != "" {
					return strings.ReplaceAll(socksProxy, " ", ":"), nil
				}
			}
		}
		if strings.Contains(desktop, "GNOME") || strings.Contains(desktop, "XFCE") {
			modeOut := w.app.Exec("gsettings", []string{"get", "org.gnome.system.proxy", "mode"}, ExecOptions{})
			if !modeOut.Flag {
				return "", nil
			}
			if strings.Contains(modeOut.Data, "none") {
				return "", nil
			}
			if strings.Contains(modeOut.Data, "manual") {
				httpHostOut := w.app.Exec("gsettings", []string{"get", "org.gnome.system.proxy.http", "host"}, ExecOptions{})
				httpPortOut := w.app.Exec("gsettings", []string{"get", "org.gnome.system.proxy.http", "port"}, ExecOptions{})
				httpHost := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(httpHostOut.Data), "'", ""), "\"", "")
				httpPort := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(httpPortOut.Data), "'", ""), "\"", "")
				if httpHostOut.Flag && httpPortOut.Flag && httpHost != "" && httpPort != "0" {
					return "http://" + httpHost + ":" + httpPort, nil
				}

				socksHostOut := w.app.Exec("gsettings", []string{"get", "org.gnome.system.proxy.socks", "host"}, ExecOptions{})
				socksPortOut := w.app.Exec("gsettings", []string{"get", "org.gnome.system.proxy.socks", "port"}, ExecOptions{})
				socksHost := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(socksHostOut.Data), "'", ""), "\"", "")
				socksPort := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(socksPortOut.Data), "'", ""), "\"", "")
				if socksHostOut.Flag && socksPortOut.Flag && socksHost != "" && socksPort != "0" {
					return "socks5://" + socksHost + ":" + socksPort, nil
				}
			}
		}
	}

	return "", nil
}

func (w *scheduledTaskWorkerSupervisor) runAllRulesetsTask() ([]scheduledTaskWorkerResultItem, error) {
	rulesets, err := loadRulesets()
	if err != nil {
		return nil, err
	}

	output := make([]scheduledTaskWorkerResultItem, 0, len(rulesets))
	needSave := false
	for index := range rulesets {
		ruleset := &rulesets[index]
		if ruleset.Disabled {
			continue
		}

		if err := w.doUpdateRuleset(ruleset); err != nil {
			output = append(output, scheduledTaskWorkerResultItem{
				OK:     false,
				Result: fmt.Sprintf("Failed to update rule-set [%s]. Reason: %v", ruleset.Name, err),
			})
			continue
		}

		needSave = true
		output = append(output, scheduledTaskWorkerResultItem{
			OK:     true,
			Result: fmt.Sprintf("Rule-Set [%s] updated successfully.", ruleset.Name),
		})
	}

	if needSave {
		if err := saveRulesets(rulesets); err != nil {
			return nil, err
		}
	}

	return output, nil
}

func (w *scheduledTaskWorkerSupervisor) updateRulesetByID(id string) (string, error) {
	rulesets, err := loadRulesets()
	if err != nil {
		return "", err
	}

	for index := range rulesets {
		ruleset := &rulesets[index]
		if ruleset.ID != id {
			continue
		}
		if ruleset.Disabled {
			return "", fmt.Errorf("%s Disabled", ruleset.Name)
		}
		if err := w.doUpdateRuleset(ruleset); err != nil {
			return "", fmt.Errorf("Failed to update rule-set [%s]. Reason: %v", ruleset.Name, err)
		}
		if err := saveRulesets(rulesets); err != nil {
			return "", err
		}
		return fmt.Sprintf("Ruleset [%s] updated successfully.", ruleset.Name), nil
	}

	return "", fmt.Errorf("%s Not Found", id)
}

func (w *scheduledTaskWorkerSupervisor) doUpdateRuleset(ruleset *rulesetConfig) error {
	if ruleset.Format == "source" {
		body, changed, err := w.loadSourceRulesetBody(ruleset)
		if err != nil {
			return err
		}
		if !isValidRulesetJSON(body) {
			return errors.New("Not a valid ruleset data")
		}

		count, prettyBody, err := normalizeSourceRulesetBody(body)
		if err != nil {
			return err
		}

		ruleset.Count = count
		if changed {
			if err := os.MkdirAll(filepath.Dir(resolvePath(ruleset.Path)), os.ModePerm); err != nil {
				return err
			}
			if err := os.WriteFile(resolvePath(ruleset.Path), []byte(prettyBody), 0644); err != nil {
				return err
			}
		}
	}

	if ruleset.Format == "binary" {
		if ruleset.Type == "File" && ruleset.URL != ruleset.Path {
			if result := w.app.CopyFile(ruleset.URL, ruleset.Path); !result.Flag {
				return errors.New(result.Data)
			}
		} else if ruleset.Type == "Http" {
			result := w.app.Download("GET", ruleset.URL, ruleset.Path, map[string]string{}, "", RequestOptions{})
			if !result.Flag {
				return errors.New(result.Body)
			}
		}
	}

	ruleset.UpdateTime = time.Now().UnixMilli()
	return nil
}

func (w *scheduledTaskWorkerSupervisor) loadSourceRulesetBody(
	ruleset *rulesetConfig,
) (body string, shouldWrite bool, err error) {
	switch ruleset.Type {
	case "File":
		content, readErr := os.ReadFile(resolvePath(ruleset.URL))
		return string(content), ruleset.URL != ruleset.Path, readErr
	case "Http":
		result := w.app.Requests("GET", ruleset.URL, map[string]string{}, "", RequestOptions{})
		if !result.Flag {
			return "", false, errors.New(result.Body)
		}
		return result.Body, true, nil
	case "Manual":
		content, readErr := os.ReadFile(resolvePath(ruleset.Path))
		if readErr == nil {
			return string(content), false, nil
		}
		if os.IsNotExist(readErr) {
			return `{"version":1,"rules":[]}`, true, nil
		}
		return "", false, readErr
	default:
		return "", false, fmt.Errorf("unsupported ruleset source type: %s", ruleset.Type)
	}
}

func isValidRulesetJSON(content string) bool {
	var payload map[string]any
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return false
	}
	_, ok := payload["rules"]
	return ok
}

func normalizeSourceRulesetBody(content string) (count int, pretty string, err error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return 0, "", err
	}

	rules, ok := payload["rules"].([]any)
	if !ok {
		return 0, "", errors.New("rules must be an array")
	}

	for _, rule := range rules {
		mapping, ok := rule.(map[string]any)
		if !ok {
			count++
			continue
		}
		for _, value := range mapping {
			if list, ok := value.([]any); ok {
				count += len(list)
				continue
			}
			count++
		}
	}

	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return 0, "", err
	}

	return count, string(body), nil
}
