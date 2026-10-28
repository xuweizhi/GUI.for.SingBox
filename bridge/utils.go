package bridge

import (
	"crypto/tls"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/http/httpproxy"
)

type requestTransportKey struct {
	Proxy    string
	Insecure bool
}

type requestTransportCacheStore struct {
	mu      sync.Mutex
	order   []requestTransportKey
	entries map[requestTransportKey]*http.Transport
}

const maxRequestTransportCacheEntries = 32

var requestTransportCache = requestTransportCacheStore{
	entries: map[requestTransportKey]*http.Transport{},
}

var dataMutationMu sync.Mutex

func resolvePath(path string) string {
	if !filepath.IsAbs(path) {
		path = filepath.Join(Env.BasePath, path)
	}
	return filepath.ToSlash(filepath.Clean(path))
}

func atomicWriteFile(path string, data []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}

	temp, err := os.CreateTemp(directory, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if err := temp.Chmod(mode); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

func sanitizedURLForLog(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "<invalid-url>"
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func requestProxy(proxyAddr string) func(*http.Request) (*url.URL, error) {
	if strings.EqualFold(strings.TrimSpace(proxyAddr), "direct") {
		return nil
	}
	// Apply standard HTTP(S)/NO_PROXY rules, with the documented ALL_PROXY fallback.
	config := httpproxy.FromEnvironment()
	fallback := firstNonEmpty(os.Getenv("ALL_PROXY"), os.Getenv("all_proxy"))
	if config.HTTPProxy == "" {
		config.HTTPProxy = fallback
	}
	if config.HTTPSProxy == "" {
		config.HTTPSProxy = fallback
	}
	resolve := config.ProxyFunc()
	proxy := func(req *http.Request) (*url.URL, error) { return resolve(req.URL) }

	if proxyAddr != "" {
		proxyUrl, err := url.Parse(proxyAddr)
		if err == nil {
			proxy = http.ProxyURL(proxyUrl)
		}
	}

	return proxy
}

func requestTimeout(timeout int) time.Duration {
	if timeout <= 0 {
		return 15 * time.Second
	}
	return time.Duration(timeout) * time.Second
}

func netPayloadBytes(payload string, options NetOptions) ([]byte, error) {
	if options.Mode == Binary {
		return base64.StdEncoding.DecodeString(payload)
	}
	return []byte(payload), nil
}

func netPayloadString(payload []byte, options NetOptions) string {
	if options.Mode == Binary {
		return base64.StdEncoding.EncodeToString(payload)
	}
	return string(payload)
}

func requestHeaders(headers map[string]string) http.Header {
	header := make(http.Header, len(headers))
	for key, value := range headers {
		header.Set(key, value)
	}
	return header
}

func requestTransport(options RequestOptions) *http.Transport {
	key := requestTransportKey{
		Proxy:    options.Proxy,
		Insecure: options.Insecure,
	}

	if transport := requestTransportCache.load(key); transport != nil {
		return transport
	}

	transport := cloneDefaultTransport()
	transport.Proxy = requestProxy(options.Proxy)
	if options.Insecure {
		transport.TLSClientConfig = &tls.Config{
			InsecureSkipVerify: true,
		}
	}

	return requestTransportCache.store(key, transport)
}

func cloneDefaultTransport() *http.Transport {
	if transport, ok := http.DefaultTransport.(*http.Transport); ok {
		return transport.Clone()
	}

	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

func (c *requestTransportCacheStore) load(key requestTransportKey) *http.Transport {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.entries[key]
}

func (c *requestTransportCacheStore) store(
	key requestTransportKey,
	transport *http.Transport,
) *http.Transport {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing := c.entries[key]; existing != nil {
		transport.CloseIdleConnections()
		return existing
	}

	if len(c.entries) >= maxRequestTransportCacheEntries && len(c.order) > 0 {
		evictedKey := c.order[0]
		c.order = c.order[1:]
		if evicted := c.entries[evictedKey]; evicted != nil {
			evicted.CloseIdleConnections()
			delete(c.entries, evictedKey)
		}
	}

	c.entries[key] = transport
	c.order = append(c.order, key)
	return transport
}

func parseByteRange(s string, size int64) (start int64, end int64, err error) {
	if s == "" {
		return 0, size - 1, nil
	}

	s = strings.TrimSpace(s)

	// "bytes=100-200"
	s = strings.TrimPrefix(s, "bytes=")

	parts := strings.SplitN(s, "-", 2)
	if len(parts) != 2 {
		return 0, 0, errors.New("invalid range format")
	}

	startStr := strings.TrimSpace(parts[0])
	endStr := strings.TrimSpace(parts[1])

	// "-200" last 200 bytes
	if startStr == "" && endStr != "" {
		e, err2 := strconv.ParseInt(endStr, 10, 64)
		if err2 != nil || e < 0 {
			return 0, 0, errors.New("invalid range value")
		}
		if e > size {
			start = 0
		} else {
			start = size - e
		}
		end = size - 1
		return start, end, nil
	}

	// "100-" from start to EOF
	if startStr != "" && endStr == "" {
		start, err = strconv.ParseInt(startStr, 10, 64)
		if err != nil || start < 0 {
			return 0, 0, errors.New("invalid range value")
		}
		end = size - 1
		return start, end, nil
	}

	// "100-200"
	if startStr != "" && endStr != "" {
		start, err = strconv.ParseInt(startStr, 10, 64)
		if err != nil || start < 0 {
			return 0, 0, errors.New("invalid range value")
		}
		end, err = strconv.ParseInt(endStr, 10, 64)
		if err != nil || end < 0 {
			return 0, 0, errors.New("invalid range value")
		}
		if start > end {
			return 0, 0, errors.New("invalid range: start > end")
		}
		if end >= size {
			end = size - 1
		}
		if start > end {
			return 0, 0, errors.New("invalid range: start exceeds file size")
		}
		return start, end, nil
	}

	return 0, 0, errors.New("invalid range format")
}
