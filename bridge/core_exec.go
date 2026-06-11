package bridge

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

var coreStartMu sync.Mutex

func isCoreExecRequest(path string, options ExecOptions) bool {
	if Env.RuntimeMode != RuntimeModeWebUI {
		return false
	}
	if filepath.ToSlash(filepath.Clean(options.PidFile)) != filepath.ToSlash(filepath.Clean(headlessCorePidFilePath)) {
		return false
	}
	if filepath.ToSlash(filepath.Clean(options.LogFile)) != filepath.ToSlash(filepath.Clean(headlessCoreLogFilePath)) {
		return false
	}
	return strings.HasPrefix(filepath.Base(resolvePath(path)), "sing-box")
}

func (a *App) reuseExistingCoreProcess(path string, args []string, endEvent string, pidPath string) (FlagResult, bool) {
	if pid, ok := existingCorePIDFromFile(path, pidPath); ok {
		log.Printf("Reusing existing core from pid file with PID %d", pid)
		if endEvent != "" {
			watchExistingCoreExit(a, pid, endEvent, pidPath)
		}
		return FlagResult{true, strconv.Itoa(pid)}, true
	}

	if pid, ok := a.existingCorePIDFromController(path, args); ok {
		if pidPath != "" {
			_ = os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0644)
		}
		log.Printf("Reusing existing core from controller port with PID %d", pid)
		if endEvent != "" {
			watchExistingCoreExit(a, pid, endEvent, pidPath)
		}
		return FlagResult{true, strconv.Itoa(pid)}, true
	}

	return FlagResult{}, false
}

func existingCorePIDFromFile(path string, pidPath string) (int, bool) {
	if strings.TrimSpace(pidPath) == "" {
		return 0, false
	}

	pidBytes, err := os.ReadFile(pidPath)
	if err != nil {
		return 0, false
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
	if err != nil || pid <= 0 {
		return 0, false
	}

	processHandle, err := os.FindProcess(pid)
	if err != nil {
		return 0, false
	}

	alive, err := IsProcessAlive(processHandle)
	if err != nil || !alive {
		return 0, false
	}

	if !processMatchesExecutable(int32(pid), path) {
		return 0, false
	}

	return pid, true
}

func (a *App) existingCorePIDFromController(path string, args []string) (int, bool) {
	configPath := coreConfigPathFromArgs(args)
	if configPath == "" {
		return 0, false
	}

	controllerPort := controllerPortFromConfig(configPath, 20123)
	if controllerPort == 0 {
		return 0, false
	}

	result := a.FindListeningProcess(controllerPort)
	if !result.Flag {
		return 0, false
	}

	pid, err := strconv.Atoi(result.Data)
	if err != nil || pid <= 0 {
		return 0, false
	}

	if !processMatchesExecutable(int32(pid), path) {
		return 0, false
	}

	return pid, true
}

func coreConfigPathFromArgs(args []string) string {
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "-c", "--config":
			if index+1 < len(args) {
				return resolvePath(args[index+1])
			}
		}
	}

	return ""
}

func controllerPortFromConfig(configPath string, fallback uint32) uint32 {
	configData, err := os.ReadFile(configPath)
	if err != nil {
		return fallback
	}

	var coreConfig headlessCoreConfig
	if err := json.Unmarshal(configData, &coreConfig); err != nil {
		return fallback
	}

	return parseControllerPort(coreConfig.Experimental.ClashAPI.ExternalController, fallback)
}

func processMatchesExecutable(pid int32, expectedPath string) bool {
	proc, err := process.NewProcess(pid)
	if err != nil {
		return false
	}

	expectedPath = normalizeProcessPath(resolvePath(expectedPath))
	expectedBase := normalizeProcessPath(filepath.Base(expectedPath))

	matches := func(value string) bool {
		normalized := normalizeProcessPath(value)
		if normalized == "" {
			return false
		}

		if normalized == expectedPath || normalized == expectedBase {
			return true
		}

		return normalizeProcessPath(filepath.Base(normalized)) == expectedBase
	}

	if name, err := proc.Name(); err == nil && matches(name) {
		return true
	}

	if exePath, err := proc.Exe(); err == nil && matches(exePath) {
		return true
	}

	cmdline, err := proc.CmdlineSlice()
	if err != nil {
		return false
	}

	for _, value := range cmdline {
		if matches(value) {
			return true
		}
	}

	return false
}

func normalizeProcessPath(value string) string {
	trimmed := strings.TrimSpace(strings.Trim(value, `"'`))
	if trimmed == "" {
		return ""
	}
	return filepath.ToSlash(filepath.Clean(trimmed))
}

func watchExistingCoreExit(a *App, pid int, endEvent string, pidPath string) {
	go func() {
		processHandle, err := os.FindProcess(pid)
		if err != nil {
			a.EventsEmit(endEvent, err.Error())
			return
		}

		if err := waitForProcessExit(processHandle); err != nil {
			a.EventsEmit(endEvent, err.Error())
			return
		}

		if pidPath != "" {
			_ = os.Remove(pidPath)
		}
		a.EventsEmit(endEvent)
	}()
}

func waitForProcessExit(processHandle *os.Process) error {
	interval := 10 * time.Millisecond
	maxInterval := 1 * time.Second

	for {
		alive, err := IsProcessAlive(processHandle)
		if err != nil {
			return fmt.Errorf("failed to check status of process %d: %w", processHandle.Pid, err)
		}
		if !alive {
			return nil
		}

		time.Sleep(interval)
		interval = min(time.Duration(interval*2), maxInterval)
	}
}
