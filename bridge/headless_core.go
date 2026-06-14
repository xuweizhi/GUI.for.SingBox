package bridge

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
)

const (
	headlessCoreWorkingDirectory = "data/sing-box"
	headlessCorePidFilePath      = headlessCoreWorkingDirectory + "/pid.txt"
	headlessCoreLogFilePath      = headlessCoreWorkingDirectory + "/sing-box.log"
	headlessCoreConfigFilePath   = headlessCoreWorkingDirectory + "/config.json"
)

type headlessCoreStartupSpec struct {
	path           string
	args           []string
	env            map[string]string
	controllerPort uint32
}

type headlessCoreConfig struct {
	Experimental struct {
		ClashAPI struct {
			ExternalController string `json:"external_controller"`
		} `json:"clash_api"`
	} `json:"experimental"`
}

func (a *App) startHeadlessCoreIfNeeded() error {
	spec, err := loadHeadlessCoreStartupSpec()
	if err != nil {
		return err
	}
	if spec == nil {
		return nil
	}

	if pid, ok := a.findExistingHeadlessCore(spec.controllerPort); ok {
		log.Printf("Headless core already running with PID %d", pid)
		if err := os.WriteFile(resolvePath(headlessCorePidFilePath), []byte(strconv.Itoa(pid)), 0644); err != nil {
			log.Printf("Failed to write headless core PID file: %v", err)
		}
		return nil
	}

	result := a.ExecBackground(spec.path, spec.args, "", "", ExecOptions{
		PidFile: headlessCorePidFilePath,
		LogFile: headlessCoreLogFilePath,
		Env:     spec.env,
	})
	if !result.Flag {
		return fmt.Errorf("start headless core: %s", result.Data)
	}

	log.Printf("Headless core started with PID %s", result.Data)
	return nil
}

func loadHeadlessCoreStartupSpec() (*headlessCoreStartupSpec, error) {
	if !Config.AutoStartKernel {
		return nil, nil
	}

	corePath := resolvePath(headlessCoreWorkingDirectory + "/" + getHeadlessCoreFileName())
	if _, err := os.Stat(corePath); err != nil {
		return nil, fmt.Errorf("headless core auto-start skipped: core executable not found at %s", corePath)
	}

	configPath := resolvePath(headlessCoreConfigFilePath)
	configData, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("headless core auto-start skipped: core config not found at %s", configPath)
	}

	controllerPort := uint32(20123)
	var coreConfig headlessCoreConfig
	if err := json.Unmarshal(configData, &coreConfig); err == nil {
		controllerPort = parseControllerPort(coreConfig.Experimental.ClashAPI.ExternalController, 20123)
	}

	runtimeConfig := getHeadlessKernelRuntimeConfig()
	return &headlessCoreStartupSpec{
		path:           headlessCoreWorkingDirectory + "/" + getHeadlessCoreFileName(),
		args:           processHeadlessCoreArgs(runtimeConfig.Args),
		env:            processHeadlessCoreEnv(runtimeConfig.Env),
		controllerPort: controllerPort,
	}, nil
}

func (a *App) findExistingHeadlessCore(port uint32) (int, bool) {
	result := a.FindListeningProcess(port)
	if !result.Flag {
		return 0, false
	}

	pid, err := strconv.Atoi(result.Data)
	if err != nil || pid <= 0 {
		return 0, false
	}

	processInfo := a.ProcessInfo(int32(pid))
	if !processInfo.Flag || !strings.HasPrefix(processInfo.Data, "sing-box") {
		return 0, false
	}

	return pid, true
}

func getHeadlessKernelRuntimeConfig() KernelRuntimeConfig {
	runtimeConfig := Config.Kernel.Main
	if strings.EqualFold(Config.Kernel.Branch, "alpha") {
		runtimeConfig = Config.Kernel.Alpha
	}
	if len(runtimeConfig.Args) == 0 {
		runtimeConfig.Args = []string{
			"run",
			"--disable-color",
			"-c",
			"$APP_BASE_PATH/$CORE_BASE_PATH/config.json",
			"-D",
			"$APP_BASE_PATH/$CORE_BASE_PATH",
		}
	}
	if runtimeConfig.Env == nil {
		runtimeConfig.Env = map[string]string{}
	}
	return runtimeConfig
}

func getHeadlessCoreFileName() string {
	suffix := map[string]string{"windows": ".exe", "linux": "", "darwin": ""}[Env.OS]
	latest := ""
	if strings.EqualFold(Config.Kernel.Branch, "alpha") {
		latest = "-latest"
	}
	return "sing-box" + latest + suffix
}

func processHeadlessCoreArgs(args []string) []string {
	processed := make([]string, len(args))
	for i, arg := range args {
		processed[i] = processHeadlessCoreMagicVariables(arg)
	}
	return processed
}

func processHeadlessCoreEnv(env map[string]string) map[string]string {
	processed := make(map[string]string, len(env))
	for key, value := range env {
		processed[key] = processHeadlessCoreMagicVariables(value)
	}
	return processed
}

func processHeadlessCoreMagicVariables(value string) string {
	replacer := strings.NewReplacer(
		"$APP_BASE_PATH", Env.BasePath,
		"$CORE_BASE_PATH", headlessCoreWorkingDirectory,
	)
	return replacer.Replace(value)
}

func parseControllerPort(controller string, fallback uint32) uint32 {
	trimmed := strings.TrimSpace(controller)
	if trimmed == "" {
		return fallback
	}

	if strings.HasPrefix(trimmed, "[") {
		match := strings.TrimPrefix(trimmed, "[")
		closing := strings.LastIndex(match, "]")
		if closing == -1 {
			return fallback
		}
		rest := strings.TrimPrefix(match[closing:], "]")
		if strings.HasPrefix(rest, ":") {
			if port, err := strconv.ParseUint(strings.TrimPrefix(rest, ":"), 10, 16); err == nil {
				return uint32(port)
			}
		}
		return fallback
	}

	separatorIndex := strings.LastIndex(trimmed, ":")
	if separatorIndex == -1 {
		return fallback
	}

	port, err := strconv.ParseUint(strings.TrimSpace(trimmed[separatorIndex+1:]), 10, 16)
	if err != nil {
		return fallback
	}
	return uint32(port)
}
