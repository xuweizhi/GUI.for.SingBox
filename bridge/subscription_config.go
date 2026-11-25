package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type extractedSubscription struct {
	Proxies   []map[string]any
	DNS       *subscriptionDNSConfig
	FlatCache bool
}

func extractSubscription(body string) (extractedSubscription, error) {
	var value any
	if err := json.Unmarshal([]byte(body), &value); err != nil {
		if err := yaml.Unmarshal([]byte(body), &value); err != nil {
			return extractedSubscription{}, errors.New("Not a valid subscription data")
		}
	}
	if entries, ok := value.([]any); ok {
		nodes, err := subscriptionEntries(entries, true)
		return extractedSubscription{Proxies: nodes, FlatCache: true}, err
	}
	payload, ok := value.(map[string]any)
	if !ok {
		return extractedSubscription{}, errors.New("Not a valid subscription data")
	}
	out := extractedSubscription{Proxies: []map[string]any{}}
	found := false
	for _, kind := range []string{"outbounds", "endpoints"} {
		raw, exists := payload[kind]
		if !exists {
			continue
		}
		found = true
		entries, ok := raw.([]any)
		if !ok {
			return out, fmt.Errorf("Subscription %s must be an array", kind)
		}
		nodes, err := subscriptionEntries(entries, true)
		if err != nil {
			return out, err
		}
		for _, node := range nodes {
			if kind == "endpoints" {
				node["_gui_kind"] = "endpoint"
			}
			out.Proxies = append(out.Proxies, node)
		}
	}
	if !found {
		if raw, exists := payload["proxies"]; exists {
			found = true
			entries, ok := raw.([]any)
			if !ok {
				return out, errors.New("Subscription proxies must be an array")
			}
			nodes, err := subscriptionEntries(entries, false)
			if err != nil {
				return out, err
			}
			out.Proxies = nodes
		}
	}
	if !found {
		return out, errors.New("Subscription configuration has no outbounds or endpoints")
	}
	dns, ok := payload["dns"].(map[string]any)
	if !ok {
		return out, nil
	}
	if raw, exists := dns["servers"]; exists {
		entries, ok := raw.([]any)
		if !ok {
			return out, errors.New("Subscription DNS servers must be an array of objects")
		}
		servers, err := subscriptionEntries(entries, false)
		if err != nil {
			return out, fmt.Errorf("Subscription DNS servers: %w", err)
		}
		for i, server := range servers {
			if tag, ok := server["tag"].(string); !ok || tag == "" {
				server["tag"] = fmt.Sprintf("dns-%d", i+1)
			}
		}
		if len(servers) > 0 {
			resolver := ""
			if route, ok := payload["route"].(map[string]any); ok {
				resolver, _ = route["default_domain_resolver"].(string)
				if config, ok := route["default_domain_resolver"].(map[string]any); ok {
					resolver, _ = config["server"].(string)
				}
			}
			if resolver == "" {
				resolver, _ = dns["final"].(string)
			}
			if resolver == "" {
				resolver = stringValue(servers[0]["tag"])
			}
			out.DNS = &subscriptionDNSConfig{Servers: servers, Resolver: resolver}
		}
	} else if raw, exists := dns["proxy-server-nameserver"]; exists {
		var addresses []string
		switch values := raw.(type) {
		case string:
			addresses = []string{values}
		case []any:
			for _, value := range values {
				address, ok := value.(string)
				if !ok {
					return out, errors.New("Subscription proxy-server-nameserver must contain DNS addresses")
				}
				addresses = append(addresses, address)
			}
		default:
			return out, errors.New("Subscription proxy-server-nameserver must contain DNS addresses")
		}
		servers, err := parseSubscriptionDNSAddresses(addresses)
		if err != nil {
			return out, err
		}
		if len(servers) > 0 {
			out.DNS = &subscriptionDNSConfig{Servers: servers, Resolver: stringValue(servers[0]["tag"])}
		}
	}
	return out, nil
}

func subscriptionEntries(values []any, validate bool) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(values))
	for i, value := range values {
		entry, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("Subscription entry %d must be an object", i+1)
		}
		if validate {
			if err := validateSubscriptionEntry(entry, i); err != nil {
				return nil, err
			}
		}
		out = append(out, entry)
	}
	return out, nil
}
func validateSubscriptionEntry(entry map[string]any, index int) error {
	if value, ok := entry["type"].(string); !ok || strings.TrimSpace(value) == "" {
		return fmt.Errorf("Subscription node %d must have a protocol type", index+1)
	}
	if value, ok := entry["tag"].(string); !ok || strings.TrimSpace(value) == "" {
		return fmt.Errorf("Subscription node %d must have a non-empty tag", index+1)
	}
	if value, ok := entry["_gui_kind"]; ok && value != "endpoint" {
		return fmt.Errorf("Subscription node %s has an invalid endpoint marker", entry["tag"])
	}
	return nil
}
func parseSubscriptionDNSAddresses(addresses []string) ([]map[string]any, error) {
	servers := []map[string]any{}
	seen := map[string]bool{}
	for _, address := range addresses {
		address = strings.TrimSuffix(strings.TrimSpace(address), "#DIRECT")
		if address == "" || seen[address] {
			continue
		}
		seen[address] = true
		tag := fmt.Sprintf("dns-%d", len(servers)+1)
		if address == "local" || address == "local://" || address == "system" || address == "system://" {
			servers = append(servers, map[string]any{"type": "local", "tag": tag})
			continue
		}
		fail := func() ([]map[string]any, error) {
			return nil, fmt.Errorf("Invalid or unsupported subscription DNS address: %s", address)
		}
		if strings.ContainsAny(address, " \t\r\n") {
			return fail()
		}
		if iface, ok := strings.CutPrefix(address, "dhcp://"); ok {
			server := map[string]any{"type": "dhcp", "tag": tag}
			if strings.ContainsAny(iface, "/?#@") {
				return fail()
			}
			if iface != "" && iface != "auto" {
				server["interface"] = iface
			}
			servers = append(servers, server)
			continue
		}
		raw := address
		if !strings.Contains(raw, "://") {
			if strings.Count(raw, ":") > 1 && !strings.HasPrefix(raw, "[") {
				raw = "[" + raw + "]"
			}
			raw = "udp://" + raw
		}
		parsed, err := url.Parse(raw)
		if err != nil {
			return fail()
		}
		switch parsed.Scheme {
		case "udp", "tcp", "tls", "quic", "https", "h3":
		default:
			return fail()
		}
		if parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || parsed.ForceQuery {
			return fail()
		}
		if parsed.Scheme != "https" && parsed.Scheme != "h3" && parsed.Path != "" && parsed.Path != "/" {
			return fail()
		}
		server := map[string]any{"type": parsed.Scheme, "tag": tag, "server": parsed.Hostname()}
		if port := parsed.Port(); port != "" {
			number, err := strconv.ParseUint(port, 10, 16)
			if err != nil || number == 0 {
				return fail()
			}
			server["server_port"] = number
		}
		if parsed.Scheme == "https" || parsed.Scheme == "h3" {
			path := parsed.Path
			if path == "" || path == "/" {
				path = "/dns-query"
			}
			server["path"] = path
		}
		servers = append(servers, server)
	}
	return servers, nil
}

func prefixSubscriptionReferences(proxies []map[string]any, dns *subscriptionDNSConfig, prefix string) {
	if prefix == "" {
		return
	}
	renamed := map[string]string{}
	for _, proxy := range proxies {
		tag := stringValue(proxy["tag"])
		if strings.HasPrefix(tag, prefix) {
			renamed[tag] = tag
		} else {
			renamed[tag] = prefix + tag
		}
	}
	reference := func(value any) any {
		if tag, ok := value.(string); ok {
			if next, ok := renamed[tag]; ok {
				return next
			}
		}
		return value
	}
	for _, proxy := range proxies {
		for _, field := range []string{"tag", "detour", "default"} {
			if value, exists := proxy[field]; exists {
				proxy[field] = reference(value)
			}
		}
		if refs, ok := proxy["outbounds"].([]any); ok {
			for i, value := range refs {
				refs[i] = reference(value)
			}
		}
	}
	if dns != nil {
		for _, server := range dns.Servers {
			for _, field := range []string{"detour", "endpoint"} {
				if value, exists := server[field]; exists {
					server[field] = reference(value)
				}
			}
		}
	}
}

func canonicalSubscriptionValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, item := range value {
			if key != "tag" && !strings.HasPrefix(key, "__") {
				out[key] = canonicalSubscriptionValue(item)
			}
		}
		return out
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			out[i] = canonicalSubscriptionValue(item)
		}
		return out
	default:
		return value
	}
}
func subscriptionFingerprint(node map[string]any) string {
	if node == nil {
		return ""
	}
	data, err := json.Marshal(canonicalSubscriptionValue(node))
	if err != nil {
		return ""
	}
	return string(data)
}
func subscriptionEndpointKey(node map[string]any) string {
	if node == nil {
		return ""
	}
	kind := stringValue(node["type"])
	if node["_gui_kind"] == "endpoint" {
		if kind == "wireguard" {
			if peers, ok := node["peers"].([]any); ok {
				keys := []string{}
				for _, value := range peers {
					if peer, ok := value.(map[string]any); ok {
						host := stringValue(peer["address"])
						port := stringValue(peer["port"])
						if host != "" && port != "" && port != "0" {
							keys = append(keys, strings.ToLower(host)+":"+port)
						}
					}
				}
				sort.Strings(keys)
				if len(keys) > 0 {
					return "endpoint\x00" + kind + "\x00" + strings.Join(keys, "\x00")
				}
			}
		}
		if kind == "tailscale" {
			if directory := stringValue(node["state_directory"]); directory != "" {
				return "endpoint\x00" + kind + "\x00" + directory
			}
		}
	}
	host := stringValue(node["server"])
	port := stringValue(node["server_port"])
	if port == "" {
		port = stringValue(node["port"])
	}
	if kind != "" && host != "" && port != "" {
		return kind + "\x00" + strings.ToLower(host) + "\x00" + port
	}
	return ""
}
func reconcileSubscriptionIDs(previous []subscriptionProxyConfig, oldNodes, nextNodes []map[string]any) []subscriptionProxyConfig {
	type candidate struct {
		meta subscriptionProxyConfig
		node map[string]any
		used bool
	}
	candidates := []candidate{}
	queues := map[string][]subscriptionProxyConfig{}
	for _, meta := range previous {
		queues[meta.Tag] = append(queues[meta.Tag], meta)
	}
	for _, node := range oldNodes {
		tag := stringValue(node["tag"])
		queue := queues[tag]
		if len(queue) > 0 {
			candidates = append(candidates, candidate{meta: queue[0], node: node})
			queues[tag] = queue[1:]
		}
	}
	for _, queue := range queues {
		for _, meta := range queue {
			candidates = append(candidates, candidate{meta: meta})
		}
	}
	// Reserve stronger identities across the whole update before falling back to names.
	matches := map[int]int{}
	matchBy := func(oldKey func(candidate) string, newKey func(map[string]any) string) {
		oldIndices, newIndices := map[string]int{}, map[string]int{}
		collect := func(indices map[string]int, key string, index int) {
			if key == "" {
				return
			}
			if _, exists := indices[key]; exists {
				indices[key] = -1
			} else {
				indices[key] = index
			}
		}
		for i, c := range candidates {
			if !c.used {
				collect(oldIndices, oldKey(c), i)
			}
		}
		for i, node := range nextNodes {
			if _, matched := matches[i]; !matched {
				collect(newIndices, newKey(node), i)
			}
		}
		for key, i := range newIndices {
			if old, ok := oldIndices[key]; ok && old >= 0 && i >= 0 {
				matches[i] = old
				candidates[old].used = true
			}
		}
	}
	matchBy(func(c candidate) string { return c.meta.ID }, func(n map[string]any) string { return stringValue(n["__id_in_gui"]) })
	matchBy(func(c candidate) string { return subscriptionFingerprint(c.node) }, subscriptionFingerprint)
	matchBy(func(c candidate) string { return subscriptionEndpointKey(c.node) }, subscriptionEndpointKey)
	matchBy(func(c candidate) string { return c.meta.Tag }, func(n map[string]any) string { return stringValue(n["tag"]) })

	output := make([]subscriptionProxyConfig, 0, len(nextNodes))
	for index, node := range nextNodes {
		meta := subscriptionProxyConfig{}
		if match, ok := matches[index]; ok {
			meta = candidates[match].meta
		} else {
			meta.ID = fmt.Sprintf("proxy-%d-%d", time.Now().UnixNano(), index)
		}
		meta.Tag = stringValue(node["tag"])
		meta.Type = stringValue(node["type"])
		meta.Kind = ""
		if node["_gui_kind"] == "endpoint" {
			meta.Kind = "endpoint"
		}
		output = append(output, meta)
	}
	return output
}

func cachedSubscriptionNodes(path string) []map[string]any {
	content, err := os.ReadFile(resolvePath(path))
	if err != nil {
		return nil
	}
	extracted, err := extractSubscription(string(content))
	if err != nil {
		return nil
	}
	return extracted.Proxies
}
