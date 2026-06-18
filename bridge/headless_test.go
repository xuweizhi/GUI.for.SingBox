package bridge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func TestHeadlessAuthAuthorizeAcceptsQueryTokenWithoutCookie(t *testing.T) {
	auth := &headlessAuth{token: "webui-token"}
	req := httptest.NewRequest(http.MethodGet, "/__webui/api/rpc?token=webui-token", nil)

	recorder := httptest.NewRecorder()
	if ok := auth.authorize(recorder, req); !ok {
		t.Fatal("expected request with matching query token to be authorized")
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
		{
			name: "set system proxy",
			body: `{"method":"SetSystemProxy","args":[true,"127.0.0.1:1080","mixed","localhost",["Wi-Fi"]]}`,
		},
	}

	app := &App{}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, webUIRPCEndpoint, strings.NewReader(test.body))
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
