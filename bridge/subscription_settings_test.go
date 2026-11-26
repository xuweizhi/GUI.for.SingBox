package bridge

import (
	"testing"

	"gopkg.in/yaml.v3"
)

func TestUpdateSubscriptionSettings(t *testing.T) {
	backendFixtureBase(t)
	const original = "- id: a\n  url: old\n  requestTimeout: 15\n  proxies: [{tag: current}]\n  future: keep\n- id: b\n  url: other\n"
	backendFixtureWrite(t, subscribesFilePath, original)
	changes := map[string]subscriptionSettingChange{
		"url":            {Before: "old", After: "new"},
		"requestTimeout": {Before: float64(15), After: float64(30)},
	}
	if err := updateSubscriptionSettings("a", changes); err != nil {
		t.Fatal(err)
	}
	saved := backendFixtureRead(t, subscribesFilePath)
	var records []subscriptionConfig
	if err := yaml.Unmarshal([]byte(saved), &records); err != nil {
		t.Fatal(err)
	}
	if records[0].URL != "new" || records[0].RequestTimeout != 30 || records[0].Proxies[0].Tag != "current" || records[0].Extra["future"] != "keep" || records[1].URL != "other" {
		t.Fatal("changed unrelated subscription data or failed to save edited fields")
	}
	if err := updateSubscriptionSettings("a", changes); err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	for _, invalid := range []map[string]subscriptionSettingChange{
		{"name": {After: "partial"}, "url": {Before: "old", After: "stale"}},
		{"proxies": {After: []any{}}},
		{"requestTimeout": {Before: 30, After: "invalid"}},
	} {
		if err := updateSubscriptionSettings("a", invalid); err == nil {
			t.Fatal("invalid edit was accepted")
		}
		if backendFixtureRead(t, subscribesFilePath) != saved {
			t.Fatal("invalid edit changed the file")
		}
	}
}

func TestUpdateSubscriptionSettingsHandlesMissingDefaultFields(t *testing.T) {
	backendFixtureBase(t)
	// Simulate YAML written without preferOutboundDns / outboundDns keys
	const original = "- id: a\n  url: https://example.test/sub\n  requestTimeout: 15\n"
	backendFixtureWrite(t, subscribesFilePath, original)

	changes := map[string]subscriptionSettingChange{
		"preferOutboundDns": {Before: false, After: true},
		"outboundDns":       {Before: []any{}, After: []any{"1.1.1.1"}},
	}
	if err := updateSubscriptionSettings("a", changes); err != nil {
		t.Fatalf("expected missing defaults to match false/[]: %v", err)
	}
	var records []subscriptionConfig
	if err := yaml.Unmarshal([]byte(backendFixtureRead(t, subscribesFilePath)), &records); err != nil {
		t.Fatal(err)
	}
	if !records[0].PreferOutboundDns || len(records[0].OutboundDns) != 1 || records[0].OutboundDns[0] != "1.1.1.1" {
		t.Fatalf("unexpected saved record: %+v", records[0])
	}
}
