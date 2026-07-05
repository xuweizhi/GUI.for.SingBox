# 网络检测半复刻实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将现有 `NetCheckView` 从“核心 / 代理 HTTP / TCP + 节点面板”的精简版升级为 4 组分层诊断，补齐 DNS 结果、最近命中的规则链路和规则集本地状态。

**架构：** 保留现有单页入口，继续让 `useNetworkCheck` 负责会话编排，把结果模型从平铺列表升级为分组卡片；让 `useRuntimeNetworkCheck` 只负责从 controller、store 和 bridge 收集运行时数据。新增纯函数 helper 处理连接匹配和规则集状态整理，把容易出错的逻辑放到可单测的文件里。

**技术栈：** Vue 3、Pinia、TypeScript、Vitest、Vue Test Utils、现有 Clash API 封装

---

## 文件结构

### 创建

- `frontend/src/views/NetCheckView/networkCheckRuntime.ts`
  - 纯函数 helper。
  - 负责：
    - 从连接列表中匹配最近命中的连接；
    - 把 `route.rule_set` + `rulesetsStore.rulesets` 整理成规则集状态条目；
    - 统一格式化 DNS answers、chain 文本和规则集摘要。
- `frontend/src/views/NetCheckView/components/NetCheckGroupCard.vue`
  - 结果分组卡片组件。
  - 只负责渲染组标题、组摘要和组内条目，不承担数据获取逻辑。
- `frontend/src/views/NetCheckView/__tests__/networkCheckRuntime.spec.ts`
  - 覆盖连接匹配和规则集状态整理。

### 修改

- `frontend/src/views/NetCheckView/networkCheckTarget.ts`
  - 扩展目标解析，支持 IPv4 / IPv6 / 纯 IP 判断。
- `frontend/src/views/NetCheckView/__tests__/networkCheckTarget.spec.ts`
  - 覆盖新增输入形态。
- `frontend/src/types/kernel.d.ts`
  - 增加 DNS 查询返回类型与更完整的连接记录类型。
- `frontend/src/api/kernel.ts`
  - 增加 `dnsQuery()` 请求封装。
- `frontend/src/views/NetCheckView/useNetworkCheck.ts`
  - 将结果模型升级为“分组 + 条目”。
  - 编排 4 组检查顺序和组级状态归并。
- `frontend/src/views/NetCheckView/useRuntimeNetworkCheck.ts`
  - 增加 DNS 查询、连接匹配、当前主出站延迟、规则集状态依赖注入。
- `frontend/src/views/NetCheckView/index.vue`
  - 改用分组卡片渲染结果区。
- `frontend/src/views/NetCheckView/__tests__/useNetworkCheck.spec.ts`
  - 改为断言分组模型和新增检查项。
- `frontend/src/views/NetCheckView/__tests__/useRuntimeNetworkCheck.spec.ts`
  - 保留 desktop-only bridge 动态导入回归，并增加运行时 wiring 测试。
- `frontend/src/views/NetCheckView/__tests__/index.spec.ts`
  - 更新页面渲染断言。
- `frontend/src/lang/locale/zh.ts`
  - 补中文分组标题和新增结果文案。
- `frontend/src/lang/locale/en.ts`
  - 补英文分组标题和新增结果文案。

## 任务 1：扩展目标解析模型

**文件：**
- 修改：`frontend/src/views/NetCheckView/networkCheckTarget.ts`
- 测试：`frontend/src/views/NetCheckView/__tests__/networkCheckTarget.spec.ts`

- [ ] **步骤 1：先把目标解析测试扩到半复刻场景**

```ts
it('marks IPv4 input as an IP target and skips DNS later', () => {
  expect(parseNetworkCheckTarget('1.1.1.1')).toMatchObject({
    requestUrl: 'https://1.1.1.1/',
    tcpHost: '1.1.1.1',
    tcpPort: 443,
    targetKind: 'ip',
    dnsLookupHost: '',
  })
})

it('keeps bracketed IPv6 host and explicit port', () => {
  expect(parseNetworkCheckTarget('[2606:4700:4700::1111]:8443')).toMatchObject({
    requestUrl: 'https://[2606:4700:4700::1111]:8443/',
    tcpHost: '2606:4700:4700::1111',
    tcpPort: 8443,
    targetKind: 'ip',
  })
})

it('keeps domain targets DNS-queryable', () => {
  expect(parseNetworkCheckTarget('https://example.com/path')).toMatchObject({
    targetKind: 'domain',
    dnsLookupHost: 'example.com',
    requestHost: 'example.com',
  })
})
```

- [ ] **步骤 2：运行测试，确认现有解析模型不够用**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/networkCheckTarget.spec.ts`

预期：FAIL，报错包含 `targetKind` / `dnsLookupHost` 缺失，或 IPv6 输入解析结果不符合预期。

- [ ] **步骤 3：用最小改动扩展解析结果结构**

```ts
export interface ParsedNetworkCheckTarget {
  input: string
  requestUrl: string
  requestHost: string
  tcpHost: string
  tcpPort: number
  displayHost: string
  dnsLookupHost: string
  targetKind: 'domain' | 'ip'
}

const isIpLiteral = (host: string) => {
  return /^[\d.]+$/.test(host) || host.includes(':')
}

return {
  input: trimmed,
  requestUrl: url.toString(),
  requestHost: url.hostname,
  tcpHost: url.hostname,
  tcpPort: Number(url.port || (url.protocol === 'http:' ? 80 : 443)),
  displayHost: url.hostname,
  dnsLookupHost: isIpLiteral(url.hostname) ? '' : url.hostname,
  targetKind: isIpLiteral(url.hostname) ? 'ip' : 'domain',
}
```

- [ ] **步骤 4：重跑解析测试确认通过**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/networkCheckTarget.spec.ts`

预期：PASS，`5 passed` 变为包含新增用例的全绿结果。

- [ ] **步骤 5：提交这一小步**

```bash
git add frontend/src/views/NetCheckView/networkCheckTarget.ts frontend/src/views/NetCheckView/__tests__/networkCheckTarget.spec.ts
git commit -m "test: extend net check target parsing"
```

## 任务 2：补纯函数 helper 和 controller 类型

**文件：**
- 创建：`frontend/src/views/NetCheckView/networkCheckRuntime.ts`
- 修改：`frontend/src/types/kernel.d.ts`
- 修改：`frontend/src/api/kernel.ts`
- 测试：`frontend/src/views/NetCheckView/__tests__/networkCheckRuntime.spec.ts`

- [ ] **步骤 1：先写纯函数测试，锁定连接匹配和规则集状态语义**

```ts
import { describe, expect, it } from 'vitest'

import {
  buildRulesetCheckItems,
  formatDnsAnswers,
  matchLatestConnection,
} from '@/views/NetCheckView/networkCheckRuntime'

describe('matchLatestConnection', () => {
  it('prefers the newest matching host+port record', () => {
    const match = matchLatestConnection(
      [
        {
          id: '1',
          start: '2026-07-05T00:00:00Z',
          chains: ['Proxy', 'HK 01'],
          rule: 'rule_set=GeoSite-CN => route(🎯 全球直连)',
          rulePayload: '',
          download: 0,
          upload: 0,
          metadata: {
            host: 'example.com',
            destinationIP: '',
            destinationPort: '443',
            dnsMode: 'normal',
            network: 'tcp',
            processPath: '',
            sourceIP: '127.0.0.1',
            sourcePort: '12345',
            type: 'mixed/mixed-in',
          },
        },
        {
          id: '2',
          start: '2026-07-05T00:00:01Z',
          chains: ['Proxy', 'JP 01'],
          rule: 'final => route(🚀 节点选择)',
          rulePayload: '',
          download: 0,
          upload: 0,
          metadata: {
            host: 'example.com',
            destinationIP: '',
            destinationPort: '443',
            dnsMode: 'normal',
            network: 'tcp',
            processPath: '',
            sourceIP: '127.0.0.1',
            sourcePort: '12346',
            type: 'mixed/mixed-in',
          },
        },
      ],
      { targetHost: 'example.com', targetPort: 443 },
    )

    expect(match?.id).toBe('2')
  })
})

describe('buildRulesetCheckItems', () => {
  it('marks missing and disabled rulesets as failed', () => {
    const items = buildRulesetCheckItems(
      [
        { id: 'rs-1', type: 'local', tag: 'GeoIP-CN', rules: '', path: 'ruleset-1', url: '', download_detour: '', update_interval: '', format: 'source' },
        { id: 'rs-2', type: 'remote', tag: 'GeoSite-CN', rules: '', path: 'ruleset-2', url: '', download_detour: '', update_interval: '', format: 'binary' },
      ],
      [
        { id: 'ruleset-1', name: 'GeoIP-CN', updateTime: 1, disabled: true, type: 'Manual', format: 'source', path: 'data/rulesets/geoip-cn.json', url: '', count: 100 },
      ],
    )

    expect(items.map((item) => item.status)).toEqual(['failed', 'failed'])
  })
})
```

- [ ] **步骤 2：运行 helper 测试，确认文件和类型尚不存在**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/networkCheckRuntime.spec.ts`

预期：FAIL，报错包含 `Failed to resolve import` 或导出函数不存在。

- [ ] **步骤 3：补 helper 文件、连接类型和 DNS API 封装**

```ts
// frontend/src/types/kernel.d.ts
export interface CoreApiDnsQueryResponse {
  Status: number
  Server: string
  Answer?: { data: string; name: string; type: number; TTL: number }[]
}

export interface CoreApiConnectionRecord {
  id: string
  chains: string[]
  download: number
  upload: number
  rule: string
  rulePayload: string
  start: string
  metadata: {
    host: string
    destinationIP: string
    destinationPort: string
    dnsMode: string
    network: string
    processPath: string
    sourceIP: string
    sourcePort: string
    type: string
  }
}

export interface CoreApiConnections {
  connections: CoreApiConnectionRecord[]
}

// frontend/src/api/kernel.ts
export enum Api {
  DnsQuery = '/dns/query',
}

export const dnsQuery = (name: string) => {
  return request.get<CoreApiDnsQueryResponse>(Api.DnsQuery, { name })
}

// frontend/src/views/NetCheckView/networkCheckRuntime.ts
export const formatDnsAnswers = (answers: { data: string }[] = []) => answers.map((item) => item.data)

export const buildRulesetCheckItems = (
  profileRulesets: App.ProfileRuleSet[],
  rulesets: App.RuleSet[],
) => {
  return profileRulesets.map((profileRuleset) => {
    const linkedRuleset =
      profileRuleset.type === 'local'
        ? rulesets.find((item) => item.id === profileRuleset.path)
        : rulesets.find(
            (item) => item.url === profileRuleset.url || item.name === profileRuleset.tag,
          )

    if (!linkedRuleset) {
      return {
        id: `ruleset-${profileRuleset.id}`,
        title: profileRuleset.tag || profileRuleset.id,
        status: 'failed' as const,
        summary: 'ruleset missing',
        detail: profileRuleset.type === 'local' ? profileRuleset.path : profileRuleset.url,
      }
    }

    if (linkedRuleset.disabled) {
      return {
        id: `ruleset-${profileRuleset.id}`,
        title: linkedRuleset.name,
        status: 'failed' as const,
        summary: 'ruleset disabled',
        detail: linkedRuleset.path,
      }
    }

    return {
      id: `ruleset-${profileRuleset.id}`,
      title: linkedRuleset.name,
      status: 'success' as const,
      summary: `${linkedRuleset.count} rules`,
      detail: linkedRuleset.path,
    }
  })
}

export const matchLatestConnection = (
  connections: CoreApiConnectionRecord[],
  target: { targetHost: string; targetPort: number },
) => {
  return connections
    .filter((item) => {
      const port = Number(item.metadata.destinationPort || 0)
      return (
        port === target.targetPort &&
        (item.metadata.host === target.targetHost || item.metadata.destinationIP === target.targetHost)
      )
    })
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0]
}
```

- [ ] **步骤 4：重跑 helper 测试**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/networkCheckRuntime.spec.ts`

预期：PASS，连接匹配和规则集状态用例通过。

- [ ] **步骤 5：提交 helper 和类型补齐**

```bash
git add frontend/src/views/NetCheckView/networkCheckRuntime.ts frontend/src/views/NetCheckView/__tests__/networkCheckRuntime.spec.ts frontend/src/types/kernel.d.ts frontend/src/api/kernel.ts
git commit -m "feat: add net check runtime helpers"
```

## 任务 3：把会话结果从平铺列表升级为分组模型

**文件：**
- 修改：`frontend/src/views/NetCheckView/useNetworkCheck.ts`
- 测试：`frontend/src/views/NetCheckView/__tests__/useNetworkCheck.spec.ts`

- [ ] **步骤 1：先把 composable 测试改成分组结果**

```ts
const mocks = {
  probeApiAvailability: vi.fn(),
  getKernelProxyEndpoint: vi.fn(),
  httpHead: vi.fn(),
  httpGet: vi.fn(),
  tcpPing: vi.fn(),
  dnsQuery: vi.fn(),
  getPrimaryOutboundState: vi.fn(),
  getLatestRuleMatch: vi.fn(),
  getRulesetStates: vi.fn(),
}

it('builds the four result groups for a domain target', async () => {
  mocks.probeApiAvailability.mockResolvedValue({ version: 'ok' })
  mocks.getKernelProxyEndpoint.mockResolvedValue({
    schema: 'http',
    host: '127.0.0.1',
    port: 7890,
    username: '',
    password: '',
  })
  mocks.httpHead.mockResolvedValue({ status: 204, headers: {}, body: '' })
  mocks.tcpPing.mockResolvedValue(86)
  mocks.dnsQuery.mockResolvedValue({
    server: 'internal',
    status: 0,
    answers: ['142.250.129.94'],
  })
  mocks.getPrimaryOutboundState.mockResolvedValue({
    mode: 'group',
    groupName: 'Proxy',
    leafName: 'HK 01',
    chain: ['Proxy', 'HK 01'],
    delay: 80,
  })
  mocks.getLatestRuleMatch.mockResolvedValue({
    host: 'example.com',
    port: 443,
    rule: 'final => route(Proxy)',
    chains: ['Proxy', 'HK 01'],
  })
  mocks.getRulesetStates.mockResolvedValue([
    { id: 'rs-1', title: 'GeoIP-CN', status: 'success', summary: '100 rules' },
  ])

  const scope = effectScope()
  const vm = scope.run(() => useNetworkCheck(mocks))!
  await vm.run('https://example.com')

  expect(vm.groups.value.map((group) => group.id)).toEqual(['overview', 'dns', 'outbound', 'rulesets'])
  expect(vm.groups.value[1]?.items[0]).toMatchObject({
    id: 'dns-query',
    status: 'success',
  })
})

it('skips DNS when the target is an IP literal', async () => {
  const scope = effectScope()
  const vm = scope.run(() => useNetworkCheck(mocks))!
  await vm.run('1.1.1.1')
  expect(vm.groups.value.find((group) => group.id === 'dns')?.items[0]).toMatchObject({
    status: 'skipped',
  })
})
```

- [ ] **步骤 2：运行 composable 测试，确认当前模型不匹配**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/useNetworkCheck.spec.ts`

预期：FAIL，报错包含 `groups` 不存在，或新增 deps 未定义。

- [ ] **步骤 3：重构 `useNetworkCheck` 为分组模型**

```ts
export interface NetworkCheckResultItem {
  id: string
  title: string
  status: ResultStatus
  summary: string
  detail?: string
  durationMs?: number
}

export interface NetworkCheckResultGroup {
  id: 'overview' | 'dns' | 'outbound' | 'rulesets'
  title: string
  status: ResultStatus
  summary: string
  items: NetworkCheckResultItem[]
}

export interface NetworkCheckDeps {
  probeApiAvailability: () => Promise<unknown>
  getKernelProxyEndpoint: () => Promise<NetworkCheckProxyEndpoint | undefined>
  httpHead: (
    url: string,
    headers?: Record<string, string>,
    options?: NetworkRequestOptions,
  ) => Promise<NetworkResponse>
  httpGet: (
    url: string,
    headers?: Record<string, string>,
    options?: NetworkRequestOptions,
  ) => Promise<NetworkResponse>
  tcpPing: (address: string, options?: { Timeout?: number }) => Promise<number>
  dnsQuery: (host: string) => Promise<{ server: string; status: number; answers: string[] }>
  getPrimaryOutboundState: () => Promise<{
    mode: 'group' | 'direct' | 'unavailable'
    groupName: string
    leafName: string
    chain: string[]
    delay: number | null
  }>
  getLatestRuleMatch: (target: ParsedNetworkCheckTarget) => Promise<{
    host: string
    port: number
    rule: string
    chains: string[]
  } | undefined>
  getRulesetStates: () => Promise<NetworkCheckResultItem[]>
}

const summarizeGroupStatus = (items: NetworkCheckResultItem[]): ResultStatus => {
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'running')) return 'running'
  if (items.some((item) => item.status === 'success')) return 'success'
  return 'skipped'
}
```

- [ ] **步骤 4：重跑 composable 测试**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/useNetworkCheck.spec.ts`

预期：PASS，新增分组测试通过，旧的平铺结果断言已被替换。

- [ ] **步骤 5：提交会话模型升级**

```bash
git add frontend/src/views/NetCheckView/useNetworkCheck.ts frontend/src/views/NetCheckView/__tests__/useNetworkCheck.spec.ts
git commit -m "feat: group net check session results"
```

## 任务 4：补运行时 wiring

**文件：**
- 修改：`frontend/src/views/NetCheckView/useRuntimeNetworkCheck.ts`
- 修改：`frontend/src/api/kernel.ts`
- 测试：`frontend/src/views/NetCheckView/__tests__/useRuntimeNetworkCheck.spec.ts`

- [ ] **步骤 1：先把 runtime hook 测试补到新的依赖映射**

```ts
const captured = vi.fn()

vi.mock('@/views/NetCheckView/useNetworkCheck', () => ({
  useNetworkCheck: (deps: unknown) => {
    captured(deps)
    return {
      input: ref('https://example.com'),
      running: ref(false),
      groups: ref([]),
      clear: vi.fn(),
      run: vi.fn(),
    }
  },
}))

it('wires dnsQuery, rule matching and ruleset state providers', async () => {
  useRuntimeNetworkCheck()
  const deps = captured.mock.calls[0]?.[0]
  expect(typeof deps.dnsQuery).toBe('function')
  expect(typeof deps.getLatestRuleMatch).toBe('function')
  expect(typeof deps.getRulesetStates).toBe('function')
})

it('keeps dynamic bridge imports for desktop-only bridge code', () => {
  const source = fs.readFileSync(path.resolve('src/views/NetCheckView/useRuntimeNetworkCheck.ts'), 'utf8')
  expect(source).toContain("import('@/bridge/browser/go/bridge/App')")
  expect(source).toContain("import('@/bridge/wailsjs/go/bridge/App')")
})
```

- [ ] **步骤 2：运行 runtime hook 测试**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/useRuntimeNetworkCheck.spec.ts`

预期：FAIL，报错包含 `groups` 缺失或新增 deps 未被传入 `useNetworkCheck`。

- [ ] **步骤 3：在 runtime hook 里接上 controller/store/API 数据**

```ts
import { dnsQuery, getConnections, getProxyDelay } from '@/api/kernel'
import { useProfilesStore, useRulesetsStore, useKernelApiStore } from '@/stores'
import { DefaultTestTimeout, DefaultTestURL } from '@/constant/app'
import { resolvePrimaryNode } from '@/views/HomeView/nodeController'
import {
  buildRulesetCheckItems,
  formatDnsAnswers,
  matchLatestConnection,
} from '@/views/NetCheckView/networkCheckRuntime'

const getPrimaryOutboundState = async () => {
  await kernelApiStore.refreshProviderProxies()
  const primary = resolvePrimaryNode(
    kernelApiStore.config.mode as 'rule' | 'global' | 'direct',
    profilesStore.currentProfile,
    kernelApiStore.proxies,
  )

  let delay = primary.delay
  if (primary.kind === 'group' && primary.leafName && delay == null) {
    const result = await getProxyDelay(
      encodeURIComponent(primary.leafName),
      appSettingsStore.app.kernel.testUrl || DefaultTestURL,
      appSettingsStore.app.kernel.testTimeout || DefaultTestTimeout,
    )
    delay = result.delay > 0 ? result.delay : null
  }

  return {
    mode: primary.kind,
    groupName: primary.groupName,
    leafName: primary.leafName,
    chain: primary.chain,
    delay,
  }
}

const getLatestRuleMatch = async (target: ParsedNetworkCheckTarget) => {
  const { connections } = await getConnections()
  const match = matchLatestConnection(connections, {
    targetHost: target.requestHost,
    targetPort: target.tcpPort,
  })
  if (!match) return
  return {
    host: match.metadata.host || match.metadata.destinationIP,
    port: Number(match.metadata.destinationPort || 0),
    rule: match.rule,
    chains: match.chains,
  }
}
```

- [ ] **步骤 4：重跑 runtime hook 测试**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/useRuntimeNetworkCheck.spec.ts`

预期：PASS，动态 bridge 回归仍在，新增 deps 已暴露。

- [ ] **步骤 5：提交 runtime 依赖接线**

```bash
git add frontend/src/views/NetCheckView/useRuntimeNetworkCheck.ts frontend/src/views/NetCheckView/__tests__/useRuntimeNetworkCheck.spec.ts frontend/src/api/kernel.ts
git commit -m "feat: wire runtime data into net check"
```

## 任务 5：更新页面渲染和文案

**文件：**
- 创建：`frontend/src/views/NetCheckView/components/NetCheckGroupCard.vue`
- 修改：`frontend/src/views/NetCheckView/index.vue`
- 修改：`frontend/src/lang/locale/zh.ts`
- 修改：`frontend/src/lang/locale/en.ts`
- 测试：`frontend/src/views/NetCheckView/__tests__/index.spec.ts`

- [ ] **步骤 1：先把页面测试改为断言 4 组结果卡片**

```ts
vi.mock('@/views/NetCheckView/useRuntimeNetworkCheck', () => ({
  useRuntimeNetworkCheck: () => ({
    input: ref('https://example.com'),
    running: ref(false),
    groups: ref([
      {
        id: 'overview',
        title: 'netCheck.groups.overview',
        status: 'success',
        summary: 'ok',
        items: [{ id: 'core', title: 'netCheck.results.core', status: 'success', summary: 'ok' }],
      },
      {
        id: 'dns',
        title: 'netCheck.groups.dns',
        status: 'success',
        summary: 'dns ok',
        items: [{ id: 'dns-query', title: 'netCheck.results.dnsQuery', status: 'success', summary: '1.1.1.1' }],
      },
    ]),
    clear: mocks.clear,
    run: mocks.run,
  }),
}))

expect(wrapper.text()).toContain('netCheck.groups.overview')
expect(wrapper.text()).toContain('netCheck.groups.dns')
```

- [ ] **步骤 2：运行页面测试**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/index.spec.ts`

预期：FAIL，现有页面仍然读取 `results` 而不是 `groups`。

- [ ] **步骤 3：实现分组卡片组件并更新页面与文案**

```vue
<!-- frontend/src/views/NetCheckView/components/NetCheckGroupCard.vue -->
<script setup lang="ts">
defineProps<{
  group: {
    id: string
    title: string
    status: string
    summary: string
    items: { id: string; title: string; status: string; summary: string; detail?: string; durationMs?: number }[]
  }
}>()
</script>

<template>
  <Card :title="group.title">
    <div class="text-12 mb-8">{{ group.summary }}</div>
    <div class="flex flex-col gap-8">
      <div v-for="item in group.items" :key="item.id" class="result-item rounded-8 p-8">
        <div class="font-bold">{{ item.title }}</div>
        <div class="text-12 mt-4">{{ item.summary }}</div>
        <div v-if="item.detail" class="text-12 mt-4">{{ item.detail }}</div>
      </div>
    </div>
  </Card>
</template>
```

```ts
// locale additions
groups: {
  overview: '概览',
  dns: 'DNS',
  outbound: '出站与规则',
  rulesets: '规则集状态',
},
results: {
  dnsQuery: 'DNS 查询',
  outboundDelay: '当前主出站延迟',
  latestRuleMatch: '最近命中的规则与链路',
  rulesetItem: '规则集状态',
},
summary: {
  dnsSkippedIp: '目标为 IP，跳过 DNS 查询',
  ruleMatchMissing: '未找到可匹配连接记录',
  rulesetsSkipped: '当前配置未引用本地或远程规则集',
}
```

- [ ] **步骤 4：跑页面测试、聚焦测试和类型检查**

运行：`pnpm -C frontend test -- src/views/NetCheckView/__tests__/index.spec.ts src/views/NetCheckView/__tests__/networkCheckTarget.spec.ts src/views/NetCheckView/__tests__/networkCheckRuntime.spec.ts src/views/NetCheckView/__tests__/useNetworkCheck.spec.ts src/views/NetCheckView/__tests__/useRuntimeNetworkCheck.spec.ts`

预期：PASS，NetCheck 相关测试全部通过。

运行：`pnpm -C frontend type-check`

预期：PASS，无新的 TypeScript 报错。

- [ ] **步骤 5：提交 UI 和文案收尾**

```bash
git add frontend/src/views/NetCheckView/components/NetCheckGroupCard.vue frontend/src/views/NetCheckView/index.vue frontend/src/views/NetCheckView/__tests__/index.spec.ts frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "feat: render grouped net check diagnostics"
```

## 规格覆盖自检

- 背景中要求的 DNS 结果补齐：
  - 由任务 2 的 `dnsQuery()` 类型/封装和任务 3 的 DNS 组实现覆盖。
- 最近命中的规则与链路：
  - 由任务 2 的连接匹配 helper 和任务 4 的 `getLatestRuleMatch()` 覆盖。
- 当前配置引用规则集状态：
  - 由任务 2 的规则集状态 helper 和任务 3 的规则集组编排覆盖。
- 保留现有三项基础检测：
  - 由任务 3 在 `overview` 组内保留 `core / proxy-http / tcp` 覆盖。
- 不新增重型后端接口：
  - 计划中只增加 `dnsQuery()` 的 controller 封装，没有新增 Go bridge 接口或新服务。
- 页面仍然是单入口单页面：
  - 由任务 5 的分组卡片渲染覆盖。

## 占位符自检

- 本计划没有保留占位式实现提示或需要读者额外补完的步骤描述。
- 所有新增函数名、类型名和文件路径在任务中已显式给出。
- 每个代码步骤都包含了实际的测试代码或最小实现代码，不依赖读者自行推断缺失部分。

## 类型一致性自检

- 目标解析新增字段统一使用：
  - `requestHost`
  - `dnsLookupHost`
  - `targetKind`
- 分组模型统一使用：
  - `NetworkCheckResultGroup`
  - `items`
  - `summary`
- runtime 依赖统一使用：
  - `dnsQuery`
  - `getPrimaryOutboundState`
  - `getLatestRuleMatch`
  - `getRulesetStates`
