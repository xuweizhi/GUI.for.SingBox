package bridge

import (
	"net/http"
	"testing"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestRequestTransportFallsBackWhenDefaultTransportIsCustom(t *testing.T) {
	originalDefaultTransport := http.DefaultTransport
	http.DefaultTransport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return nil, nil
	})
	requestTransportCache = requestTransportCacheStore{
		entries: map[requestTransportKey]*http.Transport{},
	}
	t.Cleanup(func() {
		http.DefaultTransport = originalDefaultTransport
		requestTransportCache = requestTransportCacheStore{
			entries: map[requestTransportKey]*http.Transport{},
		}
	})

	transport := requestTransport(RequestOptions{
		Proxy:    "http://127.0.0.1:18080",
		Insecure: true,
	})

	if transport == nil {
		t.Fatal("expected transport to be created")
	}
	if transport.Proxy == nil {
		t.Fatal("expected custom proxy function to be configured")
	}
	if transport.TLSClientConfig == nil || !transport.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("expected insecure TLS config to be preserved")
	}
}
