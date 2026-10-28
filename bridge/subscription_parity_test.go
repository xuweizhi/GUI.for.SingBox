package bridge

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func backendFixtureBase(t *testing.T) {
	t.Helper()
	before := Env.BasePath
	Env.BasePath = t.TempDir()
	t.Cleanup(func() { Env.BasePath = before })
}
func backendFixtureWrite(t *testing.T, path, content string) {
	t.Helper()
	target := resolvePath(path)
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}
func backendFixtureRead(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(resolvePath(path))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
func backendFixtureWorker(t *testing.T) *scheduledTaskWorkerSupervisor {
	t.Helper()
	seedTaskWorkerArtifacts(t)
	worker := NewApp().taskWorker()
	t.Cleanup(worker.stop)
	return worker
}

func TestBackendSubscriptionPreservesFutureFieldsThroughWorkerAndYAML(t *testing.T) {
	backendFixtureBase(t)
	worker := backendFixtureWorker(t)
	backendFixtureWrite(t, "data/nodes.json", `[{"type":"wireguard","tag":"wg","_gui_kind":"endpoint","peers":[{"address":"wg.invalid","port":51820}]}]`)
	backendFixtureWrite(t, subscribesFilePath, `- id: s
  name: Subscription
  type: Manual
  path: data/nodes.json
  preferOutboundDns: true
  outboundDns: [9.9.9.9]
  importedDns:
    servers: [{type: udp, tag: dns, server: 1.1.1.1, futureServer: true}]
    resolver: dns
    futureDns: {nested: 3}
  futureSubscription: {values: [1, two, true]}
  header:
    request: {User-Agent: test}
    response: {}
    futureHeader: keep
  proxies: [{id: stable, tag: wg, type: wireguard, kind: endpoint, futureMetadata: keep}]
  script: 'const onSubscribe = async (proxies, subscription) => ({proxies, subscription, extra: true})'
- id: untouched
  disabled: true
  preferOutboundDns: true
  outboundDns: [8.8.8.8]
  futureSubscription: untouched
  proxies: [{id: untouched-node, tag: untouched, type: wireguard, kind: endpoint, futureMetadata: original}]
`)
	if _, err := worker.updateSubscriptionByID("s", backendNetworkSettings{RequestProxyMode: "none"}); err != nil {
		t.Fatal(err)
	}
	var saved []map[string]any
	if err := yaml.Unmarshal([]byte(backendFixtureRead(t, subscribesFilePath)), &saved); err != nil {
		t.Fatal(err)
	}
	current := saved[0]
	if current["preferOutboundDns"] != true || current["futureSubscription"] == nil || current["importedDns"] == nil {
		t.Fatalf("lost fields: %+v", current)
	}
	header := current["header"].(map[string]any)
	if header["futureHeader"] != "keep" {
		t.Fatal("lost unknown header field")
	}
	dns := current["importedDns"].(map[string]any)
	if dns["futureDns"] == nil {
		t.Fatal("lost unknown DNS field")
	}
	metadata := current["proxies"].([]any)[0].(map[string]any)
	if metadata["id"] != "stable" || metadata["kind"] != "endpoint" || metadata["futureMetadata"] != "keep" {
		t.Fatalf("lost metadata: %v", metadata)
	}
	if saved[1]["futureSubscription"] != "untouched" || saved[1]["preferOutboundDns"] != true {
		t.Fatalf("untouched subscription changed: %+v", saved[1])
	}
	// Structured profile fields and nested future fields survive the sync writeback.
	backendFixtureWrite(t, "data/user.yaml", "kernel:\n  profile: p\n")
	backendFixtureWrite(t, profilesFilePath, `- id: p
  native: {endpoints: [{type: wireguard, tag: wg}]}
  futureProfile: preserved
  outbounds:
  - id: outbound-select
    tag: Select
    type: selector
    role: proxy
    pre_proxy: upstream
    url: https://probe.invalid
    interval: 5m
    tolerance: 50
    interrupt_exist_connections: true
    include: HongKong
    exclude: Expired
    source_node_group: group
    native: {default: node}
    futureStrategy: {newField: value}
    outbounds: [{id: s, tag: s, type: Subscription, futureRef: keep}]
`)
	if _, _, err := syncSubscriptionOutboundRefs(); err != nil {
		t.Fatal(err)
	}
	savedProfile := backendFixtureRead(t, profilesFilePath)
	for _, key := range []string{"pre_proxy:", "interval:", "tolerance:", "include:", "exclude:", "role:", "futureProfile:", "futureStrategy:", "futureRef:", "endpoints:", "default:"} {
		if !strings.Contains(savedProfile, key) {
			t.Fatalf("lost %s in %s", key, savedProfile)
		}
	}
	profiles, err := loadProfiles()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(profiles)
	if err != nil {
		t.Fatal(err)
	}
	var roundtrip []profileConfig
	if err = json.Unmarshal(payload, &roundtrip); err != nil {
		t.Fatal(err)
	}
	if roundtrip[0].Outbounds[0].Extra["pre_proxy"] != "upstream" || roundtrip[0].Outbounds[0].Outbounds[0].Extra["futureRef"] != "keep" {
		t.Fatalf("profile JSON lost unknown fields: %s", payload)
	}
}

func TestBackendSubscriptionMixedEndpointDNSPrefixAndStableIdentity(t *testing.T) {
	backendFixtureBase(t)
	backendFixtureWrite(t, "data/old.json", `[{"type":"socks","tag":"P-old","server":"same.invalid","server_port":1080},{"type":"wireguard","tag":"P-wg-old","_gui_kind":"endpoint","peers":[{"address":"WG.INVALID","port":51820,"public_key":"old"}]}]`)
	backendFixtureWrite(t, "data/source.json", `{"outbounds":[{"type":"socks","tag":"new","server":"same.invalid","server_port":1080},{"type":"socks","tag":"down","detour":"new"},{"type":"selector","tag":"select","outbounds":["new","wg-new"],"default":"new"}],"endpoints":[{"type":"wireguard","tag":"wg-new","peers":[{"address":"wg.invalid","port":51820,"public_key":"new"}]}],"dns":{"servers":[{"type":"tls","tag":"dns","server":"dns.invalid","detour":"new","domain_resolver":"bootstrap"},{"type":"udp","tag":"bootstrap","server":"1.1.1.1"}],"final":"dns"},"route":{"default_domain_resolver":{"server":"dns"}}}`)
	subscribe := subscriptionConfig{ID: "s", Type: "File", URL: "data/source.json", Path: "data/old.json", ProxyPrefix: "P-", PreferOutboundDns: true, OutboundDns: []string{"9.9.9.9"}, Proxies: []subscriptionProxyConfig{{ID: "normal-stable", Tag: "P-old", Type: "socks"}, {ID: "endpoint-stable", Tag: "P-wg-old", Type: "wireguard", Kind: "endpoint"}}}
	if err := NewApp().taskWorker().doUpdateSubscription(&subscribe, backendNetworkSettings{}); err != nil {
		t.Fatal(err)
	}
	nodes := cachedSubscriptionNodes(subscribe.Path)
	if len(nodes) != 4 {
		t.Fatalf("lost endpoint: %v", nodes)
	}
	if nodes[1]["detour"] != "P-new" || nodes[2]["default"] != "P-new" || nodes[2]["outbounds"].([]any)[1] != "P-wg-new" {
		t.Fatalf("references not rewritten: %v", nodes)
	}
	if nodes[3]["_gui_kind"] != "endpoint" || subscribe.Proxies[3].Kind != "endpoint" {
		t.Fatal("lost endpoint marker")
	}
	if subscribe.Proxies[0].ID != "normal-stable" || subscribe.Proxies[3].ID != "endpoint-stable" {
		t.Fatalf("renamed nodes changed identity: %+v", subscribe.Proxies)
	}
	if subscribe.ImportedDns == nil || subscribe.ImportedDns.Resolver != "dns" || subscribe.ImportedDns.Servers[0]["detour"] != "P-new" || subscribe.ImportedDns.Servers[0]["domain_resolver"] != "bootstrap" {
		t.Fatalf("DNS context lost: %+v", subscribe.ImportedDns)
	}
	if !subscribe.PreferOutboundDns || !reflect.DeepEqual(subscribe.OutboundDns, []string{"9.9.9.9"}) {
		t.Fatal("manual DNS settings changed")
	}
	backendFixtureWrite(t, "data/source.json", `{"endpoints":[{"type":"tailscale","tag":"ts","state_directory":"state"}]}`)
	if err := NewApp().taskWorker().doUpdateSubscription(&subscribe, backendNetworkSettings{}); err != nil {
		t.Fatal(err)
	}
	if len(subscribe.Proxies) != 1 || subscribe.Proxies[0].Kind != "endpoint" || subscribe.ImportedDns != nil {
		t.Fatal("endpoint-only refresh or stale DNS cleanup failed")
	}
}

func TestBackendClashDNSAndNativeConverterPreservation(t *testing.T) {
	extracted, err := extractSubscription("proxies:\n - {name: sample, type: ss, server: s.invalid, port: 443}\ndns:\n proxy-server-nameserver: [tls://dns.invalid:853, '2001:db8::1', https://dns.invalid/dns-query]\n")
	if err != nil || extracted.DNS == nil || len(extracted.DNS.Servers) != 3 {
		t.Fatalf("extract Clash DNS: %+v %v", extracted, err)
	}
	for _, invalid := range []string{"https://user:pass@dns.invalid/dns-query", "udp://dns.invalid:0", "https://dns.invalid/path?q=x", "udp://dns.invalid/not-allowed"} {
		if _, err := parseSubscriptionDNSAddresses([]string{invalid}); err == nil {
			t.Fatalf("accepted invalid DNS %s", invalid)
		}
	}
	backendFixtureBase(t)
	worker := backendFixtureWorker(t)
	nodes := []map[string]any{{"type": "socks", "tag": "native", "domain_resolver": "native-dns"}, {"type": "tailscale", "tag": "endpoint", "_gui_kind": "endpoint", "state_directory": "state"}, {"name": "clash", "type": "ss", "server": "s.invalid", "port": 443, "cipher": "aes-128-gcm", "password": "test"}}
	normalized, err := worker.normalizeSubscriptionProxiesWithWorker(nodes, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(normalized) != 3 || normalized[0]["domain_resolver"] != "native-dns" || normalized[1]["_gui_kind"] != "endpoint" {
		t.Fatalf("native entries damaged by converter: %v", normalized)
	}
}

func TestBackendSubscriptionCacheRollbackAndFailedScriptIsolation(t *testing.T) {
	backendFixtureBase(t)
	backendFixtureWrite(t, "data/cache-a.json", "old-a")
	backendFixtureWrite(t, "data/cache-b.json", "old-b")
	updates := []preparedSubscriptionUpdate{{WriteCache: true, CachePath: resolvePath("data/cache-a.json"), Cache: []byte("new-a")}, {WriteCache: true, CachePath: resolvePath("data/cache-b.json"), Cache: []byte("new-b")}, {WriteCache: true, CachePath: resolvePath("data/new.json"), Cache: []byte("new")}}
	failure := errors.New("metadata save failed")
	if err := commitSubscriptionUpdates(updates, func() error { return failure }); !errors.Is(err, failure) {
		t.Fatalf("save error lost: %v", err)
	}
	if backendFixtureRead(t, "data/cache-a.json") != "old-a" || backendFixtureRead(t, "data/cache-b.json") != "old-b" {
		t.Fatal("previous caches were not restored")
	}
	if _, err := os.Stat(resolvePath("data/new.json")); !os.IsNotExist(err) {
		t.Fatal("new cache must be removed after rollback")
	}
	worker := backendFixtureWorker(t)
	backendFixtureWrite(t, "data/manual.json", `[{"type":"socks","tag":"node"}]`)
	subscribe := subscriptionConfig{ID: "s", Type: "Manual", Path: "data/manual.json", Extra: map[string]any{"future": map[string]any{"keep": true}}, Script: `const onSubscribe = async (proxies, subscription) => { subscription.future.keep = false; throw new Error('script failed') }`}
	before, _ := json.Marshal(subscribe)
	if err := worker.doUpdateSubscription(&subscribe, backendNetworkSettings{}); err == nil {
		t.Fatal("script should fail")
	}
	after, _ := json.Marshal(subscribe)
	if string(before) != string(after) {
		t.Fatalf("failed update mutated input: %s", after)
	}
	if backendFixtureRead(t, "data/manual.json") != `[{"type":"socks","tag":"node"}]` {
		t.Fatal("failed script changed cache")
	}
}

func TestBackendSubscriptionFlatFileCacheAndDuplicateIdentity(t *testing.T) {
	backendFixtureBase(t)
	backendFixtureWrite(t, "data/cache.json", `[{"type":"wireguard","tag":"wg","_gui_kind":"endpoint"}]`)
	subscribe := subscriptionConfig{Type: "File", URL: "data/cache.json", Path: "data/cache.json", ImportedDns: &subscriptionDNSConfig{Servers: []map[string]any{{"type": "udp", "tag": "dns", "server": "1.1.1.1"}}, Resolver: "dns"}}
	if err := NewApp().taskWorker().doUpdateSubscription(&subscribe, backendNetworkSettings{}); err != nil {
		t.Fatal(err)
	}
	if subscribe.ImportedDns == nil || len(subscribe.Proxies) != 1 || subscribe.Proxies[0].Kind != "endpoint" {
		t.Fatal("flat File cache metadata lost")
	}
	next := reconcileSubscriptionIDs([]subscriptionProxyConfig{{ID: "old", Tag: "duplicate", Type: "socks"}}, nil, []map[string]any{{"type": "socks", "tag": "duplicate"}, {"type": "socks", "tag": "duplicate"}})
	if next[0].ID == next[1].ID || next[0].ID == "old" || next[1].ID == "old" {
		t.Fatalf("ambiguous identity reused: %v", next)
	}
}

func TestBackendSubscriptionRollbackBeforeMetadataAndReportsRestoreFailure(t *testing.T) {
	backendFixtureBase(t)
	backendFixtureWrite(t, "data/cache.json", "old")
	backendFixtureWrite(t, "data/blocked", "a file, not a directory")
	saved := false
	updates := []preparedSubscriptionUpdate{{WriteCache: true, CachePath: resolvePath("data/cache.json"), Cache: []byte("new")}, {WriteCache: true, CachePath: resolvePath("data/blocked/cache.json"), Cache: []byte("cannot write")}}
	if err := commitSubscriptionUpdates(updates, func() error { saved = true; return nil }); err == nil {
		t.Fatal("blocked cache must fail")
	}
	if saved || backendFixtureRead(t, "data/cache.json") != "old" {
		t.Fatal("cache failure changed metadata or earlier cache")
	}
	cause := errors.New("metadata failed")
	err := commitSubscriptionUpdates(updates[:1], func() error {
		if err := os.Remove(resolvePath("data/cache.json")); err != nil {
			return err
		}
		if err := os.Mkdir(resolvePath("data/cache.json"), 0700); err != nil {
			return err
		}
		return cause
	})
	if !errors.Is(err, cause) || !strings.Contains(err.Error(), "restore subscription cache") {
		t.Fatalf("must expose both save and rollback failure: %v", err)
	}
}
