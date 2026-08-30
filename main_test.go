package main

import "testing"

func TestParseCLIOptionsUsesEnvironmentDefaults(t *testing.T) {
	t.Setenv("WEBUI_LISTEN", "0.0.0.0:19090")
	t.Setenv("WEBUI_TOKEN", "secret")

	options, err := parseCLIOptions(nil)
	if err != nil {
		t.Fatal(err)
	}
	if options.WebUIListen != "0.0.0.0:19090" {
		t.Fatalf("WebUIListen = %q", options.WebUIListen)
	}
	if options.WebUIToken != "secret" {
		t.Fatalf("WebUIToken = %q", options.WebUIToken)
	}
}

func TestParseCLIOptionsOverridesEnvironment(t *testing.T) {
	t.Setenv("WEBUI_LISTEN", "127.0.0.1:18080")
	t.Setenv("WEBUI_TOKEN", "old-token")

	options, err := parseCLIOptions([]string{
		"--headless",
		"--webui-listen=0.0.0.0:19090",
		"--webui-token",
		"new-token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if options.WebUIListen != "0.0.0.0:19090" {
		t.Fatalf("WebUIListen = %q", options.WebUIListen)
	}
	if options.WebUIToken != "new-token" {
		t.Fatalf("WebUIToken = %q", options.WebUIToken)
	}
}

func TestParseCLIOptionsRejectsInvalidArguments(t *testing.T) {
	for _, args := range [][]string{
		{"--unknown"},
		{"--webui-listen"},
		{"--webui-token"},
	} {
		if _, err := parseCLIOptions(args); err == nil {
			t.Fatalf("parseCLIOptions(%q) unexpectedly succeeded", args)
		}
	}
}

func TestEnvOrDefaultIgnoresWhitespace(t *testing.T) {
	t.Setenv("WEBUI_LISTEN", "   ")
	if got := envOrDefault("WEBUI_LISTEN", "127.0.0.1:18080"); got != "127.0.0.1:18080" {
		t.Fatalf("envOrDefault() = %q", got)
	}
}
