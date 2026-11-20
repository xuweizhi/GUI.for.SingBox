package bridge

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"
)

type usageReport struct {
	Reported       bool     `json:"reported"`
	Upload         int64    `json:"upload"`
	Download       int64    `json:"download"`
	Total          int64    `json:"total"`
	Expire         int64    `json:"expire"`
	UsageUpdatedAt int64    `json:"usageUpdatedAt"`
	UsageFields    []string `json:"usageFields,omitempty"`
}

func parseSubscriptionUserInfo(target map[string]int64, header string) {
	for _, part := range strings.Split(header, ";") {
		key, rawValue, ok := strings.Cut(part, "=")
		key = strings.ToLower(strings.TrimSpace(key))
		switch key {
		case "upload", "download", "total", "expire":
		default:
			continue
		}
		value, err := strconv.ParseUint(strings.TrimSpace(rawValue), 10, 53)
		if !ok || err != nil || (key == "expire" && value > (1<<53-1)/1000) {
			continue
		}
		target[key] = int64(value)
	}
}

func (s *subscriptionConfig) applyUsage(values map[string]int64, timestamp int64) usageReport {
	if v, ok := values["upload"]; ok {
		s.Upload = v
	}
	if v, ok := values["download"]; ok {
		s.Download = v
	}
	if v, ok := values["total"]; ok {
		s.Total = v
	}
	if v, ok := values["expire"]; ok {
		s.Expire = v * 1000
	}
	if len(values) > 0 {
		s.UsageUpdatedAt = timestamp
		for _, key := range []string{"upload", "download", "total", "expire"} {
			if _, ok := values[key]; ok && !slices.Contains(s.UsageFields, key) {
				s.UsageFields = append(s.UsageFields, key)
			}
		}
	}
	return usageReport{Reported: len(values) > 0, Upload: s.Upload, Download: s.Download, Total: s.Total,
		Expire: s.Expire, UsageUpdatedAt: s.UsageUpdatedAt, UsageFields: s.UsageFields}
}

func usageSubscription(id string) ([]subscriptionConfig, *subscriptionConfig, error) {
	subscriptions, err := loadSubscriptions()
	if err != nil {
		return nil, nil, err
	}
	for i := range subscriptions {
		s := &subscriptions[i]
		if s.ID == id && s.Type == "Http" && !s.Disabled {
			return subscriptions, s, nil
		}
	}
	return nil, nil, fmt.Errorf("active HTTP subscription %q not found", id)
}

func fetchUsageHeaders(s *subscriptionConfig, proxy, userAgent string) (http.Header, error) {
	client, ctx, cancel := withRequestOptionsClient(RequestOptions{
		Redirect: true, Proxy: proxy, Insecure: s.InSecure, Timeout: s.RequestTimeout,
	})
	defer cancel()
	for _, method := range []string{http.MethodHead, http.MethodGet} {
		req, err := http.NewRequestWithContext(ctx, method, s.URL, nil)
		if err != nil {
			return nil, err
		}
		req.Header = requestHeaders(s.Header.Request)
		if req.Header.Get("User-Agent") == "" {
			req.Header.Set("User-Agent", userAgent)
		}
		resp, err := client.Do(req)
		if err != nil {
			var transportError *url.Error
			if errors.As(err, &transportError) {
				return nil, transportError.Err
			}
			return nil, err
		}
		resp.Body.Close()
		if method == http.MethodHead && (resp.StatusCode == 405 || resp.StatusCode == 501) {
			continue
		}
		if !isSuccessfulHTTPStatus(resp.StatusCode) {
			return nil, fmt.Errorf("HTTP %s", resp.Status)
		}
		for k, v := range s.Header.Response {
			resp.Header.Set(k, v)
		}
		return resp.Header, nil
	}
	return nil, fmt.Errorf("subscription headers unavailable")
}

func refreshSubscriptionUsage(id, proxy, userAgent string) (usageReport, error) {
	dataMutationMu.Lock()
	_, original, err := usageSubscription(id)
	dataMutationMu.Unlock()
	if err != nil {
		return usageReport{}, err
	}
	headers, err := fetchUsageHeaders(original, proxy, userAgent)
	if err != nil {
		return usageReport{}, err
	}
	values := map[string]int64{}
	for _, h := range headers.Values("Subscription-Userinfo") {
		parseSubscriptionUserInfo(values, h)
	}

	dataMutationMu.Lock()
	defer dataMutationMu.Unlock()
	subscriptions, current, err := usageSubscription(id)
	if err != nil {
		return usageReport{}, err
	}
	if !reflect.DeepEqual(current, original) {
		return usageReport{}, fmt.Errorf("subscription changed during usage refresh, retry")
	}
	report := current.applyUsage(values, time.Now().UnixMilli())
	if report.Reported {
		err = saveSubscriptions(subscriptions)
	}
	return report, err
}
