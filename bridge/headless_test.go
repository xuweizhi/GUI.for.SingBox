package bridge

import (
	"net/http"
	"net/http/httptest"
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
