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
	if filepath.ToSlash(filepath.Clean(options.PidFile)) != filepath.ToSlash(filepath.Clean(headlessCorePidFilePath)) {
		return false
	}
	logName := filepath.Base(filepath.ToSlash(filepath.Clean(options.LogFile)))
	if filepath.ToSlash(filepath.Clean(options.LogFile)) != filepath.ToSlash(filepath.Clean(headlessCoreLogFilePath)) && !regexpCoreLogName.MatchString(logName) {
		return false
	}
	return strings.HasPrefix(filepath.Base(resolvePath(path)), "sing-box")
}

func (a *App) reuseExistingCoreProcess(path string, args []string, endEvent string, pidPath string) (FlagResult, bool) {
	if pid, ok := existingCorePIDFromFile(path, pidPath, args); ok {
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

func existingCorePIDFromFile(path string, pidPath string, args []string) (int, bool) {
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

	if !processMatchesCore(int32(pid), path, args) {
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

	if !processMatchesCore(int32(pid), path, args) {
		return 0, false
	}

	return pid, true
}

func coreConfigPathFromArgs(args []string) string {
	base, err := os.Getwd()
	if err != nil {
		return ""
	}
	identity, ok := coreProcessIdentity(args, base)
	if !ok {
		return ""
	}
	for _, value := range identity {
		if path, found := strings.CutPrefix(value, "config="); found {
			return path
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

// A process name is not ownership evidence: another installation can use the
// same basename, or the same binary with a different configuration.
func processMatchesExecutable(pid int32, expectedPath string) bool {
	proc, err := process.NewProcess(pid)
	if err != nil {
		return false
	}
	expectedPath = canonicalProcessPath(resolvePath(expectedPath), "")
	if exe, err := proc.Exe(); err == nil && exe != "" {
		return canonicalProcessPath(exe, "") == expectedPath
	}
	// Some platforms cannot expose the executable. Only argv[0] with a complete
	// path is a usable fallback; never search arbitrary arguments or a basename.
	args, err := proc.CmdlineSlice()
	if err != nil || len(args) == 0 || !filepath.IsAbs(args[0]) {
		return false
	}
	return canonicalProcessPath(args[0], "") == expectedPath
}

func canonicalProcessPath(value, base string) string {
	if value == "" {
		return ""
	}
	if !filepath.IsAbs(value) {
		if base == "" {
			return ""
		}
		value = filepath.Join(base, value)
	}
	value = filepath.Clean(value)
	if resolved, err := filepath.EvalSymlinks(value); err == nil {
		value = resolved
	}
	return filepath.ToSlash(value)
}

// Identity includes every supplied config file/directory and the core data
// directory. Unidentified or extra configuration must not be silently adopted.
func coreProcessIdentity(args []string, base string) ([]string, bool) {
	values := map[string][]string{}
	names := map[string]string{"-c": "config", "--config": "config", "-C": "config-directory", "--config-directory": "config-directory", "-D": "directory", "--directory": "directory"}
	for i := 0; i < len(args); i++ {
		if args[i] == "--" {
			break
		}
		option, value, assigned := strings.Cut(args[i], "=")
		// pflag also accepts -c/path and -C/path; ignoring these could hide
		// extra configuration belonging to another installation.
		if len(args[i]) > 2 && args[i][0] == '-' && args[i][1] != '-' {
			if _, known := names[args[i][:2]]; known {
				option = args[i][:2]
				value = strings.TrimPrefix(args[i][2:], "=")
				assigned = true
			}
		}
		name, ok := names[option]
		if !ok {
			continue
		}
		if !assigned {
			i++
			if i >= len(args) {
				return nil, false
			}
			value = args[i]
		}
		if value == "" || (name == "config" && value == "stdin") {
			return nil, false
		}
		values[name] = append(values[name], value)
	}
	if len(values["directory"]) > 1 {
		return nil, false
	}
	directory := base
	if len(values["directory"]) == 1 {
		directory = canonicalProcessPath(values["directory"][0], base)
	}
	identity := []string{}
	if len(values["directory"]) == 1 {
		identity = append(identity, "directory="+directory)
	}
	for _, name := range []string{"config", "config-directory"} {
		for _, value := range values[name] {
			path := canonicalProcessPath(value, directory)
			if path == "" {
				return nil, false
			}
			identity = append(identity, name+"="+path)
		}
	}
	return identity, len(identity) > 0
}

func processMatchesCore(pid int32, expectedPath string, expectedArgs []string) bool {
	if !processMatchesExecutable(pid, expectedPath) {
		return false
	}
	proc, err := process.NewProcess(pid)
	if err != nil {
		return false
	}
	args, err := proc.CmdlineSlice()
	if err != nil || len(args) < 2 {
		return false
	}
	cwd, err := proc.Cwd()
	if err != nil {
		cwd = ""
	}
	base, err := os.Getwd()
	if err != nil {
		return false
	}
	expected, ok := coreProcessIdentity(expectedArgs, base)
	if !ok {
		return false
	}
	actual, ok := coreProcessIdentity(args[1:], cwd)
	match := func(actual []string, valid bool) bool {
		if !valid || len(expected) != len(actual) {
			return false
		}
		for i := range expected {
			if expected[i] != actual[i] {
				return false
			}
		}
		return true
	}
	if match(actual, ok) {
		return true
	}
	// sing-box chdirs before loading its config. A relative -D in argv must
	// not be applied twice to the resulting /proc cwd. Only retry against our
	// launch base when the process is already in the expected data directory.
	for _, identity := range expected {
		if directory, found := strings.CutPrefix(identity, "directory="); found && canonicalProcessPath(cwd, "") == directory {
			actual, ok = coreProcessIdentity(args[1:], base)
			return match(actual, ok)
		}
	}
	return false
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
