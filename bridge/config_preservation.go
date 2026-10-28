package bridge

import (
	"encoding/json"
	"reflect"
	"strings"
)

type subscriptionHeaderConfig struct {
	Extra    map[string]any    `json:"-" yaml:",inline"`
	Request  map[string]string `json:"request" yaml:"request"`
	Response map[string]string `json:"response" yaml:"response"`
}

type subscriptionDNSConfig struct {
	Extra    map[string]any   `json:"-" yaml:",inline"`
	Servers  []map[string]any `json:"servers" yaml:"servers"`
	Resolver string           `json:"resolver,omitempty" yaml:"resolver,omitempty"`
}

// YAML inline maps preserve fields the backend does not need to interpret. JSON
// needs an explicit merge because encoding/json does not implement inline maps.
// Keep the same preservation when subscriptions pass through the Node worker.
func marshalConfigJSON(value any, extra map[string]any) ([]byte, error) {
	known, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	fields := make(map[string]json.RawMessage, len(extra))
	for key, value := range extra {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		fields[key] = raw
	}
	// Known fields win, including omitted known fields that must stay deleted.
	typ := reflect.TypeOf(value)
	for i := 0; i < typ.NumField(); i++ {
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if name != "-" {
			delete(fields, name)
		}
	}
	if err := json.Unmarshal(known, &fields); err != nil {
		return nil, err
	}
	return json.Marshal(fields)
}

func unmarshalConfigJSON(data []byte, value any, extra *map[string]any) error {
	if err := json.Unmarshal(data, value); err != nil {
		return err
	}
	fields := map[string]any{}
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	typ := reflect.TypeOf(value).Elem()
	for i := 0; i < typ.NumField(); i++ {
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if name != "-" {
			delete(fields, name)
		}
	}
	*extra = fields
	return nil
}

func (v scheduledTaskConfig) MarshalJSON() ([]byte, error) {
	type plain scheduledTaskConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *scheduledTaskConfig) UnmarshalJSON(data []byte) error {
	type plain scheduledTaskConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v rulesetConfig) MarshalJSON() ([]byte, error) {
	type plain rulesetConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *rulesetConfig) UnmarshalJSON(data []byte) error {
	type plain rulesetConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v subscriptionProxyConfig) MarshalJSON() ([]byte, error) {
	type plain subscriptionProxyConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *subscriptionProxyConfig) UnmarshalJSON(data []byte) error {
	type plain subscriptionProxyConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v subscriptionConfig) MarshalJSON() ([]byte, error) {
	type plain subscriptionConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *subscriptionConfig) UnmarshalJSON(data []byte) error {
	type plain subscriptionConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v subscriptionHeaderConfig) MarshalJSON() ([]byte, error) {
	type plain subscriptionHeaderConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *subscriptionHeaderConfig) UnmarshalJSON(data []byte) error {
	type plain subscriptionHeaderConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v subscriptionDNSConfig) MarshalJSON() ([]byte, error) {
	type plain subscriptionDNSConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *subscriptionDNSConfig) UnmarshalJSON(data []byte) error {
	type plain subscriptionDNSConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v profileOutboundRefConfig) MarshalJSON() ([]byte, error) {
	type plain profileOutboundRefConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *profileOutboundRefConfig) UnmarshalJSON(data []byte) error {
	type plain profileOutboundRefConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v profileOutboundConfig) MarshalJSON() ([]byte, error) {
	type plain profileOutboundConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *profileOutboundConfig) UnmarshalJSON(data []byte) error {
	type plain profileOutboundConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v profileConfig) MarshalJSON() ([]byte, error) {
	type plain profileConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *profileConfig) UnmarshalJSON(data []byte) error {
	type plain profileConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v pluginConfigurationConfig) MarshalJSON() ([]byte, error) {
	type plain pluginConfigurationConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *pluginConfigurationConfig) UnmarshalJSON(data []byte) error {
	type plain pluginConfigurationConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}

func (v pluginConfig) MarshalJSON() ([]byte, error) {
	type plain pluginConfig
	return marshalConfigJSON(plain(v), v.Extra)
}
func (v *pluginConfig) UnmarshalJSON(data []byte) error {
	type plain pluginConfig
	return unmarshalConfigJSON(data, (*plain)(v), &v.Extra)
}
