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
	"testing/fstest"
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

func TestCoreProxyPreservesEscapedTag(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/proxies/HK%2F01/delay" || r.URL.Query().Get("timeout") != "1000" {
			t.Errorf("unexpected upstream URI %s", r.RequestURI)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	host := strings.TrimPrefix(upstream.URL, "http://")
	request := httptest.NewRequest("GET", webUICoreEndpoint+host+"/proxies/HK%2F01/delay?timeout=1000", nil)
	response := httptest.NewRecorder()
	NewApp().handleCoreProxy(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("proxy status %d", response.Code)
	}
}

func TestStartupIsConsumedOnceAcrossClients(t *testing.T) {
	app := NewApp()
	results := make(chan bool, 16)
	for range cap(results) {
		go func() { results <- app.IsStartup() }()
	}
	first := 0
	for range cap(results) {
		if <-results {
			first++
		}
	}
	if first != 1 {
		t.Fatalf("%d clients reported startup", first)
	}
}

func TestCoreProxyForwardsControllerAuthorizationOnly(t *testing.T) {
	headers := make(chan http.Header, 2)
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { headers <- r.Header.Clone(); w.WriteHeader(204) }))
	defer controller.Close()
	auth := &headlessAuth{token: "webui-secret"}
	handler := auth.wrap(http.HandlerFunc(NewApp().handleCoreProxy))
	for _, authorization := range []string{"Bearer core-secret", "Bearer webui-secret"} {
		req := httptest.NewRequest("GET", webUICoreEndpoint+strings.TrimPrefix(controller.URL, "http://")+"/configs", nil)
		req.AddCookie(&http.Cookie{Name: webUITokenCookie, Value: auth.token})
		req.Header.Set("Authorization", authorization)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != 204 {
			t.Fatal(response.Code)
		}
		got := <-headers
		if got.Get("Cookie") != "" {
			t.Fatal("web session cookie reached controller")
		}
		want := ""
		if authorization == "Bearer core-secret" {
			want = authorization
		}
		if got.Get("Authorization") != want {
			t.Fatal("incorrect controller authorization")
		}
	}
}

func TestAssetCacheRequiresFingerprint(t *testing.T) {
	files := fstest.MapFS{}
	for _, name := range []string{"index.html", "favicon.ico", "assets/app-Ccc2_Rzs.js"} {
		files[name] = &fstest.MapFile{Data: []byte("content")}
	}
	for _, path := range []string{"/", "/index.html", "/favicon.ico", "/assets/app-Ccc2_Rzs.js"} {
		response := httptest.NewRecorder()
		serveHeadlessAssets(files, response, httptest.NewRequest("GET", path, nil))
		immutable := strings.Contains(response.Header().Get("Cache-Control"), "immutable")
		if immutable != strings.HasPrefix(path, "/assets/") {
			t.Fatal(path, response.Header())
		}
	}
}

func TestCoreProxyEnforcesSameOriginAndStripsCORSHeaders(t *testing.T) {
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer controller.Close()

	auth := &headlessAuth{token: "webui-secret"}
	handler := sameOriginOnly(auth.wrap(http.HandlerFunc(NewApp().handleCoreProxy)))
	host := strings.TrimPrefix(controller.URL, "http://")

	// Cross-origin request must be rejected with 403 even with a valid session cookie
	crossReq := httptest.NewRequest(http.MethodGet, webUICoreEndpoint+host+"/configs", nil)
	crossReq.Host = "127.0.0.1:18080"
	crossReq.Header.Set("Origin", "https://evil.example")
	crossReq.Header.Set("Sec-Fetch-Site", "cross-site")
	crossReq.AddCookie(&http.Cookie{Name: webUITokenCookie, Value: auth.token})
	crossRec := httptest.NewRecorder()
	handler.ServeHTTP(crossRec, crossReq)
	if crossRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-origin core proxy request, got %d", crossRec.Code)
	}

	// Same-origin request succeeds and strips upstream Access-Control-* headers
	sameReq := httptest.NewRequest(http.MethodGet, webUICoreEndpoint+host+"/configs", nil)
	sameReq.Host = "127.0.0.1:18080"
	sameReq.Header.Set("Origin", "http://127.0.0.1:18080")
	sameReq.AddCookie(&http.Cookie{Name: webUITokenCookie, Value: auth.token})
	sameRec := httptest.NewRecorder()
	handler.ServeHTTP(sameRec, sameReq)
	if sameRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for same-origin core proxy request, got %d", sameRec.Code)
	}
	if sameRec.Header().Get("Access-Control-Allow-Origin") != "" || sameRec.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("expected upstream CORS headers to be stripped, got %v", sameRec.Header())
	}
}

func TestStartServerValidatesRoutesWithoutPanicking(t *testing.T) {
	app := NewApp()
	res := app.StartServer("127.0.0.1:0", "srv-invalid-root", ServerOptions{
		StaticPath:  t.TempDir(),
		StaticRoute: "/",
	})
	if res.Flag {
		_ = app.StopServer("srv-invalid-root")
		t.Fatal("expected StaticRoute '/' to be rejected")
	}

	res = app.StartServer("127.0.0.1:0", "srv-dup-route", ServerOptions{
		StaticPath:  t.TempDir(),
		StaticRoute: "/files/",
		UploadPath:  t.TempDir(),
		UploadRoute: "/files/",
	})
	if res.Flag {
		_ = app.StopServer("srv-dup-route")
		t.Fatal("expected duplicate static/upload routes to be rejected")
	}
	if _, exists := serverMap.Load("srv-invalid-root"); exists {
		t.Fatal("failed server remained in serverMap")
	}
	if _, exists := serverMap.Load("srv-dup-route"); exists {
		t.Fatal("failed duplicate-route server remained in serverMap")
	}
}
