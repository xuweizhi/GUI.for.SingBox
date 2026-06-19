# 更新所有订阅并同步出站引用 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在计划任务中新增一种预制任务类型，执行“更新所有订阅”后同步订阅出站引用，并支持后台 worker 在前端未运行时执行。

**架构：** 新增一个组合型 `ScheduledTasksType`，前端本地执行时复用 `updateSubscribes()` 和 `syncSubscribeOutboundRefs()`。Go worker 新增同名任务类型，复用现有 `runAllSubscriptionsTask()`，再读写 `data/profiles.yaml` 实现与前端 `syncSubscribeOutboundRefs()` 等价的同步逻辑。

**技术栈：** Vue 3、Pinia、Vitest、Go、YAML、现有 scheduled task worker。

---

## 文件结构

- 修改：`frontend/src/enums/app.ts`，增加任务枚举值。
- 修改：`frontend/src/constant/app.ts`，把新任务加入预制任务选项。
- 修改：`frontend/src/lang/locale/zh.ts` 和 `frontend/src/lang/locale/en.ts`，增加任务文案。
- 修改：`frontend/src/stores/scheduledtasks.ts`，前端本地执行组合任务，并允许 worker 接管同类型任务。
- 测试：`frontend/src/stores/__tests__/scheduledtasks.spec.ts`，覆盖本地组合任务执行顺序和输出。
- 修改：`bridge/taskworker.go`，增加 Go worker 任务类型、profiles 读写结构和出站引用同步逻辑。
- 测试：`bridge/taskworker_test.go`，覆盖 worker 组合任务会更新订阅并同步当前 profile 默认出站引用，同时清理所有 profile 的失效订阅引用。

### 任务 1：前端组合任务测试

**文件：**
- 创建：`frontend/src/stores/__tests__/scheduledtasks.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ScheduledTasksType } from '@/enums/app'
import { useScheduledTasksStore, useSubscribesStore } from '@/stores'

describe('scheduledtasks store', () => {
  it('updates all subscriptions before syncing outbound refs', async () => {
    setActivePinia(createPinia())
    const calls: string[] = []
    const scheduledTasksStore = useScheduledTasksStore()
    const subscribesStore = useSubscribesStore()

    vi.spyOn(subscribesStore, 'updateSubscribes').mockImplementation(async () => {
      calls.push('update')
      return [{ ok: true, id: 'sub-1', name: 'Sub 1', result: 'updated' }]
    })
    vi.spyOn(subscribesStore, 'syncSubscribeOutboundRefs').mockImplementation(async () => {
      calls.push('sync')
      return { added: 2, removed: 1 }
    })

    const run = scheduledTasksStore.getTaskFn({
      id: 'task-1',
      name: 'Update and sync',
      type: ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs,
      subscriptions: [],
      rulesets: [],
      plugins: [],
      script: '',
      cron: '* * * * * *',
      notification: false,
      disabled: false,
      lastTime: 0,
    })

    const result = await run()

    expect(calls).toEqual(['update', 'sync'])
    expect(result).toEqual([
      { ok: true, result: 'updated' },
      { ok: true, result: 'Subscription outbound refs synced. Added: 2; Removed: 1.' },
    ])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- src/stores/__tests__/scheduledtasks.spec.ts`，工作目录 `frontend`。
预期：FAIL，TypeScript 或运行时报错指出 `UpdateAllSubscriptionAndSyncOutboundRefs` 不存在。

### 任务 2：前端最小实现

**文件：**
- 修改：`frontend/src/enums/app.ts:59`
- 修改：`frontend/src/constant/app.ts:177`
- 修改：`frontend/src/lang/locale/zh.ts:610`
- 修改：`frontend/src/lang/locale/en.ts:612`
- 修改：`frontend/src/stores/scheduledtasks.ts:61`

- [ ] **步骤 1：增加任务枚举**

在 `ScheduledTasksType` 中追加：

```ts
UpdateAllSubscriptionAndSyncOutboundRefs = 'update::all::subscription::sync-outbound-refs',
```

- [ ] **步骤 2：增加任务选项**

在 `ScheduledTaskOptions` 的所有订阅任务附近追加：

```ts
{
  label: 'scheduledtask.update::all::subscription::sync-outbound-refs',
  value: ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs,
},
```

- [ ] **步骤 3：增加中英文文案**

在 `scheduledtask` 文案中追加：

```ts
'update::all::subscription::sync-outbound-refs': '更新所有订阅并同步出站引用',
```

英文文件中追加：

```ts
'update::all::subscription::sync-outbound-refs': 'update::all::subscription::sync-outbound-refs',
```

- [ ] **步骤 4：实现本地任务函数**

在 `canTaskRunInBackend` 中让新类型复用 `UpdateAllSubscription` 的校验。在 `getTaskFn` 中追加分支：

```ts
case ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs: {
  const subscribesStore = useSubscribesStore()
  return async () => {
    const output = await subscribesStore.updateSubscribes()
    const syncResult = await subscribesStore.syncSubscribeOutboundRefs()
    return [
      ...output.map((item) => ({ ok: item.ok, result: item.result })),
      {
        ok: true,
        result: `Subscription outbound refs synced. Added: ${syncResult.added}; Removed: ${syncResult.removed}.`,
      },
    ]
  }
}
```

- [ ] **步骤 5：运行前端测试验证通过**

运行：`npm test -- src/stores/__tests__/scheduledtasks.spec.ts`，工作目录 `frontend`。
预期：PASS。

### 任务 3：Go worker 失败测试

**文件：**
- 修改：`bridge/taskworker_test.go`

- [ ] **步骤 1：编写失败的测试**

在 `taskworker_test.go` 添加测试。测试数据使用一个当前 profile 和一个非当前 profile，验证：更新所有订阅后，当前 profile 的 `outbound-select` 与 `outbound-urltest` 添加所有订阅引用；所有 profile 清理不存在的订阅引用。

```go
func TestRunAllSubscriptionsAndSyncOutboundRefsTask(t *testing.T) {
    previousBasePath := Env.BasePath
    Env.BasePath = t.TempDir()
    t.Cleanup(func() {
        Env.BasePath = previousBasePath
    })

    if err := os.MkdirAll(resolvePath("data/subscribes"), 0755); err != nil {
        t.Fatalf("mkdir subscribes: %v", err)
    }
    if err := os.WriteFile(resolvePath("data/user.yaml"), []byte("kernel:\n  profile: profile-1\nrequestProxyMode: none\n"), 0644); err != nil {
        t.Fatalf("write user settings: %v", err)
    }
    if err := os.WriteFile(resolvePath("data/subscribes/sub-1.json"), []byte(`[{"tag":"node-a","type":"vmess"}]`), 0644); err != nil {
        t.Fatalf("write subscription file: %v", err)
    }
    if err := saveSubscriptions([]subscriptionConfig{{
        ID: "sub-1", Name: "Sub 1", Type: "Manual", Path: "data/subscribes/sub-1.json", Script: defaultSubscribeScript,
    }}); err != nil {
        t.Fatalf("saveSubscriptions: %v", err)
    }
    profilesYAML := `- id: profile-1
  outbounds:
    - id: outbound-select
      tag: Select
      type: selector
      outbounds:
        - id: stale-sub
          tag: stale-sub
          type: Subscription
    - id: outbound-urltest
      tag: Auto
      type: urltest
      outbounds: []
- id: profile-2
  outbounds:
    - id: outbound-select
      tag: Other Select
      type: selector
      outbounds:
        - id: stale-sub
          tag: stale-sub
          type: Subscription
`
    if err := os.WriteFile(resolvePath("data/profiles.yaml"), []byte(profilesYAML), 0644); err != nil {
        t.Fatalf("write profiles yaml: %v", err)
    }

    worker := (&App{}).taskWorker()
    result, err := worker.runGoTask(scheduledTaskConfig{Type: "update::all::subscription::sync-outbound-refs"})
    if err != nil {
        t.Fatalf("runGoTask: %v", err)
    }
    if len(result) != 2 {
        t.Fatalf("expected update and sync results, got %d", len(result))
    }

    profiles, err := loadProfiles()
    if err != nil {
        t.Fatalf("loadProfiles: %v", err)
    }
    firstSelect := profiles[0].Outbounds[0].Outbounds
    firstAuto := profiles[0].Outbounds[1].Outbounds
    secondSelect := profiles[1].Outbounds[0].Outbounds
    if len(firstSelect) != 1 || firstSelect[0].ID != "sub-1" || firstSelect[0].Type != "Subscription" {
        t.Fatalf("unexpected current profile select refs: %+v", firstSelect)
    }
    if len(firstAuto) != 1 || firstAuto[0].ID != "sub-1" || firstAuto[0].Type != "Subscription" {
        t.Fatalf("unexpected current profile auto refs: %+v", firstAuto)
    }
    if len(secondSelect) != 0 {
        t.Fatalf("expected stale refs removed from second profile, got %+v", secondSelect)
    }
}
```

- [ ] **步骤 2：运行 Go 测试验证失败**

运行：`go test ./bridge -run TestRunAllSubscriptionsAndSyncOutboundRefsTask -count=1`。
预期：FAIL，报错指出任务类型 unsupported 或 `loadProfiles` 未定义。

### 任务 4：Go worker 最小实现

**文件：**
- 修改：`bridge/taskworker.go:25`
- 修改：`bridge/taskworker.go:39`
- 修改：`bridge/taskworker.go:51`
- 修改：`bridge/taskworker.go:990`
- 修改：`bridge/taskworker.go:1202`
- 修改：`bridge/taskworker.go:1332`

- [ ] **步骤 1：增加常量与任务类型支持**

新增常量：

```go
profilesFilePath = "data/profiles.yaml"
```

在 `goScheduledTaskTypes` 中追加：

```go
"update::all::subscription::sync-outbound-refs": {},
```

- [ ] **步骤 2：增加 profiles YAML 结构**

在 `subscriptionConfig` 附近新增：

```go
type profileOutboundRefConfig struct {
    ID   string `json:"id" yaml:"id"`
    Tag  string `json:"tag" yaml:"tag"`
    Type string `json:"type" yaml:"type"`
}

type profileOutboundConfig struct {
    ID        string                     `json:"id" yaml:"id"`
    Tag       string                     `json:"tag" yaml:"tag"`
    Type      string                     `json:"type" yaml:"type"`
    Outbounds []profileOutboundRefConfig `json:"outbounds" yaml:"outbounds"`
}

type profileConfig struct {
    ID        string                  `json:"id" yaml:"id"`
    Outbounds []profileOutboundConfig `json:"outbounds" yaml:"outbounds"`
}
```

- [ ] **步骤 3：增加 profiles 读写函数**

按 `loadSubscriptions` / `saveSubscriptions` 模式添加：

```go
func loadProfiles() ([]profileConfig, error) {
    content, err := os.ReadFile(resolvePath(profilesFilePath))
    if err != nil {
        if os.IsNotExist(err) {
            return []profileConfig{}, nil
        }
        return nil, err
    }
    if len(strings.TrimSpace(string(content))) == 0 {
        return []profileConfig{}, nil
    }
    var profiles []profileConfig
    if err := yaml.Unmarshal(content, &profiles); err != nil {
        return nil, err
    }
    return profiles, nil
}

func saveProfiles(profiles []profileConfig) error {
    content, err := yaml.Marshal(profiles)
    if err != nil {
        return err
    }
    if err := os.MkdirAll(resolvePath("data"), os.ModePerm); err != nil {
        return err
    }
    return os.WriteFile(resolvePath(profilesFilePath), content, 0644)
}
```

- [ ] **步骤 4：读取当前 profile ID**

扩展 `backendNetworkSettings`，增加嵌套 kernel profile 字段：

```go
Kernel struct {
    Profile string `json:"profile" yaml:"profile"`
} `json:"kernel" yaml:"kernel"`
```

- [ ] **步骤 5：实现同步出站引用函数**

新增函数，行为匹配前端 `syncSubscribeOutboundRefs()`：

```go
func syncSubscriptionOutboundRefs() (int, int, error) {
    subscribes, err := loadSubscriptions()
    if err != nil {
        return 0, 0, err
    }
    profiles, err := loadProfiles()
    if err != nil {
        return 0, 0, err
    }
    settings, err := loadBackendNetworkSettings()
    if err != nil {
        return 0, 0, err
    }

    subscriptionIDs := map[string]struct{}{}
    for _, subscribe := range subscribes {
        subscriptionIDs[subscribe.ID] = struct{}{}
    }

    added := 0
    removed := 0
    changed := false
    for profileIdx := range profiles {
        for outboundIdx := range profiles[profileIdx].Outbounds {
            outbound := &profiles[profileIdx].Outbounds[outboundIdx]
            next := outbound.Outbounds[:0]
            for _, ref := range outbound.Outbounds {
                if ref.Type == "Subscription" {
                    if _, ok := subscriptionIDs[ref.ID]; !ok {
                        removed++
                        changed = true
                        continue
                    }
                }
                next = append(next, ref)
            }
            outbound.Outbounds = next
        }
    }

    for profileIdx := range profiles {
        if profiles[profileIdx].ID != settings.Kernel.Profile {
            continue
        }
        for outboundIdx := range profiles[profileIdx].Outbounds {
            outbound := &profiles[profileIdx].Outbounds[outboundIdx]
            if outbound.ID != "outbound-select" && outbound.ID != "outbound-urltest" {
                continue
            }
            if outbound.Type != "selector" && outbound.Type != "urltest" {
                continue
            }
            for _, subscribe := range subscribes {
                exists := false
                for _, ref := range outbound.Outbounds {
                    if ref.Type == "Subscription" && ref.ID == subscribe.ID {
                        exists = true
                        break
                    }
                }
                if exists {
                    continue
                }
                outbound.Outbounds = append(outbound.Outbounds, profileOutboundRefConfig{ID: subscribe.ID, Tag: subscribe.ID, Type: "Subscription"})
                added++
                changed = true
            }
        }
    }

    if changed {
        if err := saveProfiles(profiles); err != nil {
            return 0, 0, err
        }
    }
    return added, removed, nil
}
```

- [ ] **步骤 6：接入组合任务执行**

在 `validateBackendTaskSupport` 中让新类型复用订阅校验。在 `runGoTask` 追加：

```go
case "update::all::subscription::sync-outbound-refs":
    return w.runAllSubscriptionsAndSyncOutboundRefsTask()
```

新增：

```go
func (w *scheduledTaskWorkerSupervisor) runAllSubscriptionsAndSyncOutboundRefsTask() ([]scheduledTaskWorkerResultItem, error) {
    output, err := w.runAllSubscriptionsTask()
    if err != nil {
        return output, err
    }
    added, removed, err := syncSubscriptionOutboundRefs()
    if err != nil {
        output = append(output, scheduledTaskWorkerResultItem{Ok: false, Result: err.Error()})
        return output, nil
    }
    output = append(output, scheduledTaskWorkerResultItem{
        Ok: true,
        Result: fmt.Sprintf("Subscription outbound refs synced. Added: %d; Removed: %d.", added, removed),
    })
    return output, nil
}
```

- [ ] **步骤 7：运行 Go 测试验证通过**

运行：`go test ./bridge -run TestRunAllSubscriptionsAndSyncOutboundRefsTask -count=1`。
预期：PASS。

### 任务 5：回归验证

**文件：**
- 不新增文件。

- [ ] **步骤 1：运行相关 Go 测试**

运行：`go test ./bridge -run 'Test.*Subscription|TestRunAllSubscriptionsAndSyncOutboundRefsTask|TestValidateBackendTaskSupport' -count=1`。
预期：PASS。

- [ ] **步骤 2：运行相关前端测试**

运行：`npm test -- src/stores/__tests__/scheduledtasks.spec.ts src/stores/__tests__/subscribes.spec.ts`，工作目录 `frontend`。
预期：PASS。

- [ ] **步骤 3：运行类型检查**

运行：`npm run type-check`，工作目录 `frontend`。
预期：PASS。

- [ ] **步骤 4：检查工作区差异**

运行：`git diff -- frontend/src/enums/app.ts frontend/src/constant/app.ts frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts frontend/src/stores/scheduledtasks.ts frontend/src/stores/__tests__/scheduledtasks.spec.ts bridge/taskworker.go bridge/taskworker_test.go docs/superpowers/plans/2026-06-20-update-all-subscriptions-sync-outbounds.md`。
预期：只包含本计划描述的新增组合任务、测试和计划文档。
