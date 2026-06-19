package bridge

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLogFilePathUsesCategoryPrefixAndDate(t *testing.T) {
	tmp := t.TempDir()
	previousBasePath := Env.BasePath
	Env.BasePath = tmp
	t.Cleanup(func() { Env.BasePath = previousBasePath })

	day := time.Date(2026, 6, 19, 10, 0, 0, 0, time.Local)
	path := logFilePath("core", day)

	expected := filepath.ToSlash(filepath.Join(tmp, "logs", "core-2026-06-19.log"))
	if path != expected {
		t.Fatalf("expected %s, got %s", expected, path)
	}
}

func TestNormalizeLogRetentionDaysUsesDefaultForNonPositiveValues(t *testing.T) {
	for _, days := range []int{-1, 0} {
		if got := normalizeLogRetentionDays(days); got != defaultLogRetentionDays {
			t.Fatalf("normalizeLogRetentionDays(%d) = %d, want %d", days, got, defaultLogRetentionDays)
		}
	}
	if got := normalizeLogRetentionDays(30); got != 30 {
		t.Fatalf("normalizeLogRetentionDays(30) = %d, want 30", got)
	}
}

func TestCleanupExpiredLogsRemovesOnlyOldManagedLogs(t *testing.T) {
	tmp := t.TempDir()
	previousBasePath := Env.BasePath
	Env.BasePath = tmp
	t.Cleanup(func() { Env.BasePath = previousBasePath })

	logsDir := filepath.Join(tmp, "logs")
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	files := []string{
		"app-2026-06-17.log",
		"scheduledtasks-2026-06-17.log",
		"core-2026-06-18.log",
		"taskworker-2026-06-19.log",
		"notes-2026-06-17.log",
	}
	for _, file := range files {
		if err := os.WriteFile(filepath.Join(logsDir, file), []byte(file), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	now := time.Date(2026, 6, 19, 12, 0, 0, 0, time.Local)
	if err := cleanupExpiredLogs(1, now); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(logsDir, "app-2026-06-17.log")); !os.IsNotExist(err) {
		t.Fatalf("expected old managed app log to be removed, got err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(logsDir, "scheduledtasks-2026-06-17.log")); !os.IsNotExist(err) {
		t.Fatalf("expected old managed scheduled task log to be removed, got err=%v", err)
	}
	for _, file := range []string{"core-2026-06-18.log", "taskworker-2026-06-19.log", "notes-2026-06-17.log"} {
		if _, err := os.Stat(filepath.Join(logsDir, file)); err != nil {
			t.Fatalf("expected %s to remain: %v", file, err)
		}
	}
}

func TestExecBackgroundAppendsManagedLogFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-based fake process is only used on non-Windows platforms")
	}

	tmp := t.TempDir()
	previousBasePath := Env.BasePath
	Env.BasePath = tmp
	t.Cleanup(func() { Env.BasePath = previousBasePath })

	logPath := filepath.Join("logs", "core-2026-06-19.log")
	absLogPath := filepath.Join(tmp, logPath)
	if err := os.MkdirAll(filepath.Dir(absLogPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absLogPath, []byte("first\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	result := app.ExecBackground("/bin/sh", []string{"-c", "printf 'second\n'"}, "", "", ExecOptions{LogFile: logPath})
	if !result.Flag {
		t.Fatalf("exec failed: %s", result.Data)
	}

	pid, err := strconv.Atoi(strings.TrimSpace(result.Data))
	if err != nil {
		t.Fatalf("parse pid: %v", err)
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		t.Fatalf("find process: %v", err)
	}
	_ = waitForProcessExitWithTimeout(process, 2)

	content, err := os.ReadFile(absLogPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "first\nsecond\n" {
		t.Fatalf("expected log file to be appended, got %q", string(content))
	}
}

func TestExecBackgroundCleansExpiredManagedLogs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-based fake process is only used on non-Windows platforms")
	}

	tmp := t.TempDir()
	previousBasePath := Env.BasePath
	previousConfig := Config
	Env.BasePath = tmp
	Config = &AppConfig{Log: LogSettings{RetentionDays: 1}}
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
		Config = previousConfig
	})

	logsDir := filepath.Join(tmp, "logs")
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	oldDay := beginningOfDay(time.Now()).AddDate(0, 0, -2).Format("2006-01-02")
	oldLog := filepath.Join(logsDir, "core-"+oldDay+".log")
	if err := os.WriteFile(oldLog, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	result := app.ExecBackground("/bin/sh", []string{"-c", "printf 'new\n'"}, "", "", ExecOptions{LogFile: logFilePath("core", time.Now())})
	if !result.Flag {
		t.Fatalf("exec failed: %s", result.Data)
	}

	pid, err := strconv.Atoi(strings.TrimSpace(result.Data))
	if err != nil {
		t.Fatalf("parse pid: %v", err)
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		t.Fatalf("find process: %v", err)
	}
	_ = waitForProcessExitWithTimeout(process, 2)

	if _, err := os.Stat(oldLog); !os.IsNotExist(err) {
		t.Fatalf("expected old managed core log to be removed, got err=%v", err)
	}
}
