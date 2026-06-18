# 首页当前节点控制实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在桌面端和 Headless WebUI 首页展示主选择组的当前节点，并提供精简弹窗完成选择组切换、节点切换、单节点测速和整组测速。

**架构：** 保留现有 `GroupsController` 和 Go Bridge 不变，新增纯函数节点模型、一个管理刷新/切换/测速生命周期的 composable，以及 `CurrentNodeCard`、`NodeSelectorModal` 两个 Vue 组件。运行时状态继续以 `kernelApiStore.proxies` 为唯一事实来源，桌面端直连 Clash API，WebUI 自动复用现有 `/__webui/core` 代理。

**技术栈：** Vue 3.5、Pinia 3、TypeScript 6、Vitest 3、Vue Test Utils 2、Less、Sing-Box Clash API。

---

## 文件结构

### 新建

- `frontend/src/views/HomeView/nodeController.ts`
  - 纯 TypeScript 节点模型。
  - 负责可见组、主选择组、选择链、延迟状态、搜索和稳定排序。
- `frontend/src/views/HomeView/useNodeController.ts`
  - 运行时 composable。
  - 负责刷新去重、5 秒轮询、节点切换、单节点测速、整组测速和取消。
- `frontend/src/views/HomeView/components/NodeSelectorModal.vue`
  - 精简节点选择弹窗。
  - 只负责展示和派发 controller 操作。
- `frontend/src/views/HomeView/components/CurrentNodeCard.vue`
  - 首页当前节点卡片。
  - 创建唯一 controller 实例，并与弹窗共享。
- `frontend/src/views/HomeView/__tests__/nodeController.spec.ts`
  - 纯解析、过滤和排序测试。
- `frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`
  - 刷新、切换、测速、取消和轮询测试。
- `frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`
  - 弹窗交互测试。
- `frontend/src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts`
  - 首页卡片状态和键盘交互测试。

### 修改

- `frontend/package.json`
  - 增加 `@vue/test-utils`。
- `frontend/pnpm-lock.yaml`
  - 锁定组件测试依赖。
- `frontend/src/types/kernel.d.ts`
  - 修正 `CoreApiProxies` 的代理值类型。
- `frontend/src/views/HomeView/components/OverView.vue`
  - 加入当前节点卡片。
  - 把概览卡片区改为响应式网格。
- `frontend/src/lang/locale/zh.ts`
  - 增加当前节点、只读模式、测速状态等中文文案。
- `frontend/src/lang/locale/en.ts`
  - 增加对应英文文案。

## 任务 1：建立 Vue 组件测试基础

**文件：**

- 修改：`frontend/package.json`
- 修改：`frontend/pnpm-lock.yaml`

- [ ] **步骤 1：安装固定版本的 Vue Test Utils**

运行：

```bash
cd frontend
pnpm add -D --save-exact @vue/test-utils@2.4.6
```

预期：

- `package.json` 的 `devDependencies` 出现 `"@vue/test-utils": "2.4.6"`。
- `pnpm-lock.yaml` 出现对应 importer 和 package 记录。
- 命令退出码为 `0`。

- [ ] **步骤 2：验证测试环境可加载依赖**

运行：

```bash
cd frontend
pnpm exec vitest --version
pnpm exec node -e "import('@vue/test-utils').then(() => console.log('vue-test-utils-ok'))"
```

预期：

- Vitest 输出版本号。
- Node 输出 `vue-test-utils-ok`。

- [ ] **步骤 3：提交测试基础**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "test: add Vue component test utilities"
```

## 任务 2：实现主组、选择链和节点排序纯模型

**文件：**

- 创建：`frontend/src/views/HomeView/nodeController.ts`
- 创建：`frontend/src/views/HomeView/__tests__/nodeController.spec.ts`
- 修改：`frontend/src/types/kernel.d.ts`

- [ ] **步骤 1：收紧 Clash API 类型**

保留现有 `CoreApiProxy` 字段定义，只修正 `frontend/src/types/kernel.d.ts` 中 `CoreApiProxies` 错误引用的未定义类型：

```ts
export interface CoreApiProxies {
  proxies: Record<string, CoreApiProxy>
}
```

原因：当前 `CoreApiProxies` 错误引用了未定义的 `Proxy` 类型。不要在本任务中把 `CoreApiProxy` 字段改为可选，因为现有控制器依赖 `all`、`now` 和 `history` 的确定类型。

- [ ] **步骤 2：编写纯模型失败测试**

创建 `frontend/src/views/HomeView/__tests__/nodeController.spec.ts`：

```ts
import { describe, expect, it } from 'vitest'

import {
  filterAndSortNodes,
  getVisibleGroups,
  resolvePrimaryNode,
  resolveProxyChain,
} from '@/views/HomeView/nodeController'

import type { CoreApiProxy } from '@/types/kernel'

const proxy = (
  value: Partial<CoreApiProxy> & Pick<CoreApiProxy, 'name' | 'type'>,
): CoreApiProxy => ({
  alive: true,
  all: [],
  now: '',
  udp: false,
  history: [],
  ...value,
})

const proxies: Record<string, CoreApiProxy> = {
  GLOBAL: proxy({ name: 'GLOBAL', type: 'Selector', all: ['Proxy', 'direct'], now: 'Proxy' }),
  Proxy: proxy({ name: 'Proxy', type: 'Selector', all: ['Auto', 'HK 01'], now: 'Auto' }),
  Auto: proxy({ name: 'Auto', type: 'URLTest', all: ['HK 01', 'JP 01'], now: 'HK 01' }),
  'HK 01': proxy({ name: 'HK 01', type: 'VLESS', udp: true, history: [{ delay: 86 }] }),
  'JP 01': proxy({ name: 'JP 01', type: 'Trojan', history: [] }),
  direct: proxy({ name: 'direct', type: 'Direct' }),
}

const profile = {
  route: { final: 'proxy-id' },
  outbounds: [
    { id: 'proxy-id', tag: 'Proxy', hidden: false },
    { id: 'auto-id', tag: 'Auto', hidden: false },
    { id: 'hidden-id', tag: 'Hidden', hidden: true },
  ],
} as Pick<IProfile, 'route' | 'outbounds'>

describe('resolvePrimaryNode', () => {
  it('uses GLOBAL in global mode', () => {
    const result = resolvePrimaryNode('global', profile, proxies)

    expect(result.kind).toBe('group')
    expect(result.groupName).toBe('GLOBAL')
    expect(result.chain).toEqual(['GLOBAL', 'Proxy', 'Auto', 'HK 01'])
    expect(result.leafName).toBe('HK 01')
    expect(result.delay).toBe(86)
  })

  it('returns a read-only direct state in direct mode', () => {
    expect(resolvePrimaryNode('direct', profile, proxies)).toMatchObject({
      kind: 'direct',
      groupName: 'direct',
      chain: ['direct'],
      leafName: 'direct',
      readonly: true,
    })
  })

  it('maps route.final id to the first Selector in rule mode', () => {
    const result = resolvePrimaryNode('rule', profile, proxies)

    expect(result.groupName).toBe('Proxy')
    expect(result.chain).toEqual(['Proxy', 'Auto', 'HK 01'])
  })

  it('falls back to the first visible non-GLOBAL Selector', () => {
    const missingProfile = {
      ...profile,
      route: { final: 'missing-id' },
    } as Pick<IProfile, 'route' | 'outbounds'>

    expect(resolvePrimaryNode('rule', missingProfile, proxies).groupName).toBe('Proxy')
  })

  it('does not expose a hidden route selector as the primary group', () => {
    const hiddenProfile = {
      ...profile,
      route: { final: 'hidden-id' },
    } as Pick<IProfile, 'route' | 'outbounds'>
    const values = {
      ...proxies,
      Hidden: proxy({ name: 'Hidden', type: 'Selector', all: ['HK 01'], now: 'HK 01' }),
    }

    expect(resolvePrimaryNode('rule', hiddenProfile, values).groupName).toBe('Proxy')
  })
})

describe('resolveProxyChain', () => {
  it('returns a partial result for a missing now target', () => {
    const broken = {
      ...proxies,
      Proxy: proxy({ name: 'Proxy', type: 'Selector', all: ['Missing'], now: 'Missing' }),
    }

    expect(resolveProxyChain('Proxy', broken)).toMatchObject({
      chain: ['Proxy', 'Missing'],
      error: 'missing',
    })
  })

  it('stops circular selector references', () => {
    const circular = {
      A: proxy({ name: 'A', type: 'Selector', all: ['B'], now: 'B' }),
      B: proxy({ name: 'B', type: 'Selector', all: ['A'], now: 'A' }),
    }

    expect(resolveProxyChain('A', circular)).toMatchObject({
      chain: ['A', 'B'],
      error: 'cycle',
    })
  })
})

describe('getVisibleGroups', () => {
  it('keeps GLOBAL as a system group and excludes hidden groups', () => {
    const groups = getVisibleGroups('rule', profile, {
      ...proxies,
      Hidden: proxy({ name: 'Hidden', type: 'Selector', all: [], now: '' }),
    })

    expect(groups.map((group) => group.name)).toEqual(['Proxy', 'Auto', 'GLOBAL'])
  })

  it('moves GLOBAL to the front in global mode', () => {
    expect(getVisibleGroups('global', profile, proxies)[0]?.name).toBe('GLOBAL')
  })
})

describe('filterAndSortNodes', () => {
  it('filters case-insensitively and sorts valid latency before untested nodes', () => {
    const group = proxies.Auto!
    const nodes = filterAndSortNodes(group, proxies, '0', true, new Map())

    expect(nodes.map((node) => node.name)).toEqual(['HK 01', 'JP 01'])
    expect(nodes.map((node) => node.delayStatus)).toEqual(['success', 'untested'])
  })

  it('marks zero-delay history and local errors as unavailable', () => {
    const failed = {
      ...proxies,
      'JP 01': proxy({ name: 'JP 01', type: 'Trojan', history: [{ delay: 0 }] }),
    }

    const nodes = filterAndSortNodes(proxies.Auto!, failed, '', false, new Map())
    expect(nodes[1]).toMatchObject({ name: 'JP 01', delayStatus: 'failed' })
  })
})
```

- [ ] **步骤 3：运行测试验证失败**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/__tests__/nodeController.spec.ts
```

预期：FAIL，错误包含无法解析 `@/views/HomeView/nodeController`。

- [ ] **步骤 4：实现纯节点模型**

创建 `frontend/src/views/HomeView/nodeController.ts`，导出以下完整公共接口：

```ts
import type { CoreApiProxy } from '@/types/kernel'

export type NodeMode = 'rule' | 'global' | 'direct'
export type ChainError = 'missing' | 'cycle'
export type DelayStatus = 'untested' | 'success' | 'failed'

export interface ProxyChain {
  chain: string[]
  leafName: string
  leaf?: CoreApiProxy
  delay: number | null
  error?: ChainError
}

export interface PrimaryNodeState extends ProxyChain {
  kind: 'group' | 'direct' | 'unavailable'
  groupName: string
  group?: CoreApiProxy
  readonly: boolean
}

export interface NodeListItem {
  name: string
  proxy?: CoreApiProxy
  delay: number | null
  delayStatus: DelayStatus
  originalIndex: number
  error?: string
}

type NodeProfile = Pick<IProfile, 'route' | 'outbounds'> | undefined

const latestDelay = (proxy?: CoreApiProxy) => {
  const history = proxy?.history || []
  return history.length ? history[history.length - 1]!.delay : null
}

const profileTagForId = (profile: NodeProfile, id: string) => {
  return profile?.outbounds.find((outbound) => outbound.id === id)?.tag || id
}

const hiddenTags = (profile: NodeProfile) => {
  return new Set(
    (profile?.outbounds || [])
      .filter((outbound) => outbound.hidden)
      .map((outbound) => outbound.tag),
  )
}

export const resolveProxyChain = (
  startName: string,
  proxies: Record<string, CoreApiProxy>,
): ProxyChain => {
  const chain: string[] = []
  const visited = new Set<string>()
  let currentName = startName

  while (currentName && chain.length <= Object.keys(proxies).length) {
    if (visited.has(currentName)) {
      return { chain, leafName: chain.at(-1) || startName, delay: null, error: 'cycle' }
    }

    visited.add(currentName)
    chain.push(currentName)
    const current = proxies[currentName]

    if (!current) {
      return { chain, leafName: currentName, delay: null, error: 'missing' }
    }

    if (!current.now) {
      const delay = latestDelay(current)
      return {
        chain,
        leafName: currentName,
        leaf: current,
        delay: delay && delay > 0 ? delay : null,
      }
    }

    currentName = current.now
  }

  return { chain, leafName: chain.at(-1) || startName, delay: null, error: 'cycle' }
}

const firstSelectorFrom = (
  startName: string,
  proxies: Record<string, CoreApiProxy>,
  excluded: Set<string>,
): CoreApiProxy | undefined => {
  const visited = new Set<string>()
  let currentName = startName

  while (currentName && !visited.has(currentName)) {
    visited.add(currentName)
    const current = proxies[currentName]
    if (!current) return
    if (current.type === 'Selector' && !excluded.has(current.name)) return current
    currentName = current.now || ''
  }
}

export const getVisibleGroups = (
  mode: NodeMode,
  profile: NodeProfile,
  proxies: Record<string, CoreApiProxy>,
) => {
  const hidden = hiddenTags(profile)
  const regular = Object.values(proxies).filter(
    (proxy) =>
      ['Selector', 'URLTest'].includes(proxy.type) &&
      proxy.name !== 'GLOBAL' &&
      !hidden.has(proxy.name),
  )
  const global = proxies.GLOBAL
  if (!global) return regular
  return mode === 'global' ? [global, ...regular] : [...regular, global]
}

export const resolvePrimaryNode = (
  mode: NodeMode,
  profile: NodeProfile,
  proxies: Record<string, CoreApiProxy>,
): PrimaryNodeState => {
  if (mode === 'direct') {
    return {
      kind: 'direct',
      groupName: 'direct',
      chain: ['direct'],
      leafName: 'direct',
      leaf: proxies.direct,
      delay: null,
      readonly: true,
    }
  }

  let group = mode === 'global' ? proxies.GLOBAL : undefined
  if (!group && mode === 'rule') {
    const routeTag = profileTagForId(profile, profile?.route.final || '')
    group = firstSelectorFrom(routeTag, proxies, hiddenTags(profile))
  }
  if (!group) {
    group = getVisibleGroups(mode, profile, proxies).find(
      (proxy) => proxy.type === 'Selector' && proxy.name !== 'GLOBAL',
    )
  }
  if (!group) {
    return {
      kind: 'unavailable',
      groupName: '',
      chain: [],
      leafName: '',
      delay: null,
      readonly: true,
    }
  }

  return {
    kind: 'group',
    groupName: group.name,
    group,
    readonly: false,
    ...resolveProxyChain(group.name, proxies),
  }
}

export const filterAndSortNodes = (
  group: CoreApiProxy,
  proxies: Record<string, CoreApiProxy>,
  query: string,
  sortByDelay: boolean,
  errors: Map<string, string>,
): NodeListItem[] => {
  const keyword = query.trim().toLocaleLowerCase()
  const nodes = (group.all || []).map((name, originalIndex) => {
    const proxy = proxies[name]
    const delay = latestDelay(proxy)
    const failed = errors.has(name) || (delay !== null && delay <= 0)
    return {
      name,
      proxy,
      delay: delay && delay > 0 ? delay : null,
      delayStatus: failed ? 'failed' : delay ? 'success' : 'untested',
      originalIndex,
      error: errors.get(name),
    } satisfies NodeListItem
  })

  const filtered = keyword
    ? nodes.filter((node) => node.name.toLocaleLowerCase().includes(keyword))
    : nodes
  if (!sortByDelay) return filtered

  return filtered.toSorted((a, b) => {
    if (a.delay !== null && b.delay !== null) return a.delay - b.delay || a.originalIndex - b.originalIndex
    if (a.delay !== null) return -1
    if (b.delay !== null) return 1
    return a.originalIndex - b.originalIndex
  })
}
```

- [ ] **步骤 5：运行纯模型测试和类型检查**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/__tests__/nodeController.spec.ts
pnpm type-check
```

预期：

- `nodeController.spec.ts` 全部 PASS。
- `vue-tsc --build` 退出码为 `0`。

- [ ] **步骤 6：提交纯节点模型**

```bash
git add frontend/src/types/kernel.d.ts \
  frontend/src/views/HomeView/nodeController.ts \
  frontend/src/views/HomeView/__tests__/nodeController.spec.ts
git commit -m "feat: add runtime node resolution model"
```

## 任务 3：实现节点控制 composable

**文件：**

- 创建：`frontend/src/views/HomeView/useNodeController.ts`
- 创建：`frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`

- [ ] **步骤 1：编写 composable 失败测试**

创建 `frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`，使用 hoisted mocks 隔离 API 和 store：

```ts
import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProxyDelay: vi.fn(),
  handleUseProxy: vi.fn(),
  refreshProviderProxies: vi.fn(),
  kernelStore: undefined as any,
}))

vi.mock('@/api/kernel', () => ({
  getProxyDelay: mocks.getProxyDelay,
}))

vi.mock('@/utils/helper', () => ({
  handleUseProxy: mocks.handleUseProxy,
}))

vi.mock('@/stores', async () => {
  const { reactive } = await import('vue')
  mocks.kernelStore ||= reactive({
    running: true,
    config: { mode: 'rule' },
    proxies: {
      Proxy: {
        name: 'Proxy',
        type: 'Selector',
        all: ['HK 01', 'JP 01'],
        now: 'HK 01',
        history: [],
      },
      'HK 01': { name: 'HK 01', type: 'VLESS', history: [{ delay: 80 }] },
      'JP 01': { name: 'JP 01', type: 'Trojan', history: [] },
    },
    refreshProviderProxies: mocks.refreshProviderProxies,
  })

  return {
    useKernelApiStore: () => mocks.kernelStore,
    useProfilesStore: () => ({
      currentProfile: {
        route: { final: 'proxy-id' },
        outbounds: [{ id: 'proxy-id', tag: 'Proxy', hidden: false }],
      },
    }),
    useAppSettingsStore: () => ({
      app: {
        kernel: {
          testUrl: 'https://www.gstatic.com/generate_204',
          testTimeout: 5000,
          concurrencyLimit: 1,
        },
      },
    }),
  }
})

import { useNodeController } from '@/views/HomeView/useNodeController'

describe('useNodeController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.refreshProviderProxies.mockResolvedValue(undefined)
    mocks.handleUseProxy.mockResolvedValue(undefined)
    const kernelStore = mocks.kernelStore
    kernelStore.running = true
    kernelStore.config.mode = 'rule'
    kernelStore.proxies.Proxy.now = 'HK 01'
    kernelStore.proxies['HK 01'].history = [{ delay: 80 }]
    kernelStore.proxies['JP 01'].history = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates concurrent refreshes', async () => {
    let resolveRefresh!: () => void
    mocks.refreshProviderProxies.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve
      }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const first = controller.refresh()
    const second = controller.refresh()
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(1)

    resolveRefresh()
    await Promise.all([first, second])
    scope.stop()
  })

  it('keeps the last proxy snapshot and marks it stale after refresh failure', async () => {
    mocks.refreshProviderProxies.mockRejectedValue(new Error('controller offline'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    await expect(controller.refresh()).rejects.toThrow('controller offline')

    expect(mocks.kernelStore.proxies.Proxy.now).toBe('HK 01')
    expect(controller.stale.value).toBe(true)
    expect(controller.refreshError.value).toContain('controller offline')
    scope.stop()
  })

  it('switches only Selector groups and refreshes after success', async () => {
    mocks.refreshProviderProxies.mockResolvedValue(undefined)
    mocks.handleUseProxy.mockResolvedValue(undefined)
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const result = await controller.switchNode('JP 01')

    expect(result.ok).toBe(true)
    expect(mocks.handleUseProxy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Proxy', type: 'Selector' }),
      expect.objectContaining({ name: 'JP 01' }),
    )
    expect(mocks.refreshProviderProxies).toHaveBeenCalled()
    scope.stop()
  })

  it('does not submit the already-selected node again', async () => {
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const result = await controller.switchNode('HK 01')

    expect(result.ok).toBe(true)
    expect(mocks.handleUseProxy).not.toHaveBeenCalled()
    scope.stop()
  })

  it('records a failed delay without exposing 0 ms', async () => {
    mocks.getProxyDelay.mockRejectedValue(new Error('timeout'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const result = await controller.testNode('JP 01')

    expect(result.ok).toBe(false)
    expect(controller.nodeErrors.value.get('JP 01')).toContain('timeout')
    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: null,
      delayStatus: 'failed',
    })
    scope.stop()
  })

  it('cancels queued group tests while allowing the active request to finish', async () => {
    let release!: () => void
    mocks.getProxyDelay.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ delay: 90 })
        }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const testing = controller.testGroup()
    await nextTick()
    controller.cancelGroupTest()
    release()
    await testing

    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(1)
    expect(controller.batch.value.cancelled).toBe(true)
    scope.stop()
  })

  it('refreshes every five seconds only while running', async () => {
    mocks.refreshProviderProxies.mockResolvedValue(undefined)
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    controller.startPolling()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(3)

    mocks.kernelStore.running = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(3)
    scope.stop()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/__tests__/useNodeController.spec.ts
```

预期：FAIL，错误包含无法解析 `@/views/HomeView/useNodeController`。

- [ ] **步骤 3：实现 composable 公共接口**

创建 `frontend/src/views/HomeView/useNodeController.ts`：

```ts
import { computed, onScopeDispose, ref, watch } from 'vue'

import { getProxyDelay } from '@/api/kernel'
import {
  DefaultConcurrencyLimit,
  DefaultTestTimeout,
  DefaultTestURL,
} from '@/constant/app'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore } from '@/stores'
import { handleUseProxy } from '@/utils/helper'
import { createAsyncPool, normalizeErrorMessage } from '@/utils/others'
import {
  filterAndSortNodes,
  getVisibleGroups,
  resolvePrimaryNode,
} from '@/views/HomeView/nodeController'

import type { NodeMode } from '@/views/HomeView/nodeController'

export type NodeOperationResult =
  | { ok: true }
  | { ok: false; error: string }

export interface BatchTestState {
  running: boolean
  cancelled: boolean
  total: number
  completed: number
  success: number
  failure: number
}

const POLL_INTERVAL = 5_000

const emptyBatch = (): BatchTestState => ({
  running: false,
  cancelled: false,
  total: 0,
  completed: 0,
  success: 0,
  failure: 0,
})

export const useNodeController = () => {
  const appSettingsStore = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()
  const profilesStore = useProfilesStore()

  const selectedGroupName = ref('')
  const query = ref('')
  const sortByDelay = ref(false)
  const nodeErrors = ref(new Map<string, string>())
  const testingNodes = ref(new Set<string>())
  const batch = ref<BatchTestState>(emptyBatch())
  const stale = ref(false)
  const refreshError = ref('')

  const mode = computed(() => kernelApiStore.config.mode as NodeMode)
  const groups = computed(() =>
    getVisibleGroups(mode.value, profilesStore.currentProfile, kernelApiStore.proxies),
  )
  const primary = computed(() =>
    resolvePrimaryNode(mode.value, profilesStore.currentProfile, kernelApiStore.proxies),
  )
  const selectedGroup = computed(
    () =>
      kernelApiStore.proxies[selectedGroupName.value] ||
      groups.value.find((group) => group.name === selectedGroupName.value),
  )
  const readonlyMode = computed(
    () => mode.value === 'direct' || selectedGroup.value?.type !== 'Selector',
  )
  const nodes = computed(() => {
    if (!selectedGroup.value) return []
    return filterAndSortNodes(
      selectedGroup.value,
      kernelApiStore.proxies,
      query.value,
      sortByDelay.value,
      nodeErrors.value,
    )
  })

  let disposed = false
  let pollTimer: number | undefined
  let refreshPromise: Promise<void> | undefined
  let poolController: { cancel: () => void } | undefined

  const refresh = () => {
    if (!kernelApiStore.running) return Promise.resolve()
    if (!refreshPromise) {
      refreshPromise = kernelApiStore
        .refreshProviderProxies()
        .then(() => {
          stale.value = false
          refreshError.value = ''
        })
        .catch((error) => {
          stale.value = true
          refreshError.value = normalizeErrorMessage(error)
          throw error
        })
        .finally(() => {
          refreshPromise = undefined
        })
    }
    return refreshPromise
  }

  const prepareModal = async () => {
    await refresh()
    selectedGroupName.value =
      primary.value.kind === 'group'
        ? primary.value.groupName
        : groups.value[0]?.name || ''
  }

  const selectGroup = (name: string) => {
    if (!groups.value.some((group) => group.name === name)) return
    selectedGroupName.value = name
    query.value = ''
  }

  const switchNode = async (name: string): Promise<NodeOperationResult> => {
    if (selectedGroup.value?.now === name) {
      return { ok: true }
    }

    if (
      readonlyMode.value ||
      selectedGroup.value?.type !== 'Selector'
    ) {
      return { ok: false, error: 'home.nodes.readonly' }
    }

    const proxy = kernelApiStore.proxies[name]
    if (!proxy) {
      return { ok: false, error: 'home.nodes.nodeMissing' }
    }

    try {
      await handleUseProxy(selectedGroup.value, proxy)
      await refresh()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: normalizeErrorMessage(error) }
    }
  }

  const testNode = async (name: string): Promise<NodeOperationResult> => {
    if (testingNodes.value.has(name)) {
      return { ok: false, error: 'home.nodes.alreadyTesting' }
    }

    const proxy = kernelApiStore.proxies[name]
    if (!proxy) {
      return { ok: false, error: 'home.nodes.nodeMissing' }
    }

    testingNodes.value.add(name)
    try {
      const { delay = 0 } = await getProxyDelay(
        encodeURIComponent(name),
        appSettingsStore.app.kernel.testUrl || DefaultTestURL,
        appSettingsStore.app.kernel.testTimeout || DefaultTestTimeout,
      )
      if (disposed) return { ok: false, error: 'common.canceled' }
      proxy.history ||= []
      proxy.history.push({ delay })
      nodeErrors.value.delete(name)
      return { ok: true }
    } catch (error) {
      const normalized = normalizeErrorMessage(error)
      if (!disposed) {
        proxy.history ||= []
        proxy.history.push({ delay: 0 })
        nodeErrors.value.set(name, normalized)
      }
      return { ok: false, error: normalized }
    } finally {
      if (!disposed) testingNodes.value.delete(name)
    }
  }

  const testGroup = async () => {
    if (batch.value.running || !selectedGroup.value) return

    const names = [...new Set(selectedGroup.value.all || [])]
    batch.value = {
      running: true,
      cancelled: false,
      total: names.length,
      completed: 0,
      success: 0,
      failure: 0,
    }

    const { run, controller } = createAsyncPool(
      appSettingsStore.app.kernel.concurrencyLimit || DefaultConcurrencyLimit,
      names,
      async (name) => {
        const result = await testNode(name)
        if (!disposed) {
          batch.value.completed += 1
          result.ok ? (batch.value.success += 1) : (batch.value.failure += 1)
        }
        return result
      },
    )
    poolController = controller

    try {
      await run()
    } finally {
      poolController = undefined
      if (!disposed) {
        batch.value.running = false
        await refresh().catch(() => undefined)
      }
    }
  }

  const cancelGroupTest = () => {
    batch.value.cancelled = true
    poolController?.cancel()
  }

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
  }

  const startPolling = () => {
    stopPolling()
    if (!kernelApiStore.running) return
    void refresh().catch(() => undefined)
    pollTimer = window.setInterval(() => void refresh().catch(() => undefined), POLL_INTERVAL)
  }

  watch(
    () => kernelApiStore.running,
    (running) => (running ? startPolling() : stopPolling()),
  )

  onScopeDispose(() => {
    disposed = true
    poolController?.cancel()
    stopPolling()
  })

  return {
    selectedGroupName,
    query,
    sortByDelay,
    nodeErrors,
    testingNodes,
    batch,
    stale,
    refreshError,
    groups,
    primary,
    selectedGroup,
    nodes,
    readonlyMode,
    refresh,
    prepareModal,
    selectGroup,
    switchNode,
    testNode,
    testGroup,
    cancelGroupTest,
    startPolling,
    stopPolling,
  }
}

export type NodeController = ReturnType<typeof useNodeController>
```

- [ ] **步骤 4：运行 composable 测试**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/__tests__/useNodeController.spec.ts
pnpm type-check
```

预期：

- 刷新去重、切换、失败测速、取消和轮询测试全部 PASS。
- 类型检查退出码为 `0`。

- [ ] **步骤 5：提交 composable**

```bash
git add frontend/src/views/HomeView/useNodeController.ts \
  frontend/src/views/HomeView/__tests__/useNodeController.spec.ts
git commit -m "feat: add runtime node controller"
```

## 任务 4：实现精简节点选择弹窗

**文件：**

- 创建：`frontend/src/views/HomeView/components/NodeSelectorModal.vue`
- 创建：`frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

- [ ] **步骤 1：编写弹窗失败测试**

创建 `frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`。测试通过 `controller` prop 注入 refs，避免启动真实轮询：

```ts
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import NodeSelectorModal from '@/views/HomeView/components/NodeSelectorModal.vue'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/utils', () => ({
  message: toast,
}))

const createController = () => {
  const selectedGroupName = ref('Proxy')
  const query = ref('')
  const sortByDelay = ref(false)
  const group = {
    name: 'Proxy',
    type: 'Selector',
    all: ['HK 01', 'JP 01'],
    now: 'HK 01',
  }

  return {
    selectedGroupName,
    query,
    sortByDelay,
    nodeErrors: ref(new Map()),
    testingNodes: ref(new Set<string>()),
    batch: ref({
      running: false,
      cancelled: false,
      total: 2,
      completed: 0,
      success: 0,
      failure: 0,
    }),
    stale: ref(false),
    refreshError: ref(''),
    groups: computed(() => [group]),
    primary: computed(() => ({
      kind: 'group',
      groupName: 'Proxy',
      group,
      chain: ['Proxy', 'HK 01'],
      leafName: 'HK 01',
      delay: 80,
      readonly: false,
    })),
    selectedGroup: computed(() => group),
    nodes: computed(() => [
      {
        name: 'HK 01',
        proxy: { name: 'HK 01', type: 'VLESS', udp: true },
        delay: 80,
        delayStatus: 'success',
        originalIndex: 0,
      },
      {
        name: 'JP 01',
        proxy: { name: 'JP 01', type: 'Trojan' },
        delay: null,
        delayStatus: 'untested',
        originalIndex: 1,
      },
    ]),
    readonlyMode: computed(() => false),
    refresh: vi.fn(),
    prepareModal: vi.fn().mockResolvedValue(undefined),
    selectGroup: vi.fn((name: string) => {
      selectedGroupName.value = name
    }),
    switchNode: vi.fn().mockResolvedValue({ ok: true }),
    testNode: vi.fn().mockResolvedValue({ ok: true }),
    testGroup: vi.fn().mockResolvedValue(undefined),
    cancelGroupTest: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  }
}

const mountModal = (controller = createController()) =>
  mount(NodeSelectorModal, {
    props: {
      open: true,
      controller: controller as never,
    },
    global: {
      stubs: {
        Teleport: true,
        Modal: {
          props: ['open'],
          template: '<div class="modal-stub"><slot /><slot name="action" /></div>',
        },
        Select: {
          template:
            '<button class="group-select" @click="$emit(\'change\', \'Proxy\')">group</button>',
        },
        Input: {
          template:
            '<input class="search" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        Switch: {
          template: '<button class="sort" @click="$emit(\'update:modelValue\', true)">sort</button>',
        },
        Card: { template: '<div class="card"><slot /><slot name="extra" /></div>' },
        Button: { template: '<button v-bind="$attrs"><slot /></button>' },
        Progress: { template: '<div class="progress" />' },
        Empty: { template: '<div class="empty" />' },
        Icon: true,
      },
      mocks: {
        $t: (key: string) => key,
      },
    },
  })

describe('NodeSelectorModal', () => {
  it('prepares data when opened', async () => {
    const controller = createController()
    mountModal(controller)
    await Promise.resolve()

    expect(controller.prepareModal).toHaveBeenCalled()
  })

  it('switches a selectable node and tests delay separately', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)

    await wrapper.get('[data-node="JP 01"]').trigger('click')
    await wrapper.get('[data-delay="JP 01"]').trigger('click')

    expect(controller.switchNode).toHaveBeenCalledWith('JP 01')
    expect(controller.testNode).toHaveBeenCalledWith('JP 01')
  })

  it('starts and cancels a group delay test', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)

    await wrapper.get('[data-action="test-group"]').trigger('click')
    controller.batch.value.running = true
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-action="cancel-test"]').trigger('click')

    expect(controller.testGroup).toHaveBeenCalled()
    expect(controller.cancelGroupTest).toHaveBeenCalled()
  })

  it('wires group selection, search and delay sorting controls', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)

    await wrapper.get('.group-select').trigger('click')
    await wrapper.get('.search').setValue('jp')
    await wrapper.get('.sort').trigger('click')

    expect(controller.selectGroup).toHaveBeenCalledWith('Proxy')
    expect(controller.query.value).toBe('jp')
    expect(controller.sortByDelay.value).toBe(true)
  })

  it('retries a stale controller snapshot', async () => {
    const controller = createController()
    controller.stale.value = true
    controller.refreshError.value = 'controller offline'
    const wrapper = mountModal(controller)
    controller.prepareModal.mockClear()

    await wrapper.get('[data-action="retry-refresh"]').trigger('click')

    expect(controller.prepareModal).toHaveBeenCalledTimes(1)
  })

  it('disables switching in direct mode but keeps delay buttons usable', async () => {
    const controller = createController()
    controller.readonlyMode = computed(() => true)
    const wrapper = mountModal(controller)

    expect(wrapper.get('[data-node="JP 01"]').attributes('aria-disabled')).toBe('true')
    await wrapper.get('[data-delay="JP 01"]').trigger('click')
    expect(controller.switchNode).not.toHaveBeenCalled()
    expect(controller.testNode).toHaveBeenCalledWith('JP 01')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts
```

预期：FAIL，错误包含无法解析 `NodeSelectorModal.vue`。

- [ ] **步骤 3：实现弹窗**

创建 `frontend/src/views/HomeView/components/NodeSelectorModal.vue`：

```vue
<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { message } from '@/utils'

import type { NodeController } from '@/views/HomeView/useNodeController'

const props = defineProps<{ controller: NodeController }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const {
  selectedGroupName,
  query,
  sortByDelay,
  testingNodes,
  batch,
  stale,
  refreshError,
  groups,
  selectedGroup,
  nodes,
  readonlyMode,
} = props.controller

const groupOptions = computed(() =>
  groups.value.map((group) => ({ label: group.name, value: group.name })),
)
const batchPercent = computed(() =>
  batch.value.total ? (batch.value.completed / batch.value.total) * 100 : 0,
)

const prepareModal = async () => {
  try {
    await props.controller.prepareModal()
  } catch (error) {
    message.error(error)
  }
}

watch(open, (value) => value && void prepareModal(), { immediate: true })

const switchNode = async (name: string) => {
  if (readonlyMode.value || selectedGroup.value?.type !== 'Selector') return
  const result = await props.controller.switchNode(name)
  result.ok ? message.success('common.success') : message.error(result.error)
}

const testNode = async (name: string) => {
  const result = await props.controller.testNode(name)
  if (!result.ok) message.error(result.error)
}
</script>

<template>
  <Modal
    v-model:open="open"
    title="home.nodes.title"
    :submit="false"
    cancel-text="common.close"
    width="82"
    height="82"
    mask-closable
  >
    <div class="node-toolbar sticky top-0 z-2 flex flex-wrap items-center gap-8 pb-8">
      <Select
        :model-value="selectedGroupName"
        :options="groupOptions"
        size="small"
        @change="controller.selectGroup"
      />
      <Input
        v-model="query"
        auto-size
        clearable
        size="small"
        placeholder="common.keywords"
        class="node-search flex-1 min-w-128"
      />
      <Switch v-model="sortByDelay" size="small" label="home.nodes.sortByDelay" />
      <Button
        v-if="!batch.running"
        data-action="test-group"
        icon="speedTest"
        size="small"
        type="primary"
        @click="controller.testGroup"
      >
        {{ t('home.nodes.testGroup') }}
      </Button>
      <Button
        v-else
        data-action="cancel-test"
        size="small"
        @click="controller.cancelGroupTest"
      >
        {{ t('common.cancel') }}
      </Button>
    </div>

    <div v-if="readonlyMode" class="readonly-banner rounded-6 p-8 mb-8 text-12">
      {{ t('home.nodes.directReadonly') }}
    </div>

    <div v-if="stale" class="stale-banner rounded-6 p-8 mb-8 text-12">
      <span>{{ t('home.nodes.stale') }}: {{ refreshError }}</span>
      <Button
        data-action="retry-refresh"
        type="link"
        size="small"
        class="ml-8"
        @click="prepareModal"
      >
        {{ t('home.nodes.retry') }}
      </Button>
    </div>

    <div v-if="batch.running || batch.completed" class="mb-8">
      <Progress :percent="batchPercent" />
      <div class="text-12 mt-4">
        {{
          t('home.nodes.testProgress', [
            batch.completed,
            batch.total,
            batch.success,
            batch.failure,
          ])
        }}
      </div>
    </div>

    <Empty v-if="nodes.length === 0" />
    <div v-else class="node-grid grid gap-8 pb-8">
      <Card
        v-for="node in nodes"
        :key="node.name"
        :title="node.name"
        :selected="node.name === selectedGroup?.now"
        :data-node="node.name"
        :aria-disabled="readonlyMode || selectedGroup?.type !== 'Selector'"
        :class="{
          'cursor-pointer': !readonlyMode && selectedGroup?.type === 'Selector',
          'cursor-not-allowed': readonlyMode || selectedGroup?.type !== 'Selector',
        }"
        role="button"
        tabindex="0"
        @click="switchNode(node.name)"
        @keydown.enter.prevent="switchNode(node.name)"
        @keydown.space.prevent="switchNode(node.name)"
      >
        <div class="flex items-center text-12">
          <span>{{ node.proxy?.type || t('home.nodes.unknownType') }}</span>
          <span v-if="node.proxy?.udp" class="ml-4">UDP</span>
          <Button
            :data-delay="node.name"
            :loading="testingNodes.has(node.name)"
            type="text"
            size="small"
            class="ml-auto"
            @click.stop="testNode(node.name)"
          >
            <span v-if="node.delayStatus === 'success'">{{ node.delay }} ms</span>
            <span v-else-if="node.delayStatus === 'failed'">{{ t('home.nodes.unavailable') }}</span>
            <span v-else>{{ t('home.nodes.untested') }}</span>
          </Button>
        </div>
      </Card>
    </div>
  </Modal>
</template>

<style lang="less" scoped>
.node-toolbar {
  background: var(--modal-bg);
}

.readonly-banner {
  color: var(--level-3-color);
  background: var(--card-bg);
}

.stale-banner {
  color: var(--level-4-color);
  background: var(--card-bg);
}

.node-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 1000px) {
  .node-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .node-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .node-search {
    flex-basis: 100%;
  }
}
</style>
```

- [ ] **步骤 4：运行弹窗测试和类型检查**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts
pnpm type-check
```

预期：

- 弹窗打开、切换、测速、批量取消和只读模式测试全部 PASS。
- 类型检查退出码为 `0`。

- [ ] **步骤 5：提交弹窗**

```bash
git add frontend/src/views/HomeView/components/NodeSelectorModal.vue \
  frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts
git commit -m "feat: add compact node selector modal"
```

## 任务 5：接入首页当前节点卡片和国际化

**文件：**

- 创建：`frontend/src/views/HomeView/components/CurrentNodeCard.vue`
- 创建：`frontend/src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts`
- 修改：`frontend/src/views/HomeView/components/OverView.vue`
- 修改：`frontend/src/lang/locale/zh.ts`
- 修改：`frontend/src/lang/locale/en.ts`

- [ ] **步骤 1：编写首页卡片失败测试**

创建 `frontend/src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts`：

```ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareModal: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn(),
  kernelStore: { running: true },
}))

vi.mock('@/views/HomeView/useNodeController', async () => {
  const { computed, ref } = await import('vue')
  return {
    useNodeController: () => ({
      selectedGroupName: ref('Proxy'),
      query: ref(''),
      sortByDelay: ref(false),
      nodeErrors: ref(new Map()),
      testingNodes: ref(new Set()),
      batch: ref({
        running: false,
        cancelled: false,
        total: 0,
        completed: 0,
        success: 0,
        failure: 0,
      }),
      stale: ref(false),
      refreshError: ref(''),
      groups: computed(() => []),
      primary: computed(() => ({
        kind: 'group',
        groupName: 'Proxy',
        chain: ['Proxy', 'Auto', 'HK 01'],
        leafName: 'HK 01',
        delay: 86,
        readonly: false,
      })),
      selectedGroup: computed(() => undefined),
      nodes: computed(() => []),
      readonlyMode: computed(() => false),
      refresh: vi.fn(),
      prepareModal: mocks.prepareModal,
      selectGroup: vi.fn(),
      switchNode: vi.fn(),
      testNode: vi.fn(),
      testGroup: vi.fn(),
      cancelGroupTest: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    }),
  }
})

vi.mock('@/stores', () => ({
  useKernelApiStore: () => mocks.kernelStore,
}))

vi.mock('@/utils', () => ({
  message: { warn: mocks.warn },
}))

import CurrentNodeCard from '@/views/HomeView/components/CurrentNodeCard.vue'

const mountCard = () =>
  mount(CurrentNodeCard, {
    global: {
      stubs: {
        Card: { template: '<div><slot /><slot name="extra" /></div>' },
        NodeSelectorModal: {
          props: ['open'],
          template: '<div class="selector-modal" :data-open="open" />',
        },
        Icon: true,
      },
      mocks: {
        $t: (key: string) => key,
      },
    },
  })

describe('CurrentNodeCard', () => {
  beforeEach(() => {
    mocks.kernelStore.running = true
    mocks.warn.mockReset()
  })

  it('shows the group, full chain and final delay', () => {
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('Proxy')
    expect(wrapper.text()).toContain('Auto')
    expect(wrapper.text()).toContain('HK 01')
    expect(wrapper.text()).toContain('86 ms')
  })

  it('opens from click and keyboard', async () => {
    const wrapper = mountCard()

    await wrapper.get('[data-current-node]').trigger('click')
    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('true')

    await wrapper.get('[data-current-node]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('true')
  })

  it('does not open while the core is stopped', async () => {
    mocks.kernelStore.running = false
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('home.nodes.coreUnavailable')
    await wrapper.get('[data-current-node]').trigger('click')

    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('false')
    expect(mocks.warn).toHaveBeenCalledWith('home.nodes.startCoreFirst')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd frontend
pnpm exec vitest run src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts
```

预期：FAIL，错误包含无法解析 `CurrentNodeCard.vue`。

- [ ] **步骤 3：实现首页卡片**

创建 `frontend/src/views/HomeView/components/CurrentNodeCard.vue`：

```vue
<script setup lang="ts">
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { message } from '@/utils'
import { useNodeController } from '@/views/HomeView/useNodeController'

import NodeSelectorModal from './NodeSelectorModal.vue'

const open = ref(false)
const controller = useNodeController()
const kernelApiStore = useKernelApiStore()
const { t } = useI18n()
const { primary, stale } = controller

const displayChain = computed(() => primary.value.chain.join(' -> '))

const openSelector = () => {
  if (!kernelApiStore.running) {
    message.warn('home.nodes.startCoreFirst')
    return
  }
  open.value = true
}

onMounted(controller.startPolling)
onActivated(controller.startPolling)
onDeactivated(controller.stopPolling)
onUnmounted(controller.stopPolling)
</script>

<template>
  <div
    data-current-node
    role="button"
    tabindex="0"
    class="h-full"
    :aria-label="t('home.nodes.openSelector')"
    @click="openSelector"
    @keydown.enter.prevent="openSelector"
    @keydown.space.prevent="openSelector"
  >
    <Card :title="t('home.nodes.current')" class="h-full cursor-pointer">
      <template #extra>
        <span v-if="stale" class="text-12 mr-4">
          {{ t('home.nodes.stale') }}
        </span>
        <span v-if="primary.delay" class="text-12">
          {{ primary.delay }} ms
        </span>
      </template>

      <div v-if="!kernelApiStore.running" class="py-8 text-12">
        {{ t('home.nodes.coreUnavailable') }}
      </div>
      <div v-else-if="primary.kind === 'unavailable'" class="py-8 text-12">
        {{ t('home.nodes.noSelectableNode') }}
      </div>
      <div v-else class="py-8 min-w-0">
        <div class="font-bold line-clamp-1">
          {{ primary.groupName }}
        </div>
        <div v-tips="displayChain" class="text-12 line-clamp-1 mt-4">
          {{ displayChain }}
        </div>
      </div>
    </Card>
  </div>

  <NodeSelectorModal v-model:open="open" :controller="controller" />
</template>
```

- [ ] **步骤 4：增加中英文文案**

在 `home` 下增加 `nodes`：

```ts
// zh.ts
nodes: {
  title: '节点选择',
  current: '当前节点',
  openSelector: '打开节点选择',
  sortByDelay: '按延迟排序',
  testGroup: '整组测速',
  testProgress: '已完成 {0}/{1}，成功 {2}，失败 {3}',
  untested: '未测速',
  unavailable: '超时/不可用',
  unknownType: '未知类型',
  stale: '状态已过期',
  retry: '重试',
  directReadonly: '当前为直连模式，可以查看和测速，但不能切换节点。',
  startCoreFirst: '请先启动核心',
  coreUnavailable: '核心未运行',
  noSelectableNode: '未检测到可切换节点',
  readonly: '当前模式不允许切换节点',
  nodeMissing: '节点已不存在，请刷新后重试',
  alreadyTesting: '该节点正在测速',
},
```

```ts
// en.ts
nodes: {
  title: 'Node Selector',
  current: 'Current Node',
  openSelector: 'Open node selector',
  sortByDelay: 'Sort by latency',
  testGroup: 'Test Group',
  testProgress: 'Completed {0}/{1}, success {2}, failed {3}',
  untested: 'Untested',
  unavailable: 'Timeout/Unavailable',
  unknownType: 'Unknown type',
  stale: 'State is stale',
  retry: 'Retry',
  directReadonly: 'Direct mode is active. Nodes can be viewed and tested, but not switched.',
  startCoreFirst: 'Start the core first',
  coreUnavailable: 'Core is not running',
  noSelectableNode: 'No selectable node detected',
  readonly: 'Node switching is unavailable in the current mode',
  nodeMissing: 'The node no longer exists. Refresh and try again.',
  alreadyTesting: 'This node is already being tested',
},
```

- [ ] **步骤 5：接入 OverView 并改为响应式网格**

在 `frontend/src/views/HomeView/components/OverView.vue` 导入：

```ts
import CurrentNodeCard from './CurrentNodeCard.vue'
```

把现有四卡片 `flex` 容器替换为：

```vue
<div class="overview-cards grid mt-20 gap-12">
  <CurrentNodeCard />
  <Card :title="t('home.overview.realtimeTraffic')">
    <div class="py-8 text-12">
      ↑ {{ formatBytes(statistics.upload) }}/s ↓ {{ formatBytes(statistics.download) }}/s
    </div>
  </Card>
  <Card :title="t('home.overview.totalTraffic')">
    <div class="py-8 text-12">
      ↑ {{ formatBytes(statistics.uploadTotal) }} ↓ {{ formatBytes(statistics.downloadTotal) }}
    </div>
  </Card>
  <Card
    :title="t('home.overview.connections')"
    class="cursor-pointer"
    @click="handleShowApiConnections"
  >
    <div class="py-8 text-12">
      {{ statistics.connections.length }}
    </div>
  </Card>
  <Card
    :title="t('home.overview.memory')"
    class="cursor-pointer"
    @click="handleToggleRealMemoryUsage"
  >
    <div class="py-8 text-12">
      {{ formatBytes(statistics.inuse) }}
      <span v-if="appSettings.app.kernel.realMemoryUsage">
        / ({{ formatBytes(statistics.memUsage) }})
      </span>
    </div>
  </Card>
</div>
```

在模板结束后增加：

```less
<style lang="less" scoped>
.overview-cards {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .overview-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .overview-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
```

- [ ] **步骤 6：运行卡片测试、全部节点测试和类型检查**

运行：

```bash
cd frontend
pnpm exec vitest run \
  src/views/HomeView/__tests__/nodeController.spec.ts \
  src/views/HomeView/__tests__/useNodeController.spec.ts \
  src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts \
  src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts
pnpm type-check
```

预期：

- 四个测试文件全部 PASS。
- 类型检查退出码为 `0`。

- [ ] **步骤 7：提交首页集成**

```bash
git add frontend/src/views/HomeView/components/CurrentNodeCard.vue \
  frontend/src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts \
  frontend/src/views/HomeView/components/OverView.vue \
  frontend/src/lang/locale/zh.ts \
  frontend/src/lang/locale/en.ts
git commit -m "feat: show current node on overview"
```

## 任务 6：全量验证桌面端与 WebUI 共用路径

**文件：**

- 验证所有本计划修改文件。
- 如验证发现缺陷，只修改对应任务中的文件，并在修复前先增加回归测试。

- [ ] **步骤 1：运行前端全量测试**

运行：

```bash
cd frontend
pnpm test
```

预期：全部测试 PASS，无未处理 Promise rejection。

- [ ] **步骤 2：运行类型检查**

运行：

```bash
cd frontend
pnpm type-check
```

预期：`vue-tsc --build` 退出码为 `0`。

- [ ] **步骤 3：构建桌面前端和 Headless WebUI**

运行：

```bash
cd frontend
pnpm build
```

预期：

- 默认前端构建成功。
- `vite build --mode webui` 成功。
- `frontend/dist/webui/` 更新生成。

- [ ] **步骤 4：重新构建包含 WebUI 资源的 Wails 二进制**

运行：

```bash
wails build
```

预期：

- Wails 桌面/headless 二进制构建成功。
- `build/bin/GUI.for.SingBox` 已包含本次生成的 `frontend/dist/webui/` 资源。

- [ ] **步骤 5：运行 Go 回归测试**

运行：

```bash
go test ./...
```

预期：全部 Go package PASS。虽然本功能不修改 Go，但这一步验证 WebUI 核心代理和 Bridge 没有被前端改动间接破坏。

- [ ] **步骤 6：手动验证桌面端**

运行开发版或现有构建，逐项确认：

1. 核心未运行时卡片显示“核心未运行”，点击提示先启动核心。
2. `rule` 模式显示从 `route.final` 解析出的主组、完整链和最终节点。
3. `global` 模式显示 `GLOBAL`。
4. `direct` 模式显示 `direct`，弹窗可测速但不能切换。
5. 普通 `Selector` 可切换节点，首页、完整控制器和托盘状态同步。
6. `URLTest` 展示自动节点，成员不可手动切换。
7. 单节点失败显示“超时/不可用”，不显示 `0 ms`。
8. 整组测速可取消，已完成结果保留。
9. 开启“自动断开连接”后切换节点，受影响连接被关闭。

- [ ] **步骤 7：手动验证 Headless WebUI**

运行：

```bash
./build/bin/GUI.for.SingBox --headless --webui-listen 127.0.0.1:18080
```

浏览器打开输出的 URL，完成 token 登录后重复步骤 2 至 8，并额外确认：

1. Network 面板中的节点请求以前缀 `/__webui/core/` 发出并以 `/proxies` 结尾，浏览器控制台无 CORS 错误。
2. token 失效时沿用现有登录回退。
3. 窗口宽度小于 `560px` 时，概览卡片和节点列表为单列。
4. 弹窗工具栏换行，无横向滚动。

- [ ] **步骤 8：检查最终 diff**

运行：

```bash
git status --short
git diff --check
git log --oneline -6
```

预期：

- 没有意外修改或构建产物被暂存。
- `git diff --check` 无输出。
- 历史中包含本计划的四个功能提交和一个测试基础提交。

- [ ] **步骤 9：提交验证中发现的修复**

仅当步骤 1 至 8 发现并修复问题时执行：

```bash
git add frontend/package.json frontend/pnpm-lock.yaml \
  frontend/src/types/kernel.d.ts \
  frontend/src/views/HomeView/nodeController.ts \
  frontend/src/views/HomeView/useNodeController.ts \
  frontend/src/views/HomeView/components/NodeSelectorModal.vue \
  frontend/src/views/HomeView/components/CurrentNodeCard.vue \
  frontend/src/views/HomeView/components/OverView.vue \
  frontend/src/views/HomeView/__tests__/nodeController.spec.ts \
  frontend/src/views/HomeView/__tests__/useNodeController.spec.ts \
  frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts \
  frontend/src/views/HomeView/components/__tests__/CurrentNodeCard.spec.ts \
  frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "fix: harden current node controller"
```

如果没有额外修复，不创建空提交。
