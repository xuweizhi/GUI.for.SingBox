package bridge

import "testing"

func clearProxyEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"HTTPS_PROXY",
		"https_proxy",
		"HTTP_PROXY",
		"http_proxy",
		"ALL_PROXY",
		"all_proxy",
		"NO_PROXY",
		"no_proxy",
	} {
		t.Setenv(key, "")
	}
}

func TestEnvironmentProxyUsesServiceEnvironment(t *testing.T) {
	clearProxyEnvironment(t)
	t.Setenv("HTTP_PROXY", " http://127.0.0.1:7890 ")
	t.Setenv("ALL_PROXY", "socks5://127.0.0.1:7891")

	if got := environmentProxy(); got != "http://127.0.0.1:7890" {
		t.Fatalf("environmentProxy() = %q", got)
	}
}

func TestEnvironmentProxyPrefersHTTPS(t *testing.T) {
	clearProxyEnvironment(t)
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:7892")
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:7890")

	if got := environmentProxy(); got != "http://127.0.0.1:7892" {
		t.Fatalf("environmentProxy() = %q", got)
	}
}

func TestEnvironmentProxyBypass(t *testing.T) {
	clearProxyEnvironment(t)
	t.Setenv("NO_PROXY", " localhost,127.0.0.1 ")

	if got := environmentProxyBypass(); got != "localhost,127.0.0.1" {
		t.Fatalf("environmentProxyBypass() = %q", got)
	}
}
