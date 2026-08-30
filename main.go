package main

import (
	"context"
	"embed"
	"fmt"
	"guiforcores/bridge"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

//go:embed all:frontend/dist/webui taskworker/worker.mjs frontend/src/vendor/proxy-utils.esm.mjs
var assets embed.FS

func main() {
	options, err := parseCLIOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		printUsage(os.Stderr)
		os.Exit(2)
	}
	if options.Help {
		printUsage(os.Stdout)
		return
	}

	app := bridge.CreateApp(assets)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := bridge.RunHeadless(ctx, assets, app, bridge.HeadlessOptions{
		Listen: options.WebUIListen,
		Token:  options.WebUIToken,
	}); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

type cliOptions struct {
	Help        bool
	WebUIListen string
	WebUIToken  string
}

func parseCLIOptions(args []string) (cliOptions, error) {
	options := cliOptions{
		WebUIListen: envOrDefault("WEBUI_LISTEN", "127.0.0.1:18080"),
		WebUIToken:  os.Getenv("WEBUI_TOKEN"),
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--headless":
			// Upgrade-safe no-op: headless WebUI is now the only runtime.
		case strings.HasPrefix(arg, "--webui-listen="):
			options.WebUIListen = strings.TrimPrefix(arg, "--webui-listen=")
		case arg == "--webui-listen":
			if i+1 >= len(args) {
				return options, fmt.Errorf("missing value for %s", arg)
			}
			i++
			options.WebUIListen = args[i]
		case strings.HasPrefix(arg, "--webui-token="):
			options.WebUIToken = strings.TrimPrefix(arg, "--webui-token=")
		case arg == "--webui-token":
			if i+1 >= len(args) {
				return options, fmt.Errorf("missing value for %s", arg)
			}
			i++
			options.WebUIToken = args[i]
		case arg == "--help" || arg == "-h":
			options.Help = true
		default:
			return options, fmt.Errorf("unknown argument %q", arg)
		}
	}

	return options, nil
}

func printUsage(output *os.File) {
	fmt.Fprintf(output, "Usage: %s [--webui-listen host:port] [--webui-token token]\n", os.Args[0])
}

func envOrDefault(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
