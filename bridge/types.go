package bridge

import (
	"context"
	"net/http"
	"os"
	"sync"
)

// App struct
type App struct {
	Ctx           context.Context
	Headless      *HeadlessRuntime
	TaskWorker    *scheduledTaskWorkerSupervisor
	coreStartTime int64
	coreProcess   *os.Process // Protected by coreStartMu; independent of exec.Cmd.Wait.
	workerOnce    sync.Once
	startupOnce   sync.Once
	eventsOnce    sync.Once
	events        *eventHub
}

const RuntimeModeWebUI = "webui"

type EnvResult struct {
	Args         []string `json:"-"`
	AppName      string   `json:"appName"`
	AppVersion   string   `json:"appVersion"`
	BasePath     string   `json:"basePath"`
	OS           string   `json:"os"`
	ARCH         string   `json:"arch"`
	IsPrivileged bool     `json:"isPrivileged"`
	RuntimeMode  string   `json:"runtimeMode"`
}

type RequestOptions struct {
	FreshConnection bool
	Proxy           string
	Insecure        bool
	Redirect        bool
	Timeout         int
	CancelId        string
	FileField       string
	Sha256          string
	Stream          string
}

type ExecOptions struct {
	PidFile           string
	LogFile           string
	StopOutputKeyword string
	WorkingDirectory  string
	Env               map[string]string
}

type Range struct {
	Start *int64
	End   *int64
}

type RelatedConfigFile struct {
	Path    string
	Content string
}

type IOOptions struct {
	Related        []RelatedConfigFile
	ExpectedSHA256 string // Empty disables the check; "missing" requires an absent file.
	Mode           string // Binary / Text
	Range          string // "start-end" / "start-" / "-end"
}

type FlagResult struct {
	Flag bool   `json:"flag"`
	Data string `json:"data"`
}

type ServerOptions struct {
	Cert          string
	Key           string
	StaticPath    string
	StaticRoute   string
	StaticHeaders map[string]string
	UploadPath    string
	UploadRoute   string
	UploadHeaders map[string]string
	MaxUploadSize int64
}

type NetOptions struct {
	Mode    string // Binary / Text
	Timeout int
}

type HTTPResult struct {
	Flag    bool        `json:"flag"`
	Status  int         `json:"status"`
	Headers http.Header `json:"headers"`
	Body    string      `json:"body"`
}

type AppConfig struct {
	AutoStartKernel bool           `yaml:"autoStartKernel"`
	Log             LogSettings    `yaml:"log"`
	Kernel          KernelSettings `yaml:"kernel"`
}

type LogSettings struct {
	RetentionDays int `yaml:"retentionDays"`
}

type KernelRuntimeConfig struct {
	Env  map[string]string `yaml:"env"`
	Args []string          `yaml:"args"`
}

type KernelSettings struct {
	Branch string              `yaml:"branch"`
	Main   KernelRuntimeConfig `yaml:"main"`
	Alpha  KernelRuntimeConfig `yaml:"alpha"`
}

type WriteTracker struct {
	Total          int64
	Progress       int64
	LastEmitted    int64
	EmitThreshold  int64
	ProgressChange string
	App            *App
}
