package bridge

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestStartHeadlessCoreIfNeededStartsConfiguredCore(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-based fake core is only used on non-Windows platforms")
	}

	tempDir := t.TempDir()
	prevBasePath := Env.BasePath
	prevConfig := Config
	t.Cleanup(func() {
		Env.BasePath = prevBasePath
		Config = prevConfig
	})

	Env.BasePath = tempDir
	Config = &AppConfig{
		AutoStartKernel: true,
		Kernel: KernelSettings{
			Branch: "main",
			Main: KernelRuntimeConfig{
				Args: []string{
					"run",
					"-c",
					"$APP_BASE_PATH/$CORE_BASE_PATH/config.json",
					"-D",
					"$APP_BASE_PATH/$CORE_BASE_PATH",
				},
			},
		},
	}

	coreDir := filepath.Join(tempDir, "data", "sing-box")
	if err := os.MkdirAll(coreDir, 0o755); err != nil {
		t.Fatalf("create core dir: %v", err)
	}

	if err := os.WriteFile(
		filepath.Join(coreDir, "config.json"),
		[]byte(`{"experimental":{"clash_api":{"external_controller":"127.0.0.1:29999"}}}`),
		0o644,
	); err != nil {
		t.Fatalf("write config: %v", err)
	}

	corePath := filepath.Join(coreDir, "sing-box")
	if err := os.WriteFile(corePath, []byte("#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"), 0o755); err != nil {
		t.Fatalf("write fake core: %v", err)
	}

	app := NewApp()
	if err := app.startHeadlessCoreIfNeeded(); err != nil {
		t.Fatalf("start headless core: %v", err)
	}

	pidBytes, err := os.ReadFile(filepath.Join(coreDir, "pid.txt"))
	if err != nil {
		t.Fatalf("read pid file: %v", err)
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
	if err != nil {
		t.Fatalf("parse pid: %v", err)
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		t.Fatalf("find process: %v", err)
	}
	t.Cleanup(func() {
		_ = process.Kill()
		_ = waitForProcessExitWithTimeout(process, 1)
	})

	alive, err := IsProcessAlive(process)
	if err != nil {
		t.Fatalf("check process: %v", err)
	}
	if !alive {
		t.Fatal("expected fake core process to still be running")
	}
}

func TestExecBackgroundReusesExistingCoreProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-based fake core is only used on non-Windows platforms")
	}

	tempDir := t.TempDir()
	prevBasePath := Env.BasePath
	t.Cleanup(func() {
		Env.BasePath = prevBasePath
	})

	Env.BasePath = tempDir

	coreDir := filepath.Join(tempDir, "data", "sing-box")
	if err := os.MkdirAll(coreDir, 0o755); err != nil {
		t.Fatalf("create core dir: %v", err)
	}

	corePath := filepath.Join(coreDir, "sing-box")
	if err := os.WriteFile(corePath, []byte("#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"), 0o755); err != nil {
		t.Fatalf("write fake core: %v", err)
	}

	app := NewApp()
	first := app.ExecBackground("data/sing-box/sing-box", nil, "", "", ExecOptions{
		PidFile: headlessCorePidFilePath,
		LogFile: headlessCoreLogFilePath,
	})
	if !first.Flag {
		t.Fatalf("first start failed: %s", first.Data)
	}

	second := app.ExecBackground("data/sing-box/sing-box", nil, "", "", ExecOptions{
		PidFile: headlessCorePidFilePath,
		LogFile: headlessCoreLogFilePath,
	})
	if !second.Flag {
		t.Fatalf("second start failed: %s", second.Data)
	}

	firstPID, err := strconv.Atoi(strings.TrimSpace(first.Data))
	if err != nil {
		t.Fatalf("parse first pid: %v", err)
	}
	secondPID, err := strconv.Atoi(strings.TrimSpace(second.Data))
	if err != nil {
		t.Fatalf("parse second pid: %v", err)
	}

	if firstPID != secondPID {
		t.Fatalf("expected second start to reuse pid %d, got %d", firstPID, secondPID)
	}

	process, err := os.FindProcess(firstPID)
	if err != nil {
		t.Fatalf("find process: %v", err)
	}
	t.Cleanup(func() {
		_ = process.Kill()
		_ = waitForProcessExitWithTimeout(process, 1)
	})
}
