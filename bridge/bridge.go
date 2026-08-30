package bridge

import (
	"context"
	"embed"
	"log"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

var Config = &AppConfig{}

var AppVersion = "v1.26.1"

var Env = &EnvResult{
	IsStartup:   true,
	AppVersion:  AppVersion,
	OS:          runtime.GOOS,
	ARCH:        runtime.GOARCH,
	RuntimeMode: RuntimeModeWebUI,
}

func NewApp() *App {
	return &App{Ctx: context.Background()}
}

func CreateApp(fs embed.FS) *App {
	exePath, err := os.Executable()
	if err != nil {
		panic(err)
	}

	Env.BasePath = filepath.ToSlash(filepath.Dir(exePath))
	Env.AppName = filepath.Base(exePath)
	Env.Args = append([]string(nil), os.Args[1:]...)

	if priv, err := IsPrivileged(); err == nil {
		Env.IsPrivileged = priv
	}

	app := NewApp()
	extractEmbeddedFiles(fs)
	loadConfig()
	configureAppLogging()
	return app
}

func (a *App) IsStartup() bool {
	if Env.IsStartup {
		Env.IsStartup = false
		return true
	}
	return false
}

func (a *App) RestartApp() FlagResult {
	log.Printf("RestartApp")
	exePath := resolvePath(Env.AppName)
	args := append([]string{exePath}, Env.Args...)
	go func() {
		time.Sleep(200 * time.Millisecond)
		a.StopScheduledTaskWorker()
		if err := restartCurrentProcess(exePath, args, os.Environ()); err != nil {
			log.Printf("Failed to restart application: %v", err)
			if workerErr := a.StartScheduledTaskWorker(); workerErr != nil {
				log.Printf("Failed to restore scheduled task worker: %v", workerErr)
			}
		}
	}()
	return FlagResult{true, "Success"}
}

func (a *App) GetEnv() EnvResult {
	log.Printf("GetEnv")
	return EnvResult{
		AppName:      Env.AppName,
		AppVersion:   Env.AppVersion,
		BasePath:     Env.BasePath,
		OS:           Env.OS,
		ARCH:         Env.ARCH,
		IsPrivileged: Env.IsPrivileged,
		RuntimeMode:  RuntimeModeWebUI,
	}
}

func (a *App) GetInterfaces() FlagResult {
	log.Printf("GetInterfaces")
	interfaces, err := net.Interfaces()
	if err != nil {
		return FlagResult{false, err.Error()}
	}

	interfaceNames := make([]string, 0, len(interfaces))
	for _, inter := range interfaces {
		interfaceNames = append(interfaceNames, inter.Name)
	}
	return FlagResult{true, strings.Join(interfaceNames, "|")}
}

func extractEmbeddedFiles(fs embed.FS) {
	workerDst := resolvePath(scheduledTaskWorkerScriptDst)
	proxyUtilsDst := resolvePath(scheduledTaskWorkerProxyUtilsDst)
	extractEmbeddedFile(fs, scheduledTaskWorkerScriptSrc, workerDst)
	extractEmbeddedFile(fs, scheduledTaskWorkerProxyUtilsSrc, proxyUtilsDst)
}

func extractEmbeddedFile(fs embed.FS, srcPath, dstPath string) {
	data, err := fs.ReadFile(srcPath)
	if err != nil {
		log.Printf("Failed to read embedded file [%s]: %v", srcPath, err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(dstPath), os.ModePerm); err != nil {
		log.Printf("Failed to create directory for embedded file [%s]: %v", dstPath, err)
		return
	}
	if err := os.WriteFile(dstPath, data, os.ModePerm); err != nil {
		log.Printf("Failed to write embedded file [%s]: %v", dstPath, err)
	}
}

func loadConfig() {
	b, err := os.ReadFile(resolvePath("data/user.yaml"))
	if err == nil {
		if err := yaml.Unmarshal(b, &Config); err != nil {
			log.Printf("Failed to parse user config: %v", err)
		}
	}
}
