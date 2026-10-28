package bridge

import (
	"net/http/httptest"
	"testing"
)

func TestRequestProxyExplicitDirectAndEnvironmentPolicy(t *testing.T) {
	clearProxyEnvironment(t)
	t.Setenv("ALL_PROXY", "socks5://fallback.invalid:1080")
	t.Setenv("HTTP_PROXY", "http://http.invalid:8080")
	t.Setenv("HTTPS_PROXY", "http://https.invalid:8443")
	t.Setenv("NO_PROXY", "internal.example,192.0.2.4,198.51.100.0/24")
	if proxy := requestProxy("direct"); proxy != nil {
		t.Fatal("direct mode must bypass environment proxies")
	}
	cases := []struct{ target, want string }{
		{"http://example.invalid", "http://http.invalid:8080"},
		{"https://example.invalid", "http://https.invalid:8443"},
		{"http://internal.example", ""},
		{"https://sub.internal.example", ""},
		{"http://192.0.2.4", ""},
		{"https://198.51.100.42", ""},
	}
	for _, test := range cases {
		proxy, err := requestProxy("")(httptest.NewRequest("GET", test.target, nil))
		if err != nil {
			t.Fatal(err)
		}
		got := ""
		if proxy != nil {
			got = proxy.String()
		}
		if got != test.want {
			t.Errorf("%s: got %q want %q", test.target, got, test.want)
		}
	}
	t.Setenv("HTTP_PROXY", "")
	proxy, err := requestProxy("")(httptest.NewRequest("GET", "http://example.invalid", nil))
	if err != nil || proxy == nil || proxy.String() != "socks5://fallback.invalid:1080" {
		t.Fatalf("ALL_PROXY fallback: %v %v", proxy, err)
	}
	proxy, err = requestProxy("")(httptest.NewRequest("GET", "http://internal.example", nil))
	if err != nil || proxy != nil {
		t.Fatalf("fallback must honor bypass: %v %v", proxy, err)
	}
	t.Setenv("ALL_PROXY", "")
	t.Setenv("all_proxy", "http://lowercase.invalid:1234")
	proxy, err = requestProxy("")(httptest.NewRequest("GET", "http://example.invalid", nil))
	if err != nil || proxy == nil || proxy.Host != "lowercase.invalid:1234" {
		t.Fatalf("lowercase fallback: %v %v", proxy, err)
	}
	proxy, err = requestProxy("http://explicit.invalid:9000")(httptest.NewRequest("GET", "http://internal.example", nil))
	if err != nil || proxy == nil || proxy.Host != "explicit.invalid:9000" {
		t.Fatalf("explicit proxy must remain explicit: %v %v", proxy, err)
	}
}
func TestBackendProxyModesAreDistinct(t *testing.T) {
	worker := NewApp().taskWorker()
	for _, test := range []struct{ mode, want string }{{"none", "direct"}, {"system", ""}, {"custom", "http://custom.invalid:80"}} {
		settings := backendNetworkSettings{RequestProxyMode: test.mode, CustomProxy: "custom.invalid:80"}
		got, err := worker.resolveGlobalRequestProxy(settings)
		if err != nil || got != test.want {
			t.Fatalf("global %s: %q %v", test.mode, got, err)
		}
		got, err = worker.resolveSubscriptionProxy(&subscriptionConfig{RequestProxyMode: "global"}, settings)
		if err != nil || got != test.want {
			t.Fatalf("subscription %s: %q %v", test.mode, got, err)
		}
	}
}
