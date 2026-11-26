package bridge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type subscriptionSettingChange struct {
	Before any `json:"before"`
	After  any `json:"after"`
}

func subscriptionSettingMissingDefault(field string) (any, bool) {
	switch field {
	case "preferOutboundDns":
		return false, true
	case "outboundDns":
		return []string{}, true
	default:
		return nil, false
	}
}

// Apply only fields edited in the form, keeping node caches, usage and other sessions' edits.
func updateSubscriptionSettings(id string, changes map[string]subscriptionSettingChange) error {
	values := make(map[string]any, len(changes))
	for field, change := range changes {
		switch field {
		case "type", "name", "url", "path", "decryptPassword", "preferOutboundDns", "outboundDns",
			"include", "exclude", "includeProtocol", "excludeProtocol", "proxyPrefix", "website",
			"inSecure", "requestTimeout", "requestMethod", "requestProxyMode", "customProxy", "header":
		default:
			return fmt.Errorf("unknown subscription setting: %s", field)
		}
		if change.After == nil {
			return fmt.Errorf("missing value for subscription setting: %s", field)
		}
		values[field] = change.After
	}
	// The JSON RPC decoder supplies JSON values. Validate their types against the worker schema.
	payload, err := json.Marshal(values)
	if err != nil {
		return err
	}
	var settings subscriptionConfig
	if err := json.Unmarshal(payload, &settings); err != nil {
		return fmt.Errorf("invalid subscription settings: %w", err)
	}

	dataMutationMu.Lock()
	defer dataMutationMu.Unlock()
	path := resolvePath(subscribesFilePath)
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var subscriptions []map[string]any
	if err := yaml.Unmarshal(content, &subscriptions); err != nil {
		return err
	}
	for _, sub := range subscriptions {
		if sub["id"] != id {
			continue
		}
		changed := false
		for field, change := range changes {
			currentVal := sub[field]
			current, err := json.Marshal(currentVal)
			if err != nil {
				return err
			}
			after, _ := json.Marshal(change.After)
			if bytes.Equal(current, after) {
				continue
			}
			before, _ := json.Marshal(change.Before)
			if !bytes.Equal(current, before) {
				defaultVal, hasDefault := subscriptionSettingMissingDefault(field)
				if currentVal != nil || !hasDefault {
					return fmt.Errorf("subscription setting %s changed since the editor opened. Reload the page and retry", field)
				}
				defaultJSON, _ := json.Marshal(defaultVal)
				if bytes.Equal(defaultJSON, after) {
					sub[field] = change.After
					changed = true
					continue
				}
				if !bytes.Equal(defaultJSON, before) {
					return fmt.Errorf("subscription setting %s changed since the editor opened. Reload the page and retry", field)
				}
			}
			sub[field] = change.After
			changed = true
		}
		if !changed {
			return nil
		}
		content, err = yaml.Marshal(subscriptions)
		if err != nil {
			return err
		}
		return atomicWriteFile(path, content, 0o600)
	}
	return fmt.Errorf("subscription %q not found", id)
}
