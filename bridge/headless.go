package bridge

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	neturl "net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	webUIRPCEndpoint    = "/__webui/api/rpc"
	webUIEmitEndpoint   = "/__webui/api/emit"
	webUISSEEndpoint    = "/__webui/api/events"
	webUICoreEndpoint   = "/__webui/core/"
	webUICoreWSEndpoint = "/__webui/core/ws/"
	webUITokenCookie    = "gfs_webui_token"
)

type HeadlessRuntime struct {
	Hub          *eventHub
	shutdown     chan struct{}
	shutdownOnce sync.Once
	server       *http.Server
	listenAddr   string
	token        string
}

type HeadlessOptions struct {
	Listen string
	Token  string
}

type rpcRequest struct {
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

type clientEmitRequest struct {
	Name string `json:"name"`
	Data []any  `json:"data"`
}

type headlessAuth struct {
	token string
}

func RunHeadless(assets embed.FS, app *App, options HeadlessOptions) error {
	listen := strings.TrimSpace(options.Listen)
	if listen == "" {
		listen = "127.0.0.1:18080"
	}

	token := strings.TrimSpace(options.Token)
	if token == "" && !isLoopbackListen(listen) {
		generated, err := generateHeadlessToken()
		if err != nil {
			return err
		}
		token = generated
	}

	webuiFS, err := fs.Sub(assets, "frontend/dist/webui")
	if err != nil {
		return fmt.Errorf("headless webui assets are missing: %w", err)
	}

	Env.RuntimeMode = RuntimeModeWebUI
	app.Ctx = context.Background()
	app.Headless = &HeadlessRuntime{
		Hub:      newEventHub(),
		shutdown: make(chan struct{}),
		token:    token,
	}
	if err := app.startHeadlessCoreIfNeeded(); err != nil {
		log.Printf("Headless core startup skipped: %v", err)
	}
	if err := app.StartScheduledTaskWorker(); err != nil {
		log.Printf("Scheduled task worker unavailable: %v", err)
	}

	auth := &headlessAuth{token: token}
	mux := http.NewServeMux()
	mux.Handle(webUIRPCEndpoint, auth.wrap(http.HandlerFunc(app.handleRPCCall)))
	mux.Handle(webUIEmitEndpoint, auth.wrap(http.HandlerFunc(app.handleClientEmit)))
	mux.Handle(webUISSEEndpoint, auth.wrap(http.HandlerFunc(app.handleEventStream)))
	mux.Handle(webUICoreWSEndpoint, auth.wrap(http.HandlerFunc(app.handleCoreWebSocketProxy)))
	mux.Handle(webUICoreEndpoint, auth.wrap(http.HandlerFunc(app.handleCoreProxy)))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveHeadlessAssets(webuiFS, w, r)
	}))

	server := &http.Server{
		Addr:    listen,
		Handler: mux,
	}
	app.Headless.server = server

	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}
	app.Headless.listenAddr = listener.Addr().String()

	log.Printf("Headless WebUI listening on %s", app.Headless.listenAddr)
	if accessURL := buildLocalAccessURL(app.Headless.listenAddr, token); accessURL != "" {
		log.Printf("Open locally: %s", accessURL)
	}
	if token != "" {
		log.Printf("WebUI token: %s", token)
	}

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.Serve(listener)
	}()

	select {
	case err := <-serverErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-app.Headless.shutdown:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(ctx)
	}
}

func (a *App) handleRPCCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var (
		result any
		err    error
	)

	switch req.Method {
	case "AbsolutePath":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.AbsolutePath(arg)
	case "CloseMMDB":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		idArg, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.CloseMMDB(pathArg, idArg)
	case "CopyFile":
		source, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		target, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.CopyFile(source, target)
	case "Download":
		method, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		urlArg, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 2)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		headers, decodeErr := decodeRPCArg[map[string]string](req.Args, 3)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		event, decodeErr := decodeRPCArg[string](req.Args, 4)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[RequestOptions](req.Args, 5)
		err = decodeErr
		result = a.Download(method, urlArg, pathArg, headers, event, optionsArg)
	case "Exec":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		argsArg, decodeErr := decodeRPCArg[[]string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[ExecOptions](req.Args, 2)
		err = decodeErr
		result = a.Exec(pathArg, argsArg, optionsArg)
	case "ExecBackground":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		argsArg, decodeErr := decodeRPCArg[[]string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		outEvent, decodeErr := decodeRPCArg[string](req.Args, 2)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		endEvent, decodeErr := decodeRPCArg[string](req.Args, 3)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[ExecOptions](req.Args, 4)
		err = decodeErr
		result = a.ExecBackground(pathArg, argsArg, outEvent, endEvent, optionsArg)
	case "ExitApp":
		a.ExitApp()
		result = nil
	case "FileExists":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.FileExists(arg)
	case "FindListeningProcess":
		arg, decodeErr := decodeRPCArg[uint32](req.Args, 0)
		err = decodeErr
		result = a.FindListeningProcess(arg)
	case "GetEnv":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.GetEnv(arg)
	case "GetInterfaces":
		result = a.GetInterfaces()
	case "GetScheduledTaskWorkerLogs":
		result = a.GetScheduledTaskWorkerLogs()
	case "RecordScheduledTaskLog":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		result = a.RecordScheduledTaskLog(arg)
	case "GetScheduledTaskWorkerStatus":
		result = a.GetScheduledTaskWorkerStatus()
	case "GetSystemProxy":
		result = a.GetSystemProxy()
	case "GetSystemProxyBypass":
		result = a.GetSystemProxyBypass()
	case "IsStartup":
		result = a.IsStartup()
	case "KillProcess":
		pid, decodeErr := decodeRPCArg[int](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		timeout, decodeErr := decodeRPCArg[int](req.Args, 1)
		err = decodeErr
		result = a.KillProcess(pid, timeout)
	case "ListServer":
		result = a.ListServer()
	case "MakeDir":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.MakeDir(arg)
	case "MoveFile":
		source, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		target, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.MoveFile(source, target)
	case "OpenDir":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.OpenDir(arg)
	case "OpenMMDB":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		idArg, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.OpenMMDB(pathArg, idArg)
	case "OpenURI":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.OpenURI(arg)
	case "ProcessInfo":
		arg, decodeErr := decodeRPCArg[int32](req.Args, 0)
		err = decodeErr
		result = a.ProcessInfo(arg)
	case "ProcessMemory":
		arg, decodeErr := decodeRPCArg[int32](req.Args, 0)
		err = decodeErr
		result = a.ProcessMemory(arg)
	case "QueryMMDB":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		ipArg, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		typeArg, decodeErr := decodeRPCArg[string](req.Args, 2)
		err = decodeErr
		result = a.QueryMMDB(pathArg, ipArg, typeArg)
	case "ReadDir":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.ReadDir(arg)
	case "ReadFile":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[IOOptions](req.Args, 1)
		err = decodeErr
		result = a.ReadFile(pathArg, optionsArg)
	case "ReloadScheduledTaskWorker":
		result = a.ReloadScheduledTaskWorker()
	case "RemoveFile":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.RemoveFile(arg)
	case "Requests":
		method, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		urlArg, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		headers, decodeErr := decodeRPCArg[map[string]string](req.Args, 2)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		bodyArg, decodeErr := decodeRPCArg[string](req.Args, 3)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[RequestOptions](req.Args, 4)
		err = decodeErr
		result = a.Requests(method, urlArg, headers, bodyArg, optionsArg)
	case "RestartApp":
		result = a.RestartApp()
	case "ShowMainWindow":
		a.ShowMainWindow()
		result = nil
	case "StartServer":
		address, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		serverID, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[ServerOptions](req.Args, 2)
		err = decodeErr
		result = a.StartServer(address, serverID, optionsArg)
	case "StopServer":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.StopServer(arg)
	case "RunScheduledTaskWorker":
		arg, decodeErr := decodeRPCArg[string](req.Args, 0)
		err = decodeErr
		result = a.RunScheduledTaskWorker(arg)
	case "SetSystemProxy":
		enable, decodeErr := decodeRPCArg[bool](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		server, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		proxyType, decodeErr := decodeRPCArg[string](req.Args, 2)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		bypass, decodeErr := decodeRPCArg[string](req.Args, 3)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		darwinServices, decodeErr := decodeRPCArg[[]string](req.Args, 4)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		result = a.SetSystemProxy(enable, server, proxyType, bypass, darwinServices)
	case "TcpPing":
		address, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[NetOptions](req.Args, 1)
		err = decodeErr
		result = a.TcpPing(address, optionsArg)
	case "TcpRequest":
		address, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		payload, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[NetOptions](req.Args, 2)
		err = decodeErr
		result = a.TcpRequest(address, payload, optionsArg)
	case "UdpRequest":
		address, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		payload, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[NetOptions](req.Args, 2)
		err = decodeErr
		result = a.UdpRequest(address, payload, optionsArg)
	case "UnzipGZFile":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		output, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.UnzipGZFile(pathArg, output)
	case "UnzipTarGZFile":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		output, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.UnzipTarGZFile(pathArg, output)
	case "UnzipZIPFile":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		output, decodeErr := decodeRPCArg[string](req.Args, 1)
		err = decodeErr
		result = a.UnzipZIPFile(pathArg, output)
	case "UpdateTray":
		trayArg, decodeErr := decodeRPCArg[TrayContent](req.Args, 0)
		err = decodeErr
		a.UpdateTray(trayArg)
		result = nil
	case "UpdateTrayAndMenus":
		trayArg, decodeErr := decodeRPCArg[TrayContent](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		menuArg, decodeErr := decodeRPCArg[[]MenuItem](req.Args, 1)
		err = decodeErr
		a.UpdateTrayAndMenus(trayArg, menuArg)
		result = nil
	case "UpdateTrayMenus":
		menuArg, decodeErr := decodeRPCArg[[]MenuItem](req.Args, 0)
		err = decodeErr
		a.UpdateTrayMenus(menuArg)
		result = nil
	case "ClearScheduledTaskWorkerLogs":
		result = a.ClearScheduledTaskWorkerLogs()
	case "Upload":
		method, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		urlArg, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 2)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		headers, decodeErr := decodeRPCArg[map[string]string](req.Args, 3)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		event, decodeErr := decodeRPCArg[string](req.Args, 4)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[RequestOptions](req.Args, 5)
		err = decodeErr
		result = a.Upload(method, urlArg, pathArg, headers, event, optionsArg)
	case "WriteFile":
		pathArg, decodeErr := decodeRPCArg[string](req.Args, 0)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		content, decodeErr := decodeRPCArg[string](req.Args, 1)
		if decodeErr != nil {
			err = decodeErr
			break
		}
		optionsArg, decodeErr := decodeRPCArg[IOOptions](req.Args, 2)
		err = decodeErr
		result = a.WriteFile(pathArg, content, optionsArg)
	default:
		http.Error(w, "Unknown RPC method", http.StatusNotFound)
		return
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeHeadlessJSON(w, result)
}

func (a *App) handleClientEmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var req clientEmitRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	a.ClientEventsEmit(req.Name, req.Data...)
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleEventStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch, unsubscribe := a.Headless.Hub.subscribe()
	defer unsubscribe()

	_, _ = io.WriteString(w, ": connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			payload, err := json.Marshal(evt)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (a *App) handleCoreProxy(w http.ResponseWriter, r *http.Request) {
	controller, targetPath, err := parseCoreProxyTarget(r.URL.Path, webUICoreEndpoint)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	targetURL := &neturl.URL{
		Scheme:   "http",
		Host:     controller,
		Path:     targetPath,
		RawQuery: r.URL.RawQuery,
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	req.Header = r.Header.Clone()
	req.Host = controller

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (a *App) handleCoreWebSocketProxy(w http.ResponseWriter, r *http.Request) {
	controller, targetPath, err := parseCoreProxyTarget(r.URL.Path, webUICoreWSEndpoint)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	backendURL := neturl.URL{
		Scheme:   "ws",
		Host:     controller,
		Path:     targetPath,
		RawQuery: r.URL.RawQuery,
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	headers := http.Header{}
	if auth := r.Header.Get("Authorization"); auth != "" {
		headers.Set("Authorization", auth)
	}

	backendConn, _, err := websocket.DefaultDialer.Dial(backendURL.String(), headers)
	if err != nil {
		_ = clientConn.WriteMessage(websocket.TextMessage, []byte(err.Error()))
		return
	}
	defer backendConn.Close()

	errCh := make(chan error, 2)

	go proxyWebSocketMessages(clientConn, backendConn, errCh)
	go proxyWebSocketMessages(backendConn, clientConn, errCh)

	<-errCh
}

func (a *headlessAuth) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.authorize(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *headlessAuth) authorize(w http.ResponseWriter, r *http.Request) bool {
	if a.token == "" {
		return true
	}

	matched := false
	if cookie, err := r.Cookie(webUITokenCookie); err == nil && cookie.Value == a.token {
		matched = true
	}
	if !matched && strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) == a.token {
		matched = true
	}
	if !matched && r.URL.Query().Get("token") == a.token {
		matched = true
	}

	if !matched {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}

	http.SetCookie(w, &http.Cookie{
		Name:     webUITokenCookie,
		Value:    a.token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	return true
}

func serveHeadlessAssets(webuiFS fs.FS, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	fileServer := http.FileServer(http.FS(webuiFS))
	requestPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if requestPath == "." {
		requestPath = ""
	}

	if requestPath != "" {
		if info, err := fs.Stat(webuiFS, requestPath); err == nil && !info.IsDir() {
			w.Header().Set("Cache-Control", "max-age=31536000, immutable")
			fileServer.ServeHTTP(w, r)
			return
		}
	}

	indexHTML, err := fs.ReadFile(webuiFS, "index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(indexHTML))
}

func decodeRPCArg[T any](args []json.RawMessage, index int) (T, error) {
	var value T
	if index >= len(args) {
		return value, fmt.Errorf("missing argument %d", index)
	}
	err := json.Unmarshal(args[index], &value)
	return value, err
}

func writeHeadlessJSON(w http.ResponseWriter, value any) {
	if value == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.WriteString(w, "null")
		return
	}

	var payload bytes.Buffer
	if err := json.NewEncoder(&payload).Encode(value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(payload.Bytes())
}

func isLoopbackListen(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}

	host = strings.Trim(host, "[]")
	switch host {
	case "127.0.0.1", "::1", "localhost":
		return true
	case "":
		return false
	}

	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func generateHeadlessToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func buildLocalAccessURL(listenAddr string, token string) string {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return ""
	}

	host = strings.Trim(host, "[]")
	switch host {
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}

	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}

	url := fmt.Sprintf("http://%s:%s/", host, port)
	if token != "" {
		url += "?token=" + neturl.QueryEscape(token)
	}
	return url
}

func parseCoreProxyTarget(requestPath string, prefix string) (controller string, targetPath string, err error) {
	trimmed := strings.TrimPrefix(requestPath, prefix)
	if trimmed == requestPath || trimmed == "" {
		return "", "", fmt.Errorf("invalid core proxy path")
	}

	parts := strings.SplitN(trimmed, "/", 2)
	controller, err = neturl.PathUnescape(parts[0])
	if err != nil || controller == "" {
		return "", "", fmt.Errorf("invalid core controller")
	}

	targetPath = "/"
	if len(parts) == 2 && parts[1] != "" {
		targetPath += parts[1]
	}

	return controller, targetPath, nil
}

func proxyWebSocketMessages(src *websocket.Conn, dst *websocket.Conn, errCh chan<- error) {
	for {
		messageType, data, err := src.ReadMessage()
		if err != nil {
			errCh <- err
			return
		}
		if err := dst.WriteMessage(messageType, data); err != nil {
			errCh <- err
			return
		}
	}
}
