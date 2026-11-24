package bridge

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"time"
)

type preparedSubscriptionUpdate struct {
	Subscription subscriptionConfig
	CachePath    string
	Cache        []byte
	WriteCache   bool
}

func processedSubscriptionPath(id, source string) string {
	path := fmt.Sprintf("data/subscribes/.processed/%x.json", sha256.Sum256([]byte(id)))
	if path == source {
		return path + ".nodes.json"
	}
	return path
}

func (w *scheduledTaskWorkerSupervisor) prepareSubscriptionUpdate(current subscriptionConfig, settings backendNetworkSettings) (preparedSubscriptionUpdate, error) {
	var update preparedSubscriptionUpdate
	// Plugins and scripts may mutate nested fields; never leak a failed update into
	// the caller's object or a later successful whole-file save.
	snapshot, err := json.Marshal(current)
	if err != nil {
		return update, err
	}
	if err = json.Unmarshal(snapshot, &update.Subscription); err != nil {
		return update, err
	}
	subscribe := &update.Subscription
	previousMetadata := subscribe.Proxies
	previousNodes := cachedSubscriptionNodes(subscribe.Path)
	body, userInfo, err := w.loadSubscriptionBody(subscribe, settings)
	if err != nil {
		return update, err
	}
	extracted, err := extractSubscription(body)
	if err != nil {
		if looksLikeBase64(body) || looksLikeSubscriptionShareLinkList(body) {
			extracted = extractedSubscription{Proxies: []map[string]any{{"base64": body}}}
		} else {
			return update, err
		}
	}
	preserveDNS := extracted.FlatCache && (subscribe.Type == "Manual" || (subscribe.Type == "File" && (subscribe.URL == subscribe.Path || subscribe.Path == processedSubscriptionPath(subscribe.ID, subscribe.URL))))
	if !preserveDNS {
		subscribe.ImportedDns = extracted.DNS
	}
	proxies, err := w.applySubscriptionPluginsWithWorker(*subscribe, extracted.Proxies)
	if err != nil {
		return update, err
	}
	if needsNativeSubscriptionConvert(proxies) {
		proxies, err = w.normalizeSubscriptionProxiesWithWorker(proxies, subscribe.ImportedDns)
		if err != nil {
			return update, err
		}
	}
	for index, proxy := range proxies {
		if err = validateSubscriptionEntry(proxy, index); err != nil {
			return update, err
		}
	}
	if subscribe.Type != "Manual" {
		proxies, err = applySubscriptionFilters(proxies, subscribe)
		if err != nil {
			return update, err
		}
		prefixSubscriptionReferences(proxies, subscribe.ImportedDns, subscribe.ProxyPrefix)
	}
	subscribe.UpdateTime = time.Now().UnixMilli()
	subscribe.applyUsage(userInfo, subscribe.UpdateTime)
	subscribe.Proxies = reconcileSubscriptionIDs(previousMetadata, previousNodes, proxies)
	if !isDefaultSubscribeScript(subscribe.Script) {
		// Keep a pre-script identity snapshot: scripts are allowed to rename nodes.
		before := cachedNodeClone(proxies)
		nextProxies, nextSubscription, err := w.runSubscriptionScriptWithWorker(*subscribe, proxies)
		if err != nil {
			return update, err
		}
		for index, proxy := range nextProxies {
			if err = validateSubscriptionEntry(proxy, index); err != nil {
				return update, err
			}
		}
		nextSubscription.Proxies = reconcileSubscriptionIDs(subscribe.Proxies, before, nextProxies)
		*subscribe = nextSubscription
		proxies = nextProxies
	}
	for _, proxy := range proxies {
		delete(proxy, "__id__")
		delete(proxy, "__tmp__id__")
	}
	if subscribe.Type == "File" && subscribe.URL == subscribe.Path {
		var original []map[string]any
		if json.Unmarshal([]byte(body), &original) != nil || !reflect.DeepEqual(original, proxies) {
			subscribe.Path = processedSubscriptionPath(subscribe.ID, subscribe.URL)
		}
	}
	update.CachePath = resolvePath(subscribe.Path)
	update.WriteCache = subscribe.Type != "File" || subscribe.URL != subscribe.Path
	if update.WriteCache {
		update.Cache, err = json.MarshalIndent(proxies, "", "  ")
		if err != nil {
			return update, err
		}
	}
	return update, nil
}

func cachedNodeClone(nodes []map[string]any) []map[string]any {
	data, _ := json.Marshal(nodes)
	var copy []map[string]any
	_ = json.Unmarshal(data, &copy)
	return copy
}

// Cache files and their metadata form one logical update. Atomic file writes
// protect readers; rollback restores all previous caches if any write/save fails.
func commitSubscriptionUpdates(updates []preparedSubscriptionUpdate, saveMetadata func() error) error {
	files := make([]fileUpdate, 0, len(updates))
	for _, update := range updates {
		if update.WriteCache {
			files = append(files, fileUpdate{update.CachePath, update.Cache})
		}
	}
	return commitFileUpdates(files, saveMetadata)
}

type fileUpdate struct {
	path    string
	content []byte
}

func commitFileUpdates(files []fileUpdate, saveMetadata func() error) error {
	type backup struct {
		path    string
		content []byte
		mode    os.FileMode
		existed bool
	}
	backups := []backup{}
	seen := map[string]bool{}
	rollback := func(cause error) error {
		failures := []error{cause}
		for i := len(backups) - 1; i >= 0; i-- {
			old := backups[i]
			var err error
			if old.existed {
				err = atomicWriteFile(old.path, old.content, old.mode)
			} else {
				err = os.Remove(old.path)
				if os.IsNotExist(err) {
					err = nil
				}
			}
			if err != nil {
				failures = append(failures, fmt.Errorf("restore file %s: %w", old.path, err))
			}
		}
		return errors.Join(failures...)
	}
	for _, file := range files {
		if !seen[file.path] {
			old := backup{path: file.path, mode: 0600}
			info, err := os.Stat(old.path)
			if err == nil {
				if !info.Mode().IsRegular() {
					return rollback(fmt.Errorf("not a regular file: %s", old.path))
				}
				old.existed = true
				old.mode = info.Mode().Perm()
				old.content, err = os.ReadFile(old.path)
			}
			if err != nil && !os.IsNotExist(err) {
				return rollback(err)
			}
			backups = append(backups, old)
			seen[old.path] = true
		}
		if err := atomicWriteFile(file.path, file.content, 0600); err != nil {
			return rollback(err)
		}
	}
	if saveMetadata != nil {
		if err := saveMetadata(); err != nil {
			return rollback(err)
		}
	}
	return nil
}

func (w *scheduledTaskWorkerSupervisor) doUpdateSubscription(subscribe *subscriptionConfig, settings backendNetworkSettings) error {
	update, err := w.prepareSubscriptionUpdate(*subscribe, settings)
	if err != nil {
		return err
	}
	if err = commitSubscriptionUpdates([]preparedSubscriptionUpdate{update}, nil); err != nil {
		return err
	}
	*subscribe = update.Subscription
	return nil
}
