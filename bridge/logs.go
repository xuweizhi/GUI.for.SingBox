package bridge

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
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
	mu            sync.Mutex
	category      string
	current       string
	file          *os.File
	retentionDays int
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
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func beginningOfDay(t time.Time) time.Time {
	year, month, day := t.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, t.Location())
}

func newDailyLogWriter(category string, retentionDays int) *dailyLogWriter {
	return &dailyLogWriter{
		category:      category,
		retentionDays: normalizeLogRetentionDays(retentionDays),
	}
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
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.WriteString(line + "\n"); err != nil {
		return err
	}
	return cleanupExpiredLogs(Config.Log.RetentionDays, time.Now())
}

func (w *dailyLogWriter) rotate(path string, now time.Time) error {
	if w.file != nil {
		_ = w.file.Close()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	w.file = file
	w.current = path
	return cleanupExpiredLogs(w.retentionDays, now)
}

func configureAppLogging() {
	retentionDays := normalizeLogRetentionDays(Config.Log.RetentionDays)
	writer := newDailyLogWriter("app", retentionDays)
	log.SetOutput(io.MultiWriter(os.Stderr, writer))
	log.Printf("Logging to %s with retentionDays=%s", logFilePath("app", time.Now()), strconv.Itoa(retentionDays))
}
