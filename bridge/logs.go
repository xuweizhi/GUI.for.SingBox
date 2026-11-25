package bridge

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultLogRetentionDays = 14
	logsDirectory           = "logs"
)

var managedLogPattern = regexp.MustCompile(`^(app|core|taskworker|scheduledtasks)-\d{4}-\d{2}-\d{2}\.log$`)
var regexpCoreLogName = regexp.MustCompile(`^core-\d{4}-\d{2}-\d{2}\.log$`)

type dailyLogWriter struct {
	mu       sync.Mutex
	category string
	current  string
	file     *os.File
}

func normalizeLogRetentionDays(days int) int {
	if days <= 0 {
		return defaultLogRetentionDays
	}
	return days
}

func logFilePath(category string, now time.Time) string {
	name := category + "-" + now.Format("2006-01-02") + ".log"
	return resolvePath(filepath.Join(logsDirectory, name))
}

// The child inherits a real file descriptor and can outlive a WebUI restart.
// Read the file it actually writes, including when it was opened on a previous day.
func activeCoreLogPath() string {
	b, err := os.ReadFile(resolvePath(headlessCorePidFilePath))
	if err != nil {
		return ""
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 1 {
		return ""
	}
	path, err := os.Readlink(fmt.Sprintf("/proc/%d/fd/1", pid))
	if err == nil && (path == resolvePath(headlessCoreLogFilePath) ||
		(filepath.Dir(path) == resolvePath(logsDirectory) && regexpCoreLogName.MatchString(filepath.Base(path)))) {
		return path
	}
	return ""
}

func (a *App) readCoreLog() (string, error) {
	path := activeCoreLogPath()
	if path == "" {
		// After exit, or on systems without procfs, select the last written file.
		candidates, err := filepath.Glob(filepath.Join(resolvePath(logsDirectory), "core-*.log"))
		if err != nil {
			return "", err
		}
		legacy := resolvePath(headlessCoreLogFilePath)
		var newest time.Time
		for _, candidate := range append(candidates, legacy) {
			if candidate != legacy && !regexpCoreLogName.MatchString(filepath.Base(candidate)) {
				continue
			}
			info, err := os.Stat(candidate)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return "", err
			}
			if info.Mode().IsRegular() && info.ModTime().After(newest) {
				newest, path = info.ModTime(), candidate
			}
		}
	}
	if path == "" {
		return "", nil
	}
	result := a.ReadFile(path, IOOptions{Mode: Text, Range: "-4096"})
	if !result.Flag {
		return "", fmt.Errorf("read core log: %s", result.Data)
	}
	return result.Data, nil
}

func cleanupExpiredLogs(retentionDays int, now time.Time) error {
	retentionDays = normalizeLogRetentionDays(retentionDays)
	if retentionDays < 0 {
		return nil
	}

	dir := resolvePath(logsDirectory)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	active := activeCoreLogPath()
	cutoff := beginningOfDay(now).AddDate(0, 0, -retentionDays)
	for _, entry := range entries {
		if entry.IsDir() || !managedLogPattern.MatchString(entry.Name()) {
			continue
		}
		datePart := entry.Name()[len(entry.Name())-len("2006-01-02.log") : len(entry.Name())-len(".log")]
		day, err := time.ParseInLocation("2006-01-02", datePart, time.Local)
		if err != nil || !day.Before(cutoff) {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		if path == active {
			continue
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func beginningOfDay(t time.Time) time.Time {
	year, month, day := t.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, t.Location())
}

func (w *dailyLogWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	now := time.Now()
	path := logFilePath(w.category, now)
	if path != w.current {
		if err := w.rotate(path, now); err != nil {
			return 0, err
		}
	}
	return w.file.Write(p)
}

func appendManagedLog(category string, line string) error {
	path := logFilePath(category, time.Now())
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	defer file.Close()
	if _, err := file.WriteString(line + "\n"); err != nil {
		return err
	}
	return cleanupExpiredLogs(currentConfig().Log.RetentionDays, time.Now())
}

func (w *dailyLogWriter) rotate(path string, now time.Time) error {
	if w.file != nil {
		_ = w.file.Close()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	w.file = file
	w.current = path
	return cleanupExpiredLogs(currentConfig().Log.RetentionDays, now)
}

func secureManagedLogs() error {
	directory := resolvePath(logsDirectory)
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !managedLogPattern.MatchString(entry.Name()) {
			continue
		}
		if err := os.Chmod(filepath.Join(directory, entry.Name()), 0o600); err != nil {
			return err
		}
	}
	return nil
}

func configureAppLogging() {
	if err := secureManagedLogs(); err != nil {
		log.Printf("Failed to secure existing logs: %v", err)
	}
	retentionDays := normalizeLogRetentionDays(currentConfig().Log.RetentionDays)
	writer := &dailyLogWriter{category: "app"}
	log.SetOutput(io.MultiWriter(os.Stderr, writer))
	log.Printf("Logging to %s with retentionDays=%s", logFilePath("app", time.Now()), strconv.Itoa(retentionDays))
}
