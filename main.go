package main

import (
	"context"
	"embed"
	"fmt"
	"guiforcores/bridge"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist taskworker/worker.mjs
var assets embed.FS

//go:embed frontend/dist/favicon.ico
var icon []byte

func main() {
	app := bridge.CreateApp(assets)

	cliOptions := parseCLIOptions(os.Args[1:])
	if cliOptions.Help {
		return
	}
	if cliOptions.Headless {
		err := bridge.RunHeadless(assets, app, bridge.HeadlessOptions{
			Listen: cliOptions.WebUIListen,
			Token:  cliOptions.WebUIToken,
		})
		if err != nil {
			println("Error:", err.Error())
		}
		return
	}

	trayStart, trayEnd := bridge.CreateTray(app, icon)

	// Create application with options
	err := wails.Run(&options.App{
		MinWidth:         600,
		MinHeight:        400,
		DisableResize:    false,
		Menu:             app.AppMenu,
		Title:            bridge.Env.AppName,
		Frameless:        bridge.Env.OS != "darwin",
		Width:            bridge.Config.Width,
		Height:           bridge.Config.Height,
		StartHidden:      bridge.Config.StartHidden,
		WindowStartState: options.WindowStartState(bridge.Config.WindowStartState),
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		Windows: &windows.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			ContentProtection:    bridge.Config.ContentProtection,
			BackdropType:         windows.Acrylic,
			WebviewBrowserPath:   bridge.Env.WebviewPath,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.DefaultAppearance,
			ContentProtection:    bridge.Config.ContentProtection,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title:   bridge.Env.AppName,
				Message: "© 2026 GUI.for.Cores",
				Icon:    icon,
			},
		},
		Linux: &linux.Options{
			Icon:                icon,
			WindowIsTranslucent: false,
			ProgramName:         bridge.Env.AppName,
			WebviewGpuPolicy:    linux.WebviewGpuPolicy(bridge.Config.WebviewGpuPolicy),
		},
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: bridge.RollingRelease,
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: func() string {
				if bridge.Config.MultipleInstance {
					return time.Now().String()
				}
				return bridge.Env.AppName
			}(),
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				app.ShowMainWindow()
				app.EventsEmit("onLaunchApp", data.Args)
			},
		},
		OnStartup: func(ctx context.Context) {
			app.Ctx = ctx
			runtime.InitializeNotifications(ctx)
			trayStart()
			if err := app.StartScheduledTaskWorker(); err != nil {
				println("Scheduled task worker:", err.Error())
			}
		},
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			if !bridge.Env.PreventExit {
				trayEnd()
				runtime.CleanupNotifications(ctx)
				return false
			}
			app.EventsEmit("onBeforeExitApp")
			return true
		},
		Bind: []any{
			app,
		},
		LogLevel: logger.INFO,
		Debug: options.Debug{
			OpenInspectorOnStartup: true,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

type cliOptions struct {
	Headless    bool
	Help        bool
	WebUIListen string
	WebUIToken  string
}

func parseCLIOptions(args []string) cliOptions {
	options := cliOptions{
		WebUIListen: "127.0.0.1:18080",
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--headless":
			options.Headless = true
		case strings.HasPrefix(arg, "--webui-listen="):
			options.WebUIListen = strings.TrimPrefix(arg, "--webui-listen=")
		case arg == "--webui-listen" && i+1 < len(args):
			i++
			options.WebUIListen = args[i]
		case strings.HasPrefix(arg, "--webui-token="):
			options.WebUIToken = strings.TrimPrefix(arg, "--webui-token=")
		case arg == "--webui-token" && i+1 < len(args):
			i++
			options.WebUIToken = args[i]
		case arg == "--help" || arg == "-h":
			println("Usage:")
			println(fmt.Sprintf("  %s [--headless] [--webui-listen host:port] [--webui-token token]", os.Args[0]))
			options.Help = true
		}
	}

	return options
}
