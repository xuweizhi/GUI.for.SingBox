package bridge

import (
	"bufio"
	"context"
	"encoding/binary"
	"io"
	"net"
	"os"
	"strconv"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

func TestDNSProbeDependencies(t *testing.T) {
	rt := probeRuntime{Outbounds: []dnsObject{
		{"tag": "leaf", "type": "socks", "server": "localhost", "detour": "group"},
		{"tag": "group", "type": "urltest"},
		{"tag": "hop", "type": "socks", "server": "node.example", "domain_resolver": dnsObject{"server": "resolver", "strategy": "ipv4_only"}},
	}}
	rt.DNS.Servers = []dnsObject{{"tag": "resolver", "type": "udp", "server": "192.0.2.1"}}
	req := dnsProbeRequest{Domain: "test.example", QueryType: "A", Path: "proxy", Tag: "resolver", Proxy: "leaf", Selections: map[string]string{"group": "hop"}, Servers: []dnsObject{{"tag": "resolver", "type": "https", "server": "dns.example", "detour": "original", "domain_resolver": "other", "tls": dnsObject{"server_name": "dns.example"}}}}
	config, err := makeDNSProbeConfig(req, rt, "test")
	if err != nil {
		t.Fatal(err)
	}
	outs := config["outbounds"].([]dnsObject)
	if len(outs) != 3 || outs[1]["type"] != "selector" || outs[1]["outbounds"].([]string)[0] != "hop" {
		t.Fatalf("unexpected chain %#v", outs)
	}
	servers := config["dns"].(dnsObject)["servers"].([]dnsObject)
	target := servers[len(servers)-1]
	if target["detour"] != "leaf" || target["domain_resolver"] != nil || target["tls"] == nil || outs[0]["domain_resolver"].(dnsObject)["server"] != "runtime:resolver" {
		t.Fatalf("wrong routed config %#v", config)
	}
	req.Selections["group"] = "leaf"
	if _, err := makeDNSProbeConfig(req, rt, "test"); err == nil {
		t.Fatal("expected cycle error")
	}
	req.Proxy = "unsupported-endpoint"
	if _, err := makeDNSProbeConfig(req, rt, "test"); err == nil {
		t.Fatal("missing endpoint silently dialed direct")
	}
	req.Path = "direct"
	req.Servers = append(req.Servers, dnsObject{"tag": "other", "type": "local"})
	config, err = makeDNSProbeConfig(req, rt, "test")
	if err != nil {
		t.Fatal(err)
	}
	servers = config["dns"].(dnsObject)["servers"].([]dnsObject)
	target = servers[len(servers)-1]
	if target["detour"] != nil || target["domain_resolver"] != "draft:other" {
		t.Fatalf("wrong direct config %#v", config)
	}
}

func TestDNSProbeAllowsDHCPDependency(t *testing.T) {
	req := dnsProbeRequest{
		Domain:    "test.example",
		QueryType: "A",
		Path:      "direct",
		Tag:       "doh",
		Servers: []dnsObject{
			{"tag": "dhcp-dns", "type": "dhcp"},
			{"tag": "doh", "type": "https", "server": "dns.example", "domain_resolver": "dhcp-dns"},
		},
	}
	config, err := makeDNSProbeConfig(req, probeRuntime{}, "test")
	if err != nil {
		t.Fatalf("expected dhcp resolver dependency to be accepted: %v", err)
	}
	servers := config["dns"].(dnsObject)["servers"].([]dnsObject)
	var hasDHCP, hasDoH bool
	for _, s := range servers {
		if s["tag"] == "draft:dhcp-dns" && s["type"] == "dhcp" {
			hasDHCP = true
		}
		if s["tag"] == "draft:doh" && s["domain_resolver"] == "draft:dhcp-dns" {
			hasDoH = true
		}
	}
	if !hasDHCP || !hasDoH {
		t.Fatalf("expected dhcp dependency and doh server, got %#v", servers)
	}

	req.Tag = "dhcp-dns"
	if _, err := makeDNSProbeConfig(req, probeRuntime{}, "test"); err == nil {
		t.Fatal("expected dhcp target itself to be rejected as non-network DNS")
	}
}

// Both DNS servers answer the same name differently. The proxy handler speaks
// SOCKS5 and answers the DNS exchange itself, so a direct fallback fails the test.
func TestDNSProbeWithInstalledCore(t *testing.T) {
	executable := os.Getenv("SING_BOX_DNS_TEST_BINARY")
	if executable == "" {
		t.Skip("set SING_BOX_DNS_TEST_BINARY to run isolated real-core probes")
	}
	listen := func(proxy bool, answer byte) *net.TCPAddr {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { listener.Close() })
		go func() {
			for {
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				go func() {
					defer conn.Close()
					conn.SetDeadline(time.Now().Add(5 * time.Second))
					src := bufio.NewReader(conn)
					if proxy {
						header := make([]byte, 2)
						if _, err := io.ReadFull(src, header); err != nil || header[0] != 5 {
							return
						}
						if _, err := src.Discard(int(header[1])); err != nil {
							return
						}
						if _, err := conn.Write([]byte{5, 0}); err != nil {
							return
						}
						dest := make([]byte, 4)
						if _, err := io.ReadFull(src, dest); err != nil || dest[1] != 1 || dest[3] != 1 {
							return
						}
						if _, err := src.Discard(6); err != nil {
							return
						}
						if _, err := conn.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0}); err != nil {
							return
						}
					}
					var length uint16
					if err := binary.Read(src, binary.BigEndian, &length); err != nil {
						return
					}
					body := make([]byte, length)
					if _, err := io.ReadFull(src, body); err != nil {
						return
					}
					var msg dnsmessage.Message
					if err := msg.Unpack(body); err != nil || len(msg.Questions) != 1 {
						return
					}
					msg.Header.Response = true
					msg.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: msg.Questions[0].Name, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeA, TTL: 60}, Body: &dnsmessage.AResource{A: [4]byte{192, 0, 2, answer}}}}
					body, err := msg.Pack()
					if err != nil {
						return
					}
					frame := binary.BigEndian.AppendUint16(nil, uint16(len(body)))
					conn.Write(append(frame, body...))
				}()
			}
		}()
		return listener.Addr().(*net.TCPAddr)
	}
	direct, proxy := listen(false, 1), listen(true, 2)
	req := dnsProbeRequest{Domain: "test.example", QueryType: "A", Tag: "test", Proxy: "selected", Servers: []dnsObject{{"tag": "test", "type": "tcp", "server": "127.0.0.1", "server_port": direct.Port}}}
	rt := probeRuntime{Outbounds: []dnsObject{{"tag": "selected", "type": "socks", "server": "127.0.0.1", "server_port": proxy.Port, "version": "5"}}}
	for i, path := range []string{"direct", "proxy"} {
		t.Run(path, func(t *testing.T) {
			req.Path = path
			config, err := makeDNSProbeConfig(req, rt, "secret")
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			result, err := runDNSProbe(ctx, executable, config, "secret", req.Domain, req.QueryType)
			if err != nil || result.Error != "" || len(result.Answers) != 1 || result.Answers[0] != "192.0.2."+strconv.Itoa(i+1) {
				t.Fatalf("%+v, %v", result, err)
			}
		})
	}
}
