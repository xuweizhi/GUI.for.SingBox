package bridge

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type dnsObject = map[string]any

type dnsProbeRequest struct {
	Branch     string            `json:"branch"`
	Domain     string            `json:"domain"`
	QueryType  string            `json:"queryType"`
	Servers    []dnsObject       `json:"servers"`
	Tag        string            `json:"tag"`
	Path       string            `json:"path"`
	Proxy      string            `json:"proxy"`
	Selections map[string]string `json:"selections"`
}

type dnsProbeResult struct {
	Answers  []string `json:"answers,omitempty"`
	Duration int64    `json:"durationMs"`
	Error    string   `json:"error,omitempty"`
}

type probeRuntime struct {
	Outbounds []dnsObject `json:"outbounds"`
	DNS       struct {
		Servers []dnsObject `json:"servers"`
	} `json:"dns"`
	Route dnsObject `json:"route"`
}

// Build just the dialers and resolvers needed by this probe. Listeners, rule sets,
// cache and stateful endpoints from the live service must stay in their process.
type probeGraph struct {
	request   dnsProbeRequest
	runtime   probeRuntime
	outbounds []dnsObject
	servers   []dnsObject
	visiting  map[string]bool
	done      map[string]bool
}

func textField(obj dnsObject, field string) string {
	value, _ := obj[field].(string)
	return value
}

func probeFind(entries []dnsObject, tag string) (dnsObject, error) {
	var found dnsObject
	for _, entry := range entries {
		if textField(entry, "tag") == tag {
			if found != nil {
				return nil, fmt.Errorf("ambiguous transport tag %q", tag)
			}
			found = entry
		}
	}
	if found != nil {
		return maps.Clone(found), nil
	}
	return nil, fmt.Errorf("no probeable transport with tag %q", tag)
}

func (g *probeGraph) visit(key string, build func() error) error {
	if g.done[key] {
		return nil
	}
	if g.visiting[key] {
		return fmt.Errorf("cyclic probe dependency: %s", key)
	}
	g.visiting[key] = true
	defer delete(g.visiting, key)
	if err := build(); err != nil {
		return err
	}
	g.done[key] = true
	return nil
}

func (g *probeGraph) addOutbound(tag string) error {
	return g.visit("out:"+tag, func() error {
		out, err := probeFind(g.runtime.Outbounds, tag)
		if err != nil {
			return err
		}
		switch textField(out, "type") {
		case "selector", "urltest":
			selected := g.request.Selections[tag]
			if selected == "" {
				return fmt.Errorf("no current selection for %q", tag)
			}
			if err := g.addOutbound(selected); err != nil {
				return err
			}
			out = dnsObject{"type": "selector", "tag": tag, "outbounds": []string{selected}}
		case "socks", "http", "shadowsocks", "shadowsocksr", "trojan", "vless", "vmess", "anytls", "naive", "hysteria", "hysteria2", "tuic", "ssh", "shadowtls":
			if textField(out, "plugin") != "" {
				return errors.New("external plugin transports cannot be isolated")
			}
			if next := textField(out, "detour"); next != "" {
				if err := g.addOutbound(next); err != nil {
					return err
				}
			} else if err := g.addResolver(out, true); err != nil {
				return err
			}
		default:
			return fmt.Errorf("outbound %q (%s) cannot be used for an isolated proxy probe", tag, out["type"])
		}
		g.outbounds = append(g.outbounds, out)
		return nil
	})
}

func (g *probeGraph) addResolver(obj dnsObject, runtime bool) error {
	server := textField(obj, "server")
	if _, err := netip.ParseAddr(server); server == "" || err == nil {
		delete(obj, "domain_resolver")
		return nil
	}
	resolver := obj["domain_resolver"]
	if resolver == nil && runtime {
		resolver = g.runtime.Route["default_domain_resolver"]
	}
	key, _ := resolver.(string)
	options, _ := resolver.(map[string]any)
	if options != nil {
		key = textField(options, "server")
	}
	if key == "" {
		obj["domain_resolver"] = "bootstrap"
		return nil
	}
	newTag, err := g.addServer(key, runtime)
	if err != nil {
		return err
	}
	if options != nil {
		options = maps.Clone(options)
		options["server"] = newTag
		obj["domain_resolver"] = options
	} else {
		obj["domain_resolver"] = newTag
	}
	return nil
}

func (g *probeGraph) addServer(tag string, runtime bool) (string, error) {
	name := "draft:" + tag
	entries := g.request.Servers
	if runtime {
		name = "runtime:" + tag
		entries = g.runtime.DNS.Servers
	}
	err := g.visit("dns:"+name, func() error {
		server, err := probeFind(entries, tag)
		if err != nil {
			return err
		}
		server["tag"] = name
		switch textField(server, "type") {
		case "local", "hosts", "dhcp":
			if !runtime && tag == g.request.Tag {
				return errors.New("diagnostics.notNetworkDns")
			}
		case "udp", "tcp", "tls", "https", "quic", "h3":
		default:
			return errors.New("diagnostics.notNetworkDns")
		}
		detour := textField(server, "detour")
		if !runtime {
			// Draft resolvers are tested on the explicit path. Preserve extended
			// server/TLS options, but bypass the profile's ordinary DNS routing.
			detour = ""
			if tag == g.request.Tag && g.request.Path == "proxy" {
				detour = g.request.Proxy
			}
		}
		if detour != "" {
			if err := g.addOutbound(detour); err != nil {
				return err
			}
			server["detour"] = detour
			delete(server, "domain_resolver")
		} else {
			delete(server, "detour")
			if err := g.addResolver(server, runtime); err != nil {
				return err
			}
		}
		g.servers = append(g.servers, server)
		return nil
	})
	return name, err
}

func makeDNSProbeConfig(req dnsProbeRequest, runtime probeRuntime, secret string) (dnsObject, error) {
	if req.Path != "direct" && req.Path != "proxy" {
		return nil, errors.New("invalid probe path")
	}
	if req.Path == "proxy" && req.Proxy == "" {
		return nil, errors.New("diagnostics.noProxy")
	}
	if req.QueryType != "A" && req.QueryType != "AAAA" {
		return nil, errors.New("invalid query type")
	}
	if req.Domain == "" || len(req.Domain) > 253 || strings.ContainsAny(req.Domain, " \r\n\t/:?#") {
		return nil, errors.New("invalid DNS name")
	}
	g := probeGraph{request: req, runtime: runtime, visiting: map[string]bool{}, done: map[string]bool{}, servers: []dnsObject{{"type": "local", "tag": "bootstrap"}}}
	final, err := g.addServer(req.Tag, false)
	if err != nil {
		return nil, err
	}
	route := dnsObject{"default_domain_resolver": "bootstrap"}
	for _, key := range []string{"default_mark", "auto_detect_interface", "default_interface"} {
		if value, ok := runtime.Route[key]; ok {
			route[key] = value
		}
	}
	return dnsObject{
		"log":       dnsObject{"level": "info", "disabled": false},
		"dns":       dnsObject{"servers": g.servers, "final": final, "disable_cache": true},
		"outbounds": g.outbounds, "route": route,
		"experimental": dnsObject{"clash_api": dnsObject{"external_controller": "127.0.0.1:0", "secret": secret}},
	}, nil
}

var probeListener = regexp.MustCompile(`restful api listening at (127\.0\.0\.1:[0-9]+)`)
var probeSlots = make(chan struct{}, 4)

func runDNSProbe(ctx context.Context, executable string, config dnsObject, secret, domain, queryType string) (dnsProbeResult, error) {
	dir, err := os.MkdirTemp("", "gfs-dns-probe-")
	if err != nil {
		return dnsProbeResult{}, err
	}
	defer os.RemoveAll(dir)
	data, err := json.Marshal(config)
	if err != nil {
		return dnsProbeResult{}, err
	}
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		return dnsProbeResult{}, err
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(child, executable, "run", "-D", dir, "-c", path)
	SetCmdWindowHidden(cmd)
	cmd.Dir = dir
	output, err := cmd.StdoutPipe()
	if err != nil {
		return dnsProbeResult{}, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return dnsProbeResult{}, err
	}
	type startup struct{ addr, failure string }
	started := make(chan startup, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		var last string
		scanner := bufio.NewScanner(output)
		announced := false
		for scanner.Scan() {
			if announced {
				continue
			}
			last = scanner.Text()
			if m := probeListener.FindStringSubmatch(last); m != nil {
				started <- startup{addr: m[1]}
				announced = true
			}
		}
		if !announced {
			started <- startup{failure: last}
		}
	}()
	defer func() {
		cancel()
		output.Close()
		<-done
		cmd.Wait()
	}()
	var addr string
	select {
	case <-ctx.Done():
		return dnsProbeResult{}, ctx.Err()
	case s := <-started:
		if s.addr == "" {
			return dnsProbeResult{}, fmt.Errorf("DNS probe core did not start: %s", s.failure)
		}
		addr = s.addr
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/dns/query?"+url.Values{"name": {domain}, "type": {queryType}}.Encode(), nil)
	if err != nil {
		return dnsProbeResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	// The HTTP request always stays on loopback; only the core issues DNS traffic.
	client := http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return dnsProbeResult{}, err
	}
	defer resp.Body.Close()
	var dns struct {
		Status  *int
		Message string
		Answer  []struct {
			Data string
			Type int
		}
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&dns); err != nil {
		return dnsProbeResult{}, err
	}
	result := dnsProbeResult{Duration: time.Since(start).Milliseconds()}
	if resp.StatusCode != 200 {
		result.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, dns.Message)
		return result, nil
	}
	if dns.Status == nil {
		return result, errors.New("invalid DNS response")
	}
	if *dns.Status != 0 {
		result.Error = fmt.Sprintf("DNS RCODE %d", *dns.Status)
		return result, nil
	}
	for _, rr := range dns.Answer {
		if rr.Data != "" && (rr.Type == 1 && queryType == "A" || rr.Type == 28 && queryType == "AAAA") {
			result.Answers = append(result.Answers, rr.Data)
		}
	}
	if len(result.Answers) == 0 {
		result.Error = "diagnostics.noAnswer"
	}
	return result, nil
}

func probeDNS(req dnsProbeRequest) (result dnsProbeResult) {
	if req.Branch != "main" && req.Branch != "alpha" {
		return dnsProbeResult{Error: "invalid core branch"}
	}
	select {
	case probeSlots <- struct{}{}:
		defer func() { <-probeSlots }()
	default:
		return dnsProbeResult{Error: "diagnostics.probeBusy"}
	}
	var runtime probeRuntime
	data, err := os.ReadFile(resolvePath(headlessCoreConfigFilePath))
	if err == nil {
		err = json.Unmarshal(data, &runtime)
	}
	if err != nil && req.Path == "proxy" {
		return dnsProbeResult{Error: err.Error()}
	}
	secret := rand.Text()
	conf, err := makeDNSProbeConfig(req, runtime, secret)
	if err != nil {
		return dnsProbeResult{Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	result, err = runDNSProbe(ctx, resolvePath(headlessCoreWorkingDirectory+"/"+headlessCoreFileName(req.Branch)), conf, secret, req.Domain, req.QueryType)
	if err != nil {
		result.Error = err.Error()
	}
	return result
}
