package bridge

import (
	"log"
	"os"
	"strings"
)

func environmentProxy() string {
	for _, key := range []string{
		"HTTPS_PROXY",
		"https_proxy",
		"HTTP_PROXY",
		"http_proxy",
		"ALL_PROXY",
		"all_proxy",
	} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func environmentProxyBypass() string {
	if value := strings.TrimSpace(os.Getenv("NO_PROXY")); value != "" {
		return value
	}
	return strings.TrimSpace(os.Getenv("no_proxy"))
}

func (a *App) GetSystemProxy() FlagResult {
	log.Printf("GetEnvironmentProxy")
	return FlagResult{true, environmentProxy()}
}

func (a *App) GetSystemProxyBypass() FlagResult {
	log.Printf("GetEnvironmentProxyBypass")
	return FlagResult{true, environmentProxyBypass()}
}
