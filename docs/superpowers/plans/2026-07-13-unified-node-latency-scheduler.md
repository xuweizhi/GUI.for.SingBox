# 统一节点测速调度实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让首页节点弹窗和完整控制器共用一个持续补位、首测优先、选择性补测且支持跨任务请求去重的节点测速调度器。

**架构：** 新增一个依赖注入 `getProxyDelay` 的纯 TypeScript 调度器，集中维护全局首测队列、补测队列、活动请求和任务订阅。两个 Vue 入口只负责过滤节点、提交任务、消费状态与结果，并在各自任务结束后刷新一次代理快照。

**技术栈：** TypeScript、Vue 3 Composition API、Vitest、Vue Test Utils、Pinia、Clash REST API。

---

## 文件结构

- 创建 `frontend/src/views/HomeView/nodeLatencyScheduler.ts`：定义测速任务、节点状态、结果和全局调度器；实现并发限制、首测优先、瞬时错误补测、活动请求去重和任务级取消。
- 创建 `frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`：使用可控 Promise 测试共享调度器，不依赖 Vue 或真实网络。
- 修改 `frontend/src/views/HomeView/nodeController.ts`：提供唯一的可补测错误分类判断，供调度器和入口共用。
- 修改 `frontend/src/views/HomeView/__tests__/nodeController.spec.ts`：覆盖可补测与不可补测分类。
- 修改 `frontend/src/views/HomeView/useNodeController.ts`：移除入口内循环重试和临时并发池，接入共享调度器并映射现有界面状态。
- 修改 `frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`：更新单节点、批量、刷新、去重和取消测试。
- 修改 `frontend/src/views/HomeView/components/GroupsController.vue`：移除直接延迟请求和独立并发池，接入共享调度器。
- 创建 `frontend/src/views/HomeView/components/__tests__/GroupsController.spec.ts`：覆盖完整控制器的共享调度器接入、进度、取消和尾部刷新。
- 修改 `frontend/src/views/HomeView/components/NodeSelectorModal.vue`：如现有结构无法表达排队和待补测状态，则只增加必要状态展示。
- 修改 `frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`：覆盖 `queued`、`testing`、`retry-queued` 和新尝试次数语义。
- 修改 `frontend/src/lang/locale/zh.ts`：增加排队中和待补测中文文案。
- 修改 `frontend/src/lang/locale/en.ts`：增加对应英文文案。

### 任务 1：固化选择性补测规则

**文件：**
- 修改：`frontend/src/views/HomeView/nodeController.ts:5-68`
- 测试：`frontend/src/views/HomeView/__tests__/nodeController.spec.ts`

- [ ] **步骤 1：编写失败的错误策略测试**

在 `nodeController.spec.ts` 的错误分类测试旁新增：

```ts
import { classifyDelayError, isRetryableDelayError } from '@/views/HomeView/nodeController'

it.each([
  ['timeout', true],
  ['connection-reset', true],
  ['network-unreachable', true],
  ['dns', false],
  ['authentication', false],
  ['tls', false],
  ['connection-refused', false],
  ['unknown', false],
] as const)('marks %s retryable=%s', (category, expected) => {
  expect(isRetryableDelayError(category)).toBe(expected)
})

it('classifies EOF as a retryable connection reset', () => {
  const category = classifyDelayError('unexpected EOF')
  expect(category).toBe('connection-reset')
  expect(isRetryableDelayError(category)).toBe(true)
})
```

- [ ] **步骤 2：运行测试并确认因函数不存在而失败**

运行：`npm test -- src/views/HomeView/__tests__/nodeController.spec.ts`

工作目录：`frontend`

预期：FAIL，TypeScript/Vitest 报告 `isRetryableDelayError` 未导出。

- [ ] **步骤 3：实现最小错误策略**

在 `nodeController.ts` 中增加：

```ts
const retryableDelayErrors = new Set<DelayErrorCategory>([
  'timeout',
  'connection-reset',
  'network-unreachable',
])

export const isRetryableDelayError = (category: DelayErrorCategory) =>
  retryableDelayErrors.has(category)
```

保持 `classifyDelayError` 的匹配顺序不变，继续把 `eof` 归为 `connection-reset`。

- [ ] **步骤 4：运行测试确认通过**

运行：`npm test -- src/views/HomeView/__tests__/nodeController.spec.ts`

预期：PASS，错误分类和补测规则全部通过。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/views/HomeView/nodeController.ts frontend/src/views/HomeView/__tests__/nodeController.spec.ts
git commit -m "feat(节点测速): 定义瞬时错误补测规则"
```

### 任务 2：实现共享测速调度器的基础队列

**文件：**
- 创建：`frontend/src/views/HomeView/nodeLatencyScheduler.ts`
- 创建：`frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

- [ ] **步骤 1：编写并发限制和持续补位的失败测试**

测试使用注入函数，不 mock `@/api/kernel`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { createNodeLatencyScheduler } from '@/views/HomeView/nodeLatencyScheduler'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

it('keeps the configured number of requests active and refills immediately', async () => {
  const requests = new Map<string, ReturnType<typeof deferred<{ delay: number }>>>()
  const probe = vi.fn((name: string) => {
    const request = deferred<{ delay: number }>()
    requests.set(name, request)
    return request.promise
  })
  const scheduler = createNodeLatencyScheduler(probe)

  const task = scheduler.submit({
    nodes: ['A', 'B', 'C'],
    url: 'https://probe.example',
    timeout: 5_000,
    concurrency: 2,
  })
  await Promise.resolve()
  expect(probe.mock.calls.map(([name]) => name)).toEqual(['A', 'B'])

  requests.get('A')!.resolve({ delay: 10 })
  await Promise.resolve()
  await Promise.resolve()
  expect(probe.mock.calls.map(([name]) => name)).toEqual(['A', 'B', 'C'])

  requests.get('B')!.resolve({ delay: 20 })
  requests.get('C')!.resolve({ delay: 30 })
  await expect(task.done).resolves.toMatchObject({ completed: 3, success: 3, failure: 0 })
})
```

- [ ] **步骤 2：运行测试确认模块不存在**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

工作目录：`frontend`

预期：FAIL，报告无法解析 `nodeLatencyScheduler`。

- [ ] **步骤 3：定义调度器公开类型和最小首测队列**

创建 `nodeLatencyScheduler.ts`，公开接口保持如下：

```ts
import { classifyDelayError, isRetryableDelayError } from './nodeController'
import type { DelayErrorCategory } from './nodeController'

export type LatencyNodePhase =
  | 'queued'
  | 'testing'
  | 'retry-queued'
  | 'success'
  | 'failed'
  | 'cancelled'

export interface LatencySuccessResult {
  ok: true
  name: string
  delay: number
  attempts: number
}

export interface LatencyFailureResult {
  ok: false
  name: string
  category: DelayErrorCategory
  message: string
  attempts: number
  maxAttempts: number
}

export type LatencyResult = LatencySuccessResult | LatencyFailureResult

export interface LatencyTaskSummary {
  total: number
  completed: number
  success: number
  failure: number
  retryQueued: number
  cancelled: boolean
}

export interface SubmitLatencyTaskOptions {
  nodes: string[]
  url: string
  timeout: number
  concurrency: number
  onState?: (name: string, phase: LatencyNodePhase) => void
  onResult?: (result: LatencyResult) => void
}

export interface LatencyTaskHandle {
  done: Promise<LatencyTaskSummary>
  cancel: () => void
}

type Probe = (name: string, url: string, timeout: number) => Promise<{ delay?: number }>

export const createNodeLatencyScheduler = (probe: Probe) => {
  const firstQueue: QueueItem[] = []
  const tasks = new Map<number, TaskState>()
  let activeCount = 0
  let nextTaskId = 1

  const drain = () => {
    const limit = Math.max(1, ...Array.from(tasks.values(), (task) => task.options.concurrency))
    while (activeCount < limit && firstQueue.length > 0) {
      const item = firstQueue.shift()!
      if (item.task.cancelled) continue
      activeCount += 1
      void runItem(item).finally(() => {
        activeCount -= 1
        drain()
      })
    }
  }

  return {
    submit(options: SubmitLatencyTaskOptions): LatencyTaskHandle {
      const task = createTaskState(nextTaskId++, options)
      tasks.set(task.id, task)
      new Set(options.nodes).forEach((name) => {
        firstQueue.push({ task, name, attempt: 1 })
        options.onState?.(name, 'queued')
      })
      drain()
      return { done: task.done, cancel: () => cancelTask(task) }
    },
  }
}
```

同时定义代码片段引用的模块私有 `QueueItem`、`TaskState`、`createTaskState`、`runItem` 和 `cancelTask`。本任务中的 `runItem` 只处理首测成功和最终失败；任务 3 再加入补测分支。`drain()` 每次在 `activeCount < limit` 时启动下一个首测项，请求 `finally` 中减少活动计数并再次调用 `drain()`。正延迟才算成功，`delay <= 0` 按 `home.nodes.unavailable` 失败处理。

- [ ] **步骤 4：运行基础调度测试确认通过**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

预期：PASS，首批只启动 2 个请求，A 完成后 C 立即启动。

- [ ] **步骤 5：增加 100 节点、20 并发的失败测试**

```ts
it('never exceeds twenty active probes for one hundred nodes', async () => {
  let active = 0
  let peak = 0
  const releases: (() => void)[] = []
  const probe = vi.fn(
    () =>
      new Promise<{ delay: number }>((resolve) => {
        active += 1
        peak = Math.max(peak, active)
        releases.push(() => {
          active -= 1
          resolve({ delay: 10 })
        })
      }),
  )
  const scheduler = createNodeLatencyScheduler(probe)
  const task = scheduler.submit({
    nodes: Array.from({ length: 100 }, (_, index) => `node-${index}`),
    url: 'https://probe.example',
    timeout: 5_000,
    concurrency: 20,
  })

  while (releases.length || probe.mock.calls.length < 100) {
    const release = releases.shift()
    if (release) release()
    await Promise.resolve()
    await Promise.resolve()
  }
  await task.done
  expect(peak).toBe(20)
  expect(probe).toHaveBeenCalledTimes(100)
})
```

- [ ] **步骤 6：运行测试并修正调度循环直至通过**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

预期：PASS，峰值并发恰为 20，总请求数为 100。

- [ ] **步骤 7：Commit**

```bash
git add frontend/src/views/HomeView/nodeLatencyScheduler.ts frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts
git commit -m "feat(节点测速): 添加共享并发调度器"
```

### 任务 3：增加首测优先和选择性补测

**文件：**
- 修改：`frontend/src/views/HomeView/nodeLatencyScheduler.ts`
- 测试：`frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

- [ ] **步骤 1：编写首测优先的失败测试**

```ts
it('runs every first attempt before a queued retry', async () => {
  const calls: string[] = []
  const firstA = deferred<{ delay: number }>()
  const firstB = deferred<{ delay: number }>()
  const retryA = deferred<{ delay: number }>()
  const probe = vi.fn((name: string) => {
    calls.push(name)
    if (name === 'A' && calls.filter((value) => value === 'A').length === 1) return firstA.promise
    if (name === 'A') return retryA.promise
    return firstB.promise
  })
  const scheduler = createNodeLatencyScheduler(probe)
  const task = scheduler.submit({
    nodes: ['A', 'B'],
    url: 'https://probe.example',
    timeout: 5_000,
    concurrency: 1,
  })

  firstA.reject(new Error('timeout'))
  await Promise.resolve()
  await Promise.resolve()
  expect(calls).toEqual(['A', 'B'])

  firstB.resolve({ delay: 20 })
  await Promise.resolve()
  await Promise.resolve()
  expect(calls).toEqual(['A', 'B', 'A'])
  retryA.resolve({ delay: 30 })
  await expect(task.done).resolves.toMatchObject({ success: 2, failure: 0 })
})
```

- [ ] **步骤 2：编写错误选择和状态转换的失败测试**

```ts
it.each([
  ['timeout', 2],
  ['reset by peer', 2],
  ['unexpected EOF', 2],
  ['network is unreachable', 2],
  ['no such host', 1],
  ['unauthorized', 1],
  ['TLS handshake failed', 1],
  ['connection refused', 1],
  ['generic delay failure', 1],
])('uses the expected attempt count for %s', async (message, expectedCalls) => {
  const states: string[] = []
  const probe = vi.fn().mockRejectedValue(new Error(message))
  const scheduler = createNodeLatencyScheduler(probe)
  const task = scheduler.submit({
    nodes: ['A'],
    url: 'https://probe.example',
    timeout: 5_000,
    concurrency: 1,
    onState: (_name, state) => states.push(state),
  })
  const summary = await task.done

  expect(probe).toHaveBeenCalledTimes(expectedCalls)
  expect(summary).toMatchObject({ completed: 1, success: 0, failure: 1 })
  if (expectedCalls === 2) expect(states).toContain('retry-queued')
})
```

- [ ] **步骤 3：运行测试确认补测行为尚未实现**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

预期：FAIL，瞬时错误只有 1 次调用，或 A 的补测在 B 首测前启动。

- [ ] **步骤 4：实现低优先级补测队列**

在调度器中增加 `retryQueue`。请求失败后：

```ts
const message = normalizeErrorMessage(error)
const category = classifyDelayError(message)
if (item.attempt === 1 && isRetryableDelayError(category) && !task.cancelled) {
  task.retryQueued += 1
  task.options.onState?.(item.name, 'retry-queued')
  retryQueue.push({ ...item, attempt: 2 })
} else {
  finishNode(task, {
    ok: false,
    name: item.name,
    category,
    message,
    attempts: item.attempt,
    maxAttempts: item.attempt,
  })
}
```

`drain()` 只在 `firstQueue` 没有可运行项时读取 `retryQueue`。补测启动时减少 `retryQueued`。把 `normalizeErrorMessage` 从 `@/utils/others` 引入，禁止在调度器内复制错误字符串转换逻辑。

- [ ] **步骤 5：运行调度器测试确认通过**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

预期：PASS，首测顺序为 A、B，随后才补测 A；只有 3 类瞬时错误执行 2 次。

- [ ] **步骤 6：Commit**

```bash
git add frontend/src/views/HomeView/nodeLatencyScheduler.ts frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts
git commit -m "feat(节点测速): 优先首测并选择性补测"
```

### 任务 4：实现跨任务去重和任务级取消

**文件：**
- 修改：`frontend/src/views/HomeView/nodeLatencyScheduler.ts`
- 测试：`frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

- [ ] **步骤 1：编写相同参数共享活动请求的失败测试**

```ts
it('shares one active request between tasks with the same probe key', async () => {
  const request = deferred<{ delay: number }>()
  const probe = vi.fn(() => request.promise)
  const scheduler = createNodeLatencyScheduler(probe)
  const options = {
    nodes: ['A'],
    url: 'https://probe.example',
    timeout: 5_000,
    concurrency: 20,
  }
  const first = scheduler.submit(options)
  const second = scheduler.submit(options)
  await Promise.resolve()
  expect(probe).toHaveBeenCalledTimes(1)

  request.resolve({ delay: 12 })
  await expect(Promise.all([first.done, second.done])).resolves.toEqual([
    expect.objectContaining({ success: 1 }),
    expect.objectContaining({ success: 1 }),
  ])
})

it('does not share requests with different URLs or timeouts', async () => {
  const probe = vi.fn().mockResolvedValue({ delay: 12 })
  const scheduler = createNodeLatencyScheduler(probe)
  await Promise.all([
    scheduler.submit({ nodes: ['A'], url: 'https://one.example', timeout: 5_000, concurrency: 20 }).done,
    scheduler.submit({ nodes: ['A'], url: 'https://two.example', timeout: 5_000, concurrency: 20 }).done,
    scheduler.submit({ nodes: ['A'], url: 'https://one.example', timeout: 3_000, concurrency: 20 }).done,
  ])
  expect(probe).toHaveBeenCalledTimes(3)
})
```

- [ ] **步骤 2：编写取消订阅不影响其他任务的失败测试**

```ts
it('cancels one subscriber without cancelling the shared request', async () => {
  const request = deferred<{ delay: number }>()
  const firstResult = vi.fn()
  const secondResult = vi.fn()
  const scheduler = createNodeLatencyScheduler(vi.fn(() => request.promise))
  const base = { nodes: ['A'], url: 'https://probe.example', timeout: 5_000, concurrency: 20 }
  const first = scheduler.submit({ ...base, onResult: firstResult })
  const second = scheduler.submit({ ...base, onResult: secondResult })
  first.cancel()
  request.resolve({ delay: 12 })

  await expect(first.done).resolves.toMatchObject({ cancelled: true, success: 0, failure: 0 })
  await expect(second.done).resolves.toMatchObject({ cancelled: false, success: 1 })
  expect(firstResult).not.toHaveBeenCalled()
  expect(secondResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true, name: 'A' }))
})
```

- [ ] **步骤 3：运行测试确认去重和订阅隔离尚未实现**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

预期：FAIL，相同节点发出 2 次请求，或取消第一个任务污染第二个任务。

- [ ] **步骤 4：实现活动请求订阅表**

使用 `${encodeURIComponent(name)}\u0000${url}\u0000${timeout}` 作为请求键，维护：

```ts
interface ActiveProbe {
  subscribers: Set<QueueItem>
  promise: Promise<{ delay?: number }>
}

const activeProbes = new Map<string, ActiveProbe>()
```

启动队列项时，若键已存在，则只加入 `subscribers`，不增加底层活动请求数。底层请求完成后，为仍未取消的订阅项分别执行成功、补测或最终失败流程，并在 `finally` 删除 Map 条目。任务 `cancel()` 标记任务取消、移除排队项订阅并把未完成节点转换为 `cancelled`，但不操作其他任务。

- [ ] **步骤 5：增加取消排队节点的测试并确认通过**

```ts
it('does not start queued nodes after task cancellation', async () => {
  const request = deferred<{ delay: number }>()
  const probe = vi.fn(() => request.promise)
  const scheduler = createNodeLatencyScheduler(probe)
  const task = scheduler.submit({
    nodes: ['A', 'B'],
    url: 'https://probe.example',
    timeout: 5_000,
    concurrency: 1,
  })
  await Promise.resolve()
  task.cancel()
  request.resolve({ delay: 12 })
  await task.done
  expect(probe.mock.calls.map(([name]) => name)).toEqual(['A'])
})
```

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts`

预期：PASS，去重键、订阅隔离和取消排队行为全部通过。

- [ ] **步骤 6：导出应用单例**

在文件底部增加：

```ts
import { getProxyDelay } from '@/api/kernel'

export const nodeLatencyScheduler = createNodeLatencyScheduler((name, url, timeout) =>
  getProxyDelay(encodeURIComponent(name), url, timeout),
)
```

工厂测试继续注入未编码的节点名；只有应用单例负责 API 所需的 `encodeURIComponent`，避免入口重复编码。

- [ ] **步骤 7：运行类型检查和调度器测试**

运行：`npm test -- src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts && npm run type-check`

预期：测试 PASS，`vue-tsc` 退出码为 0。

- [ ] **步骤 8：Commit**

```bash
git add frontend/src/views/HomeView/nodeLatencyScheduler.ts frontend/src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts
git commit -m "feat(节点测速): 共享请求并隔离任务取消"
```

### 任务 5：迁移首页节点控制器

**文件：**
- 修改：`frontend/src/views/HomeView/useNodeController.ts:1-374`
- 修改：`frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`

- [ ] **步骤 1：把测试 mock 边界从 API 改为共享调度器**

在测试文件使用 hoisted mock：

```ts
const schedulerMock = vi.hoisted(() => ({ submit: vi.fn() }))

vi.mock('@/views/HomeView/nodeLatencyScheduler', () => ({
  nodeLatencyScheduler: schedulerMock,
}))
```

增加一个测试辅助函数，按节点依次调用 `onState` 和 `onResult`，并返回可取消句柄：

```ts
const completeTask = (
  options: SubmitLatencyTaskOptions,
  results: LatencyResult[],
): LatencyTaskHandle => {
  results.forEach((result) => {
    options.onState?.(result.name, result.ok ? 'success' : 'failed')
    options.onResult?.(result)
  })
  return {
    cancel: vi.fn(),
    done: Promise.resolve({
      total: results.length,
      completed: results.length,
      success: results.filter((result) => result.ok).length,
      failure: results.filter((result) => !result.ok).length,
      retryQueued: 0,
      cancelled: false,
    }),
  }
}
```

- [ ] **步骤 2：编写首页批量提交和统一结果映射的失败测试**

```ts
it('submits one shared task and maps success and final failure', async () => {
  schedulerMock.submit.mockImplementation((options: SubmitLatencyTaskOptions) =>
    completeTask(options, [
      { ok: true, name: 'HK 01', delay: 35, attempts: 2 },
      {
        ok: false,
        name: 'JP 01',
        category: 'timeout',
        message: 'timeout',
        attempts: 2,
        maxAttempts: 2,
      },
    ]),
  )
  const scope = effectScope()
  const controller = scope.run(() => useNodeController())!
  await controller.prepareModal()
  await controller.testGroup()

  expect(schedulerMock.submit).toHaveBeenCalledWith(
    expect.objectContaining({ nodes: ['HK 01', 'JP 01'], concurrency: 20 }),
  )
  expect(controller.nodeAttempts.value.get('HK 01')).toBe(2)
  expect(controller.nodeErrors.value.get('JP 01')).toMatchObject({ attempts: 2, maxAttempts: 2 })
  expect(controller.batch.value).toMatchObject({ completed: 2, success: 1, failure: 1 })
  scope.stop()
})
```

- [ ] **步骤 3：运行首页控制器测试确认仍直接调用旧逻辑**

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

工作目录：`frontend`

预期：FAIL，`schedulerMock.submit` 未调用。

- [ ] **步骤 4：用共享任务替换 `runNodeTest` 和 `createAsyncPool`**

在 `useNodeController.ts`：

- 删除 `getProxyDelay`、`createAsyncPool`、`MAX_DELAY_ATTEMPTS` 和 `DELAY_RETRY_INTERVAL` 的使用。
- 保留节点过滤、`protectedLocalResults`、刷新和切换节点逻辑。
- 新增 `nodePhases = ref(new Map<string, LatencyNodePhase>())`。
- 用一个 `applyResult(result: LatencyResult)` 更新 `proxy.history`、`localDelays`、`nodeAttempts` 和 `nodeErrors`。
- `testNode` 和 `testGroup` 都调用 `nodeLatencyScheduler.submit`。
- `onState` 更新 `nodePhases` 和 `testingNodes`；终态移除加载状态。
- `onResult` 调用 `applyResult` 并保护本地结果。
- `testGroup` 根据任务摘要更新批量统计，不再由每个池任务自行加计数。
- 保存当前批量任务句柄，`cancelGroupTest()` 调用句柄的 `cancel()`。
- 任务 `done` 结束后只调用 1 次 `refresh()`。

`testNode` 返回值继续维持 `NodeOperationResult`。最终失败使用调度结果的原始 `message`；取消返回 `common.canceled`。

- [ ] **步骤 5：更新既有重试断言**

将原先“所有单节点失败调用 3 次”和“批量失败只调用 1 次”的测试改为：

- 瞬时失败由调度器返回 `attempts: 2, maxAttempts: 2`。
- 确定性失败返回 `attempts: 1, maxAttempts: 1`。
- 首页控制器只验证提交参数、状态映射和刷新，不重复测试底层请求次数。

- [ ] **步骤 6：增加取消句柄和单次刷新测试**

```ts
it('cancels the active shared task and refreshes once after it settles', async () => {
  const done = deferred<LatencyTaskSummary>()
  const cancel = vi.fn()
  schedulerMock.submit.mockReturnValue({ done: done.promise, cancel })
  const scope = effectScope()
  const controller = scope.run(() => useNodeController())!
  await controller.prepareModal()
  mocks.refreshProviderProxies.mockClear()

  const testing = controller.testGroup()
  controller.cancelGroupTest()
  expect(cancel).toHaveBeenCalledOnce()
  done.resolve({ total: 2, completed: 0, success: 0, failure: 0, retryQueued: 0, cancelled: true })
  await testing
  expect(mocks.refreshProviderProxies).toHaveBeenCalledOnce()
  scope.stop()
})
```

- [ ] **步骤 7：运行首页控制器和节点组件测试**

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：PASS，首页入口不再直接测试 API 重试次数，现有筛选、排序和切换行为无回归。

- [ ] **步骤 8：Commit**

```bash
git add frontend/src/views/HomeView/useNodeController.ts frontend/src/views/HomeView/__tests__/useNodeController.spec.ts
git commit -m "refactor(节点测速): 首页接入共享调度器"
```

### 任务 6：展示排队和待补测状态

**文件：**
- 修改：`frontend/src/views/HomeView/components/NodeSelectorModal.vue`
- 修改：`frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`
- 修改：`frontend/src/lang/locale/zh.ts`
- 修改：`frontend/src/lang/locale/en.ts`
- 修改：`frontend/src/views/HomeView/useNodeController.ts`

- [ ] **步骤 1：编写节点阶段展示的失败测试**

扩展 `createController()` 返回的 mock，增加：

```ts
const nodePhases = ref(new Map([
  ['JP 01', 'queued' as const],
  ['US Timeout', 'retry-queued' as const],
]))
```

新增断言：

```ts
it('shows queued and retry-queued latency states', () => {
  const wrapper = mountModal()
  expect(wrapper.text()).toContain('home.nodes.queued')
  expect(wrapper.text()).toContain('home.nodes.retryQueued')
})
```

- [ ] **步骤 2：运行组件测试确认文案尚未展示**

运行：`npm test -- src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

工作目录：`frontend`

预期：FAIL，组件文本不包含新状态 key。

- [ ] **步骤 3：增加最小状态文案和组件分支**

语言包增加：

```ts
queued: '排队中',
retryQueued: '待补测',
```

```ts
queued: 'Queued',
retryQueued: 'Waiting to retry',
```

在节点延迟展示处，优先根据 `controller.nodePhases.value.get(node.name)` 显示 `queued` 或 `retry-queued`；`testing` 继续使用现有 loading 表现；终态继续使用延迟或错误分类。不要新增弹窗或复杂进度面板。

- [ ] **步骤 4：运行组件与语言相关测试**

运行：`npm test -- src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：PASS，排队和待补测状态可见，成功及失败格式保持不变。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/views/HomeView/components/NodeSelectorModal.vue frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts frontend/src/views/HomeView/useNodeController.ts frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "feat(节点测速): 展示排队和待补测状态"
```

### 任务 7：迁移完整控制器

**文件：**
- 修改：`frontend/src/views/HomeView/components/GroupsController.vue:1-225`
- 创建：`frontend/src/views/HomeView/components/__tests__/GroupsController.spec.ts`

- [ ] **步骤 1：创建完整控制器测试脚手架**

使用 Vue Test Utils 挂载 `GroupsController.vue`，mock Store、`vue-i18n`、`message`、`sleep` 和共享调度器。Store 至少提供：

```ts
const proxies = {
  Proxy: { name: 'Proxy', type: 'Selector', all: ['HK 01', 'JP 01'], now: 'HK 01' },
  'HK 01': { name: 'HK 01', type: 'VLESS', history: [], udp: true },
  'JP 01': { name: 'JP 01', type: 'Trojan', history: [], udp: true },
}
```

为无关全局组件使用 `global.stubs`，只保留策略组测速按钮可触发。

- [ ] **步骤 2：编写策略组通过共享调度器提交的失败测试**

```ts
it('submits group nodes through the shared scheduler', async () => {
  schedulerMock.submit.mockImplementation((options: SubmitLatencyTaskOptions) =>
    completeTask(options, [
      { ok: true, name: 'HK 01', delay: 25, attempts: 1 },
      {
        ok: false,
        name: 'JP 01',
        category: 'connection-refused',
        message: 'connection refused',
        attempts: 1,
        maxAttempts: 1,
      },
    ]),
  )
  const wrapper = mountGroupsController()
  await wrapper.get('[data-test="group-delay-Proxy"]').trigger('click')
  await flushPromises()

  expect(schedulerMock.submit).toHaveBeenCalledWith(
    expect.objectContaining({ nodes: ['HK 01', 'JP 01'], concurrency: 20 }),
  )
  expect(kernelStore.refreshProviderProxies).toHaveBeenCalledOnce()
})
```

为测速按钮增加稳定的 `data-test="group-delay-${group.name}"` 属性，避免测试依赖图标或翻译文本。

- [ ] **步骤 3：运行测试确认完整控制器仍直接调用 API**

运行：`npm test -- src/views/HomeView/components/__tests__/GroupsController.spec.ts`

工作目录：`frontend`

预期：FAIL，调度器未被调用或找不到稳定测试选择器。

- [ ] **步骤 4：迁移 `handleGroupDelay`**

在 `GroupsController.vue`：

- 删除 `getProxyDelay` 和 `createAsyncPool` import。
- 复用 `getDelayTestableNodeNames` 生成节点列表。
- 调用 `nodeLatencyScheduler.submit`，传入现有 URL、超时和并发设置。
- `onState` 维护 `loadingSet`，排队、测速和待补测均视为加载中，终态移除。
- `onResult` 对成功写入 `{ delay }`，失败写入 `{ delay: 0 }`；两类入口必须使用与首页相同的 `LatencyResult`，不得重新分类错误。
- `done` 摘要驱动完成消息中的成功、失败和完成数。
- 关闭消息时调用任务句柄 `cancel()`。
- `done` 结束后调用 `refreshProviderProxies()` 1 次，删除固定 `sleep(3000)` 对任务完成的阻塞；消息自动销毁可以保留独立计时，但不得阻塞测速 Promise。

- [ ] **步骤 5：迁移 `handleProxyDelay`**

单节点按钮也调用同一调度器：

```ts
const task = nodeLatencyScheduler.submit({
  nodes: [proxy],
  url: appSettings.app.kernel.testUrl || DefaultTestURL,
  timeout: appSettings.app.kernel.testTimeout || DefaultTestTimeout,
  concurrency: appSettings.app.kernel.concurrencyLimit || DefaultConcurrencyLimit,
  onState: updateLoadingState,
  onResult: applyLatencyResult,
})
await task.done
await kernelApiStore.refreshProviderProxies()
```

失败时继续显示原始错误和节点名，但错误内容直接来自 `LatencyFailureResult.message`。

- [ ] **步骤 6：增加取消和尾部刷新测试**

验证：

- 进度消息的关闭回调调用当前任务 `cancel()`。
- 任务取消后不人工写入失败历史。
- 正常任务无论节点数量多少只调用 1 次 `refreshProviderProxies()`。
- `getProxyDelay` 不再由该组件 import 或 mock。

- [ ] **步骤 7：运行完整控制器和首页相关测试**

运行：`npm test -- src/views/HomeView/components/__tests__/GroupsController.spec.ts src/views/HomeView/__tests__/useNodeController.spec.ts src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：PASS，两个入口都只通过共享调度器测速。

- [ ] **步骤 8：Commit**

```bash
git add frontend/src/views/HomeView/components/GroupsController.vue frontend/src/views/HomeView/components/__tests__/GroupsController.spec.ts
git commit -m "refactor(节点测速): 完整控制器接入共享调度器"
```

### 任务 8：回归、格式化和手工性能验收

**文件：**
- 修改：仅限格式化命令实际调整的本任务文件
- 验证：`frontend/src/views/HomeView/**`

- [ ] **步骤 1：运行针对性测试**

运行：

```bash
npm test -- \
  src/views/HomeView/__tests__/nodeController.spec.ts \
  src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts \
  src/views/HomeView/__tests__/useNodeController.spec.ts \
  src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts \
  src/views/HomeView/components/__tests__/GroupsController.spec.ts
```

工作目录：`frontend`

预期：全部 PASS，无未处理 Promise rejection。

- [ ] **步骤 2：运行前端完整测试和类型检查**

运行：`npm test && npm run type-check`

工作目录：`frontend`

预期：完整 Vitest 套件 PASS，`vue-tsc` 退出码为 0。

- [ ] **步骤 3：只格式化本次涉及的源文件**

运行：

```bash
npx oxfmt \
  src/views/HomeView/nodeController.ts \
  src/views/HomeView/nodeLatencyScheduler.ts \
  src/views/HomeView/useNodeController.ts \
  src/views/HomeView/components/NodeSelectorModal.vue \
  src/views/HomeView/components/GroupsController.vue \
  src/views/HomeView/__tests__/nodeController.spec.ts \
  src/views/HomeView/__tests__/nodeLatencyScheduler.spec.ts \
  src/views/HomeView/__tests__/useNodeController.spec.ts \
  src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts \
  src/views/HomeView/components/__tests__/GroupsController.spec.ts \
  src/lang/locale/zh.ts \
  src/lang/locale/en.ts
```

工作目录：`frontend`

预期：命令退出码为 0，不格式化无关文件。

- [ ] **步骤 4：格式化后重新运行完整验证**

运行：`npm test && npm run type-check && npm run build-only`

工作目录：`frontend`

预期：测试 PASS、类型检查通过、Vite 构建成功。

- [ ] **步骤 5：执行真实网络手工验收**

在应用运行且有约 100 个有效节点时，分别从首页节点弹窗和完整控制器发起测速，记录：

```text
入口：
节点数量：
并发设置：20
测速 URL：
首轮完成时间：
总完成时间：
首次成功数：
补测成功数：
最终失败数：
```

验收重点：首轮以 10 秒内、总体以约 15 秒内为目标；这是环境相关目标，不因超出目标而修改为强制墙钟取消。

- [ ] **步骤 6：检查变更范围**

运行：`git status --short && git diff --check && git diff --stat`

预期：无空白错误；只包含统一测速调度、两个入口、文案、测试和已批准文档相关文件。不得回退或改写工作区中其他人的无关变更。

- [ ] **步骤 7：Commit**

```bash
git add frontend/src/views/HomeView frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "test(节点测速): 完成统一调度回归验证"
```

仅在前序任务提交后仍有本次功能相关的格式化或测试调整时创建该 commit；没有剩余变更时跳过，禁止创建空 commit。
