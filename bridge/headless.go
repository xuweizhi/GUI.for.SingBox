package bridge

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	webUIRPCEndpoint     = "/__webui/api/rpc"
	webUIEmitEndpoint    = "/__webui/api/emit"
	webUISSEEndpoint     = "/__webui/api/events"
	webUISessionEndpoint = "/__webui/api/session"
	webUICoreEndpoint    = "/__webui/core/"
	webUICoreWSEndpoint  = "/__webui/core/ws/"
	webUITokenCookie     = "gfs_webui_token"
	webUIAuthHeader      = "X-GFS-WebUI-Auth"
	webUITokenFile       = "data/webui-token"
	webUIMaxRPCBody      = 16 << 20
	webUIMaxEmitBody     = 1 << 20
)

type HeadlessRuntime struct {
	shutdown     chan struct{}
	shutdownOnce sync.Once
	listenAddr   string
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

type sessionRequest struct {
	Token string `json:"token"`
}

type headlessAuth struct {
	token string
}

func RunHeadless(ctx context.Context, assets embed.FS, app *App, options HeadlessOptions) error {
	listen := strings.TrimSpace(options.Listen)
	if listen == "" {
		listen = "127.0.0.1:18080"
	}

	token, tokenPath, err := resolveHeadlessToken(options.Token)
	if err != nil {
		return err
	}

	webuiFS, err := fs.Sub(assets, "frontend/dist/webui")
	if err != nil {
		return fmt.Errorf("headless webui assets are missing: %w", err)
	}

	auth := &headlessAuth{token: token}
	mux := http.NewServeMux()
	mux.Handle(webUISessionEndpoint, sameOriginOnly(http.HandlerFunc(auth.handleSession)))
	mux.Handle(webUIRPCEndpoint, sameOriginOnly(auth.wrap(http.HandlerFunc(app.handleRPCCall))))
	mux.Handle(webUIEmitEndpoint, sameOriginOnly(auth.wrap(http.HandlerFunc(app.handleClientEmit))))
	mux.Handle(webUISSEEndpoint, auth.wrap(http.HandlerFunc(app.handleEventStream)))
	mux.Handle(webUICoreWSEndpoint, auth.wrap(http.HandlerFunc(app.handleCoreWebSocketProxy)))
	mux.Handle(webUICoreEndpoint, auth.wrap(http.HandlerFunc(app.handleCoreProxy)))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveHeadlessAssets(webuiFS, w, r)
	}))

	server := &http.Server{
		Addr:              listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}

	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}

	app.Ctx = ctx
	app.Headless = &HeadlessRuntime{
		shutdown:   make(chan struct{}),
		listenAddr: listener.Addr().String(),
	}
	if err := app.startHeadlessCoreIfNeeded(); err != nil {
		log.Printf("Headless core startup skipped: %v", err)
	}
	if err := app.StartScheduledTaskWorker(); err != nil {
		log.Printf("Scheduled task worker unavailable: %v", err)
	}

	log.Printf("Headless WebUI listening on %s", app.Headless.listenAddr)
	if accessURL := buildLocalAccessURL(app.Headless.listenAddr); accessURL != "" {
		log.Printf("Open locally: %s", accessURL)
	}
	if tokenPath != "" {
		log.Printf("WebUI token file: %s", tokenPath)
	}

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.Serve(listener)
	}()

	select {
	case err := <-serverErr:
		app.StopScheduledTaskWorker()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		app.StopScheduledTaskWorker()
		return shutdownHeadlessHTTPServer(server)
	case <-app.Headless.shutdown:
		app.StopScheduledTaskWorker()
		return shutdownHeadlessHTTPServer(server)
	}
}

func shutdownHeadlessHTTPServer(server *http.Server) error {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		closeErr := server.Close()
		if closeErr != nil && !errors.Is(closeErr, http.ErrServerClosed) {
			return fmt.Errorf("shutdown timed out (%v), forced close failed: %w", err, closeErr)
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
	}
	return nil
}

func (a *App) handleRPCCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !hasJSONContentType(r) {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, webUIMaxRPCBody)
	var req rpcRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result, err := a.dispatchRPCCall(req)
	if err != nil {
		if errors.Is(err, errUnknownRPCMethod) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeHeadlessJSON(w, result)
}

var errUnknownRPCMethod = errors.New("unknown RPC method")

func (a *App) dispatchRPCCall(req rpcRequest) (any, error) {
	switch req.Method {
	case "AbsolutePath":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.AbsolutePath(value), nil
	case "CloseMMDB":
		var filePath, id string
		if err := decodeRPCArgs(req.Args, &filePath, &id); err != nil {
			return nil, err
		}
		return a.CloseMMDB(filePath, id), nil
	case "CopyFile":
		var source, target string
		if err := decodeRPCArgs(req.Args, &source, &target); err != nil {
			return nil, err
		}
		return a.CopyFile(source, target), nil
	case "Download":
		var method, urlArg, filePath, event string
		var headers map[string]string
		var options RequestOptions
		if err := decodeRPCArgs(req.Args, &method, &urlArg, &filePath, &headers, &event, &options); err != nil {
			return nil, err
		}
		return a.Download(method, urlArg, filePath, headers, event, options), nil
	case "Exec":
		var executable string
		var args []string
		var options ExecOptions
		if err := decodeRPCArgs(req.Args, &executable, &args, &options); err != nil {
			return nil, err
		}
		return a.Exec(executable, args, options), nil
	case "ExecBackground":
		var executable, outEvent, endEvent string
		var args []string
		var options ExecOptions
		if err := decodeRPCArgs(req.Args, &executable, &args, &outEvent, &endEvent, &options); err != nil {
			return nil, err
		}
		return a.ExecBackground(executable, args, outEvent, endEvent, options), nil
	case "FileExists":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.FileExists(value), nil
	case "FileSHA256":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.FileSHA256(value), nil
	case "FindListeningProcess":
		var port uint32
		if err := decodeRPCArgs(req.Args, &port); err != nil {
			return nil, err
		}
		return a.FindListeningProcess(port), nil
	case "GetEnv":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.GetEnv(), nil
	case "GetInterfaces":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.GetInterfaces(), nil
	case "GetScheduledTaskWorkerLogs":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.GetScheduledTaskWorkerLogs(), nil
	case "RecordScheduledTaskLog":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.RecordScheduledTaskLog(value), nil
	case "GetScheduledTaskWorkerStatus":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.GetScheduledTaskWorkerStatus(), nil
	case "GetSystemProxy":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.GetSystemProxy(), nil
	case "GetSystemProxyBypass":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.GetSystemProxyBypass(), nil
	case "IsStartup":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.IsStartup(), nil
	case "KillProcess":
		var pid, timeout int
		if err := decodeRPCArgs(req.Args, &pid, &timeout); err != nil {
			return nil, err
		}
		return a.KillProcess(pid, timeout), nil
	case "ListServer":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.ListServer(), nil
	case "MakeDir":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.MakeDir(value), nil
	case "MoveFile":
		var source, target string
		if err := decodeRPCArgs(req.Args, &source, &target); err != nil {
			return nil, err
		}
		return a.MoveFile(source, target), nil
	case "OpenMMDB":
		var filePath, id string
		if err := decodeRPCArgs(req.Args, &filePath, &id); err != nil {
			return nil, err
		}
		return a.OpenMMDB(filePath, id), nil
	case "ProcessInfo":
		var pid int32
		if err := decodeRPCArgs(req.Args, &pid); err != nil {
			return nil, err
		}
		return a.ProcessInfo(pid), nil
	case "ProcessMemory":
		var pid int32
		if err := decodeRPCArgs(req.Args, &pid); err != nil {
			return nil, err
		}
		return a.ProcessMemory(pid), nil
	case "QueryMMDB":
		var filePath, ip, queryType string
		if err := decodeRPCArgs(req.Args, &filePath, &ip, &queryType); err != nil {
			return nil, err
		}
		return a.QueryMMDB(filePath, ip, queryType), nil
	case "ReadDir":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.ReadDir(value), nil
	case "ReadFile":
		var filePath string
		var options IOOptions
		if err := decodeRPCArgs(req.Args, &filePath, &options); err != nil {
			return nil, err
		}
		return a.ReadFile(filePath, options), nil
	case "ReloadScheduledTaskWorker":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.ReloadScheduledTaskWorker(), nil
	case "RemoveFile":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.RemoveFile(value), nil
	case "Requests":
		var method, urlArg, body string
		var headers map[string]string
		var options RequestOptions
		if err := decodeRPCArgs(req.Args, &method, &urlArg, &headers, &body, &options); err != nil {
			return nil, err
		}
		return a.Requests(method, urlArg, headers, body, options), nil
	case "RestartApp":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.RestartApp(), nil
	case "StartServer":
		var address, serverID string
		var options ServerOptions
		if err := decodeRPCArgs(req.Args, &address, &serverID, &options); err != nil {
			return nil, err
		}
		return a.StartServer(address, serverID, options), nil
	case "StopServer":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.StopServer(value), nil
	case "RunScheduledTaskWorker":
		var value string
		if err := decodeRPCArgs(req.Args, &value); err != nil {
			return nil, err
		}
		return a.RunScheduledTaskWorker(value), nil
	case "TcpPing":
		var address string
		var options NetOptions
		if err := decodeRPCArgs(req.Args, &address, &options); err != nil {
			return nil, err
		}
		return a.TcpPing(address, options), nil
	case "TcpRequest":
		var address, payload string
		var options NetOptions
		if err := decodeRPCArgs(req.Args, &address, &payload, &options); err != nil {
			return nil, err
		}
		return a.TcpRequest(address, payload, options), nil
	case "UdpRequest":
		var address, payload string
		var options NetOptions
		if err := decodeRPCArgs(req.Args, &address, &payload, &options); err != nil {
			return nil, err
		}
		return a.UdpRequest(address, payload, options), nil
	case "UnzipGZFile":
		var filePath, output string
		if err := decodeRPCArgs(req.Args, &filePath, &output); err != nil {
			return nil, err
		}
		return a.UnzipGZFile(filePath, output), nil
	case "UnzipTarGZFile":
		var filePath, output string
		if err := decodeRPCArgs(req.Args, &filePath, &output); err != nil {
			return nil, err
		}
		return a.UnzipTarGZFile(filePath, output), nil
	case "UnzipZIPFile":
		var filePath, output string
		if err := decodeRPCArgs(req.Args, &filePath, &output); err != nil {
			return nil, err
		}
		return a.UnzipZIPFile(filePath, output), nil
	case "ClearScheduledTaskWorkerLogs":
		if err := decodeRPCArgs(req.Args); err != nil {
			return nil, err
		}
		return a.ClearScheduledTaskWorkerLogs(), nil
	case "Upload":
		var method, urlArg, filePath, event string
		var headers map[string]string
		var options RequestOptions
		if err := decodeRPCArgs(req.Args, &method, &urlArg, &filePath, &headers, &event, &options); err != nil {
			return nil, err
		}
		return a.Upload(method, urlArg, filePath, headers, event, options), nil
	case "WriteFile":
		var filePath, content string
		var options IOOptions
		if err := decodeRPCArgs(req.Args, &filePath, &content, &options); err != nil {
			return nil, err
		}
		return a.WriteFile(filePath, content, options), nil
	default:
		return nil, fmt.Errorf("%w: %s", errUnknownRPCMethod, req.Method)
	}
}

func (a *App) handleClientEmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !hasJSONContentType(r) {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, webUIMaxEmitBody)
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

	ch, unsubscribe := a.eventHub().subscribe()
	defer unsubscribe()
	var appShutdown <-chan struct{}
	if a.Ctx != nil {
		appShutdown = a.Ctx.Done()
	}
	var headlessShutdown <-chan struct{}
	if a.Headless != nil {
		headlessShutdown = a.Headless.shutdown
	}

	_, _ = io.WriteString(w, ": connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-appShutdown:
			return
		case <-headlessShutdown:
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
		CheckOrigin: isSameOriginRequest,
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
	matched := false
	if cookie, err := r.Cookie(webUITokenCookie); err == nil && cookie.Value == a.token {
		matched = true
	}
	if !matched && strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) == a.token {
		matched = true
	}

	if !matched {
		w.Header().Set(webUIAuthHeader, "required")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}

	a.setSessionCookie(w, r)
	return true
}

func (a *headlessAuth) handleSession(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !a.authorize(w, r) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPost:
		if !hasJSONContentType(r) {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
		var request sessionRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		candidate := strings.TrimSpace(request.Token)
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(a.token)) != 1 {
			w.Header().Set(webUIAuthHeader, "required")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		a.setSessionCookie(w, r)
		w.WriteHeader(http.StatusNoContent)
	case http.MethodDelete:
		http.SetCookie(w, &http.Cookie{
			Name:     webUITokenCookie,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			Expires:  time.Unix(1, 0),
			HttpOnly: true,
			Secure:   requestIsHTTPS(r),
			SameSite: http.SameSiteStrictMode,
		})
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *headlessAuth) setSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     webUITokenCookie,
		Value:    a.token,
		Path:     "/",
		HttpOnly: true,
		Secure:   requestIsHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func sameOriginOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isSameOriginRequest(r) {
			http.Error(w, "Cross-origin request rejected", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isSameOriginRequest(r *http.Request) bool {
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
		return false
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := neturl.Parse(origin)
	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func hasJSONContentType(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
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

func decodeRPCArgs(args []json.RawMessage, targets ...any) error {
	if len(args) != len(targets) {
		return fmt.Errorf("expected %d arguments, got %d", len(targets), len(args))
	}
	for index, target := range targets {
		if err := json.Unmarshal(args[index], target); err != nil {
			return fmt.Errorf("invalid argument %d: %w", index, err)
		}
	}
	return nil
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

func generateHeadlessToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func resolveHeadlessToken(configured string) (token string, generatedPath string, err error) {
	if token = strings.TrimSpace(configured); token != "" {
		return token, "", nil
	}

	tokenPath := resolvePath(webUITokenFile)
	if content, readErr := os.ReadFile(tokenPath); readErr == nil {
		token = strings.TrimSpace(string(content))
		if token == "" {
			return "", "", fmt.Errorf("stored WebUI token is empty: %s", tokenPath)
		}
		if chmodErr := os.Chmod(tokenPath, 0o600); chmodErr != nil {
			return "", "", fmt.Errorf("secure WebUI token file: %w", chmodErr)
		}
		return token, tokenPath, nil
	} else if !os.IsNotExist(readErr) {
		return "", "", fmt.Errorf("read WebUI token file: %w", readErr)
	}

	token, err = generateHeadlessToken()
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(tokenPath), 0o700); err != nil {
		return "", "", fmt.Errorf("create WebUI token directory: %w", err)
	}
	if err := atomicWriteFile(tokenPath, []byte(token), 0o600); err != nil {
		return "", "", fmt.Errorf("store WebUI token: %w", err)
	}
	return token, tokenPath, nil
}

func buildLocalAccessURL(listenAddr string) string {
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

	return fmt.Sprintf("http://%s:%s/", host, port)
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
