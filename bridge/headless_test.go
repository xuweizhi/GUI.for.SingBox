package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHeadlessAuthAuthorizeAcceptsCookieBeforeQueryToken(t *testing.T) {
	auth := &headlessAuth{token: "webui-token"}
	req := httptest.NewRequest(
		http.MethodGet,
		"/__webui/core/ws/127.0.0.1:20123/traffic?token=core-secret",
		nil,
	)
	req.AddCookie(&http.Cookie{
		Name:  webUITokenCookie,
		Value: "webui-token",
	})

	recorder := httptest.NewRecorder()
	if ok := auth.authorize(recorder, req); !ok {
		t.Fatal("expected request with valid cookie to be authorized")
	}

	cookies := recorder.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != webUITokenCookie || cookies[0].Value != "webui-token" {
		t.Fatal("expected authorization to refresh the webui auth cookie")
	}
}

func TestHandleRPCCallRejectsMissingRemoveArgumentWithoutDeletingBase(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = previousBasePath })

	marker := filepath.Join(Env.BasePath, "keep.txt")
	if err := os.WriteFile(marker, []byte("keep"), 0o600); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, webUIRPCEndpoint, strings.NewReader(`{"method":"RemoveFile","args":[]}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	(&App{}).handleRPCCall(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("missing RPC argument removed application data: %v", err)
	}
}

func TestHeadlessSessionLoginIgnoresExistingCookieWhenTokenIsWrong(t *testing.T) {
	auth := &headlessAuth{token: "correct-token"}
	req := httptest.NewRequest(http.MethodPost, webUISessionEndpoint, strings.NewReader(`{"token":"wrong-token"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: webUITokenCookie, Value: "correct-token"})
	recorder := httptest.NewRecorder()

	auth.handleSession(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, recorder.Code)
	}
}

func TestHeadlessSessionLogoutExpiresCookie(t *testing.T) {
	auth := &headlessAuth{token: "correct-token"}
	req := httptest.NewRequest(http.MethodDelete, webUISessionEndpoint, nil)
	recorder := httptest.NewRecorder()

	auth.handleSession(recorder, req)

	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != webUITokenCookie || cookies[0].MaxAge >= 0 {
		t.Fatalf("expected an expired WebUI session cookie, got %+v", cookies)
	}
}

func TestSameOriginOnlyRejectsCrossSiteRequests(t *testing.T) {
	called := false
	handler := sameOriginOnly(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:18080/__webui/api/rpc", nil)
	req.Header.Set("Origin", "https://attacker.example")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden || called {
		t.Fatalf("expected cross-site request to be rejected, status=%d called=%v", recorder.Code, called)
	}
}

func TestResolveHeadlessTokenPersistsGeneratedTokenSecurely(t *testing.T) {
	previousBasePath := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = previousBasePath })

	first, tokenPath, err := resolveHeadlessToken("")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	second, secondPath, err := resolveHeadlessToken("")
	if err != nil {
		t.Fatalf("reload token: %v", err)
	}
	if first == "" || first != second || tokenPath != secondPath {
		t.Fatalf("token was not persisted consistently")
	}
	info, err := os.Stat(tokenPath)
	if err != nil {
		t.Fatalf("stat token: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("token mode = %o, want 600", info.Mode().Perm())
	}
}

func TestHeadlessAuthAuthorizeRejectsQueryTokenWithoutSession(t *testing.T) {
	auth := &headlessAuth{token: "webui-token"}
	req := httptest.NewRequest(http.MethodGet, "/__webui/api/rpc?token=webui-token", nil)

	recorder := httptest.NewRecorder()
	if ok := auth.authorize(recorder, req); ok {
		t.Fatal("expected query-string token to be rejected")
	}
	if recorder.Header().Get(webUIAuthHeader) != "required" {
		t.Fatal("expected WebUI auth challenge header")
	}
}

func TestHeadlessAuthAuthorizeRejectsMismatchedToken(t *testing.T) {
	auth := &headlessAuth{token: "webui-token"}
	req := httptest.NewRequest(http.MethodGet, "/__webui/core/ws/127.0.0.1:20123/traffic?token=core-secret", nil)

	recorder := httptest.NewRecorder()
	if ok := auth.authorize(recorder, req); ok {
		t.Fatal("expected request with mismatched token to be rejected")
	}

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, recorder.Code)
	}
}

func TestHeadlessEventStreamStopsDuringApplicationShutdown(t *testing.T) {
	for _, test := range []struct {
		name     string
		shutdown func(cancel context.CancelFunc, runtime *HeadlessRuntime)
	}{
		{
			name: "signal context",
			shutdown: func(cancel context.CancelFunc, _ *HeadlessRuntime) {
				cancel()
			},
		},
		{
			name: "runtime request",
			shutdown: func(_ context.CancelFunc, runtime *HeadlessRuntime) {
				close(runtime.shutdown)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			runtime := &HeadlessRuntime{shutdown: make(chan struct{})}
			app := NewApp()
			app.Ctx = ctx
			app.Headless = runtime

			done := make(chan struct{})
			go func() {
				defer close(done)
				app.handleEventStream(
					httptest.NewRecorder(),
					httptest.NewRequest(http.MethodGet, webUISSEEndpoint, nil),
				)
			}()

			test.shutdown(cancel, runtime)
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("event stream did not stop during application shutdown")
			}
		})
	}
}

func TestWriteHeadlessJSONBuffersEncodeFailures(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeHeadlessJSON(recorder, map[string]any{
		"bad": make(chan int),
	})

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, recorder.Code)
	}
	if recorder.Body.Len() == 0 {
		t.Fatal("expected encode failure body to be written")
	}
}

func TestHandleRPCCallSupportsSystemProxyMethods(t *testing.T) {
	originalOS := Env.OS
	Env.OS = "test"
	t.Cleanup(func() {
		Env.OS = originalOS
	})

	tests := []struct {
		name string
		body string
	}{
		{
			name: "get system proxy",
			body: `{"method":"GetSystemProxy","args":[]}`,
		},
		{
			name: "get system proxy bypass",
			body: `{"method":"GetSystemProxyBypass","args":[]}`,
		},
	}

	app := &App{}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, webUIRPCEndpoint, strings.NewReader(test.body))
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			app.handleRPCCall(recorder, req)

			if recorder.Code != http.StatusOK {
				t.Fatalf("expected status %d, got %d: %s", http.StatusOK, recorder.Code, recorder.Body.String())
			}

			var result FlagResult
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
				t.Fatalf("decode RPC response: %v", err)
			}
			if !result.Flag {
				t.Fatalf("expected successful RPC response, got %+v", result)
			}
		})
	}
}
