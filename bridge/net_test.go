package bridge

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRequestsTreatsNonSuccessfulStatusAsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "upstream denied", http.StatusUnauthorized)
	}))
	defer server.Close()

	result := (&App{}).Requests("GET", server.URL, nil, "", RequestOptions{})
	if result.Flag || result.Status != http.StatusUnauthorized {
		t.Fatalf("expected HTTP failure result, got %+v", result)
	}
}

func TestDownloadDoesNotOverwriteTargetOnHTTPFailure(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = previousBasePath })

	target := filepath.Join(Env.BasePath, "data", "ruleset.json")
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		t.Fatalf("mkdir target: %v", err)
	}
	if err := os.WriteFile(target, []byte("original"), 0o600); err != nil {
		t.Fatalf("write target: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer server.Close()

	result := (&App{}).Download("GET", server.URL, target, nil, "", RequestOptions{})
	if result.Flag || result.Status != http.StatusNotFound {
		t.Fatalf("expected HTTP failure result, got %+v", result)
	}
	content, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(content) != "original" {
		t.Fatalf("target was overwritten with failed response: %q", string(content))
	}
}
