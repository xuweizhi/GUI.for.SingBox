package bridge

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUnzipGZFileCreatesParentDirectories(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	sourcePath := filepath.Join(Env.BasePath, "source.gz")
	file, err := os.Create(sourcePath)
	if err != nil {
		t.Fatalf("create gzip source: %v", err)
	}
	writer := gzip.NewWriter(file)
	if _, err := writer.Write([]byte("hello world")); err != nil {
		t.Fatalf("write gzip payload: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close gzip writer: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close gzip file: %v", err)
	}

	app := &App{}
	result := app.UnzipGZFile("source.gz", "nested/output/data.txt")
	if !result.Flag {
		t.Fatalf("UnzipGZFile failed: %s", result.Data)
	}

	content, err := os.ReadFile(filepath.Join(Env.BasePath, "nested/output/data.txt"))
	if err != nil {
		t.Fatalf("read extracted file: %v", err)
	}
	if string(content) != "hello world" {
		t.Fatalf("extracted content = %q, want %q", string(content), "hello world")
	}
}

func TestUnzipZIPFileReportsPartialFailures(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	archivePath := filepath.Join(Env.BasePath, "archive.zip")
	createZIPArchive(t, archivePath, map[string]string{
		"ok.txt":            "ok",
		"blocked/child.txt": "blocked",
	})

	outputDir := filepath.Join(Env.BasePath, "output")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatalf("mkdir output: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outputDir, "blocked"), []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("prepare blocking file: %v", err)
	}

	app := &App{}
	result := app.UnzipZIPFile("archive.zip", "output")
	if result.Flag {
		t.Fatal("expected ZIP extraction to report partial failure")
	}
	if !strings.Contains(result.Data, "blocked/child.txt") {
		t.Fatalf("expected ZIP failure message to mention blocked entry, got %q", result.Data)
	}

	content, err := os.ReadFile(filepath.Join(outputDir, "ok.txt"))
	if err != nil {
		t.Fatalf("read successfully extracted ZIP file: %v", err)
	}
	if string(content) != "ok" {
		t.Fatalf("ZIP extracted content = %q, want %q", string(content), "ok")
	}
}

func TestUnzipTarGZFileReportsPartialFailures(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() {
		Env.BasePath = previousBasePath
	})

	archivePath := filepath.Join(Env.BasePath, "archive.tar.gz")
	createTarGZArchive(t, archivePath, map[string]string{
		"ok.txt":            "ok",
		"blocked/child.txt": "blocked",
	})

	outputDir := filepath.Join(Env.BasePath, "output")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatalf("mkdir output: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outputDir, "blocked"), []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("prepare blocking file: %v", err)
	}

	app := &App{}
	result := app.UnzipTarGZFile("archive.tar.gz", "output")
	if result.Flag {
		t.Fatal("expected tar.gz extraction to report partial failure")
	}
	if !strings.Contains(result.Data, "blocked/child.txt") {
		t.Fatalf("expected tar.gz failure message to mention blocked entry, got %q", result.Data)
	}

	content, err := os.ReadFile(filepath.Join(outputDir, "ok.txt"))
	if err != nil {
		t.Fatalf("read successfully extracted tar file: %v", err)
	}
	if string(content) != "ok" {
		t.Fatalf("tar extracted content = %q, want %q", string(content), "ok")
	}
}

func createZIPArchive(t *testing.T, path string, files map[string]string) {
	t.Helper()

	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create zip archive: %v", err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip archive: %v", err)
	}
}

func createTarGZArchive(t *testing.T, path string, files map[string]string) {
	t.Helper()

	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create tar.gz archive: %v", err)
	}
	defer file.Close()

	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		body := []byte(content)
		header := &tar.Header{
			Name: name,
			Mode: 0o644,
			Size: int64(len(body)),
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatalf("write tar header %s: %v", name, err)
		}
		if _, err := tarWriter.Write(body); err != nil {
			t.Fatalf("write tar body %s: %v", name, err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatalf("close tar writer: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close gzip writer: %v", err)
	}
}
