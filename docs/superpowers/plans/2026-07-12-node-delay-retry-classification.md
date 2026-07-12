# 节点测速连续重试与错误分类实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为单节点和批量测速增加最多 3 次连续尝试，并在节点卡片中显示本地化错误分类、尝试次数和原始错误提示。

**架构：** 在纯 TypeScript 节点模型中定义错误分类及展示状态，在 `useNodeController` 中集中执行重试和取消检查，单节点与批量入口复用该流程。Vue 组件只消费结构化状态并负责本地化展示，不解析原始错误。

**技术栈：** Vue 3、TypeScript、Pinia、Vue I18n、Vitest、Vue Test Utils

---

## 文件结构

- 修改 `frontend/src/views/HomeView/nodeController.ts`：定义测速错误类型、分类器和节点展示字段。
- 修改 `frontend/src/views/HomeView/__tests__/nodeController.spec.ts`：覆盖纯错误分类及节点状态映射。
- 修改 `frontend/src/views/HomeView/useNodeController.ts`：实现最多 3 次重试、间隔等待、取消检查和结构化结果保存。
- 修改 `frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`：覆盖重试、成功短路、失败分类、批量统计和取消语义。
- 修改 `frontend/src/views/HomeView/components/NodeSelectorModal.vue`：显示分类、尝试次数及原始错误提示。
- 修改 `frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`：覆盖成功与失败状态的渲染。
- 修改 `frontend/src/lang/locale/zh.ts`：增加中文错误分类文案。
- 修改 `frontend/src/lang/locale/en.ts`：增加英文错误分类文案。

### 任务 1：错误分类和节点展示模型

**文件：**
- 修改：`frontend/src/views/HomeView/nodeController.ts:3-29,186-221`
- 测试：`frontend/src/views/HomeView/__tests__/nodeController.spec.ts`

- [ ] **步骤 1：编写错误分类失败测试**

在 `nodeController.spec.ts` 导入 `classifyDelayError`，增加表驱动测试：

```ts
it.each([
  ['lookup example.com: no such host', 'dns'],
  ['authentication failed', 'authentication'],
  ['TLS certificate verify failed', 'tls'],
  ['dial tcp: connection refused', 'connection-refused'],
  ['network is unreachable', 'network-unreachable'],
  ['connection reset by peer', 'connection-reset'],
  ['context deadline exceeded', 'timeout'],
  ['An error occurred in the delay test', 'unknown'],
] as const)('classifies delay error %s as %s', (error, category) => {
  expect(classifyDelayError(error)).toBe(category)
})
```

- [ ] **步骤 2：运行测试验证正确失败**

运行：`npm test -- src/views/HomeView/__tests__/nodeController.spec.ts`

工作目录：`frontend`

预期：FAIL，提示 `classifyDelayError` 未导出。

- [ ] **步骤 3：实现最少错误分类类型和函数**

在 `nodeController.ts` 增加：

```ts
export type DelayErrorCategory =
  | 'dns'
  | 'authentication'
  | 'tls'
  | 'connection-refused'
  | 'network-unreachable'
  | 'connection-reset'
  | 'timeout'
  | 'unknown'

export interface NodeDelayError {
  category: DelayErrorCategory
  message: string
  attempts: number
}

export const classifyDelayError = (error: string): DelayErrorCategory => {
  const message = error.toLocaleLowerCase()
  if (/lookup|no such host|nxdomain/.test(message)) return 'dns'
  if (/authentication|unauthorized/.test(message)) return 'authentication'
  if (/certificate|tls|reality/.test(message)) return 'tls'
  if (message.includes('connection refused')) return 'connection-refused'
  if (/network is unreachable|no route/.test(message)) return 'network-unreachable'
  if (/reset by peer|eof/.test(message)) return 'connection-reset'
  if (/timeout|deadline exceeded/.test(message)) return 'timeout'
  return 'unknown'
}
```

将 `NodeListItem.error` 改为 `NodeDelayError`，增加 `attempts?: number`；将 `filterAndSortNodes` 的 errors 参数改为 `Map<string, NodeDelayError>`，并把成功尝试次数从独立 Map 映射到列表项。

- [ ] **步骤 4：更新节点映射测试并验证通过**

为 `filterAndSortNodes` 增加断言，确认失败项保留结构化错误，成功项能携带 `attempts: 2`。运行：

`npm test -- src/views/HomeView/__tests__/nodeController.spec.ts`

预期：该文件全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/views/HomeView/nodeController.ts frontend/src/views/HomeView/__tests__/nodeController.spec.ts
git commit -m "feat: classify node delay failures"
```

### 任务 2：控制器连续重试

**文件：**
- 修改：`frontend/src/views/HomeView/useNodeController.ts:1-324`
- 测试：`frontend/src/views/HomeView/__tests__/useNodeController.spec.ts:254-438`

- [ ] **步骤 1：编写成功短路和失败后成功的失败测试**

增加两项测试：

```ts
it('does not retry when the first delay test succeeds', async () => {
  mocks.getProxyDelay.mockResolvedValue({ delay: 65 })
  const scope = effectScope()
  const controller = scope.run(() => useNodeController())!
  await controller.prepareModal()

  expect(await controller.testNode('JP 01')).toEqual({ ok: true })
  expect(mocks.getProxyDelay).toHaveBeenCalledTimes(1)
  expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
    delay: 65,
    attempts: 1,
  })
  scope.stop()
})

it('retries a failed delay test and stops after success', async () => {
  mocks.getProxyDelay
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ delay: 72 })
  const scope = effectScope()
  const controller = scope.run(() => useNodeController())!
  await controller.prepareModal()

  const result = controller.testNode('JP 01')
  await vi.advanceTimersByTimeAsync(300)
  expect(await result).toEqual({ ok: true })
  expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)
  expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
    delay: 72,
    attempts: 2,
  })
  scope.stop()
})
```

- [ ] **步骤 2：运行测试验证正确失败**

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

预期：FAIL，第二项仅调用 1 次，且列表项没有 `attempts`。

- [ ] **步骤 3：实现最多 3 次的统一探测循环**

在控制器内定义常量：

```ts
const MAX_DELAY_ATTEMPTS = 3
const DELAY_RETRY_INTERVAL = 300
```

新增 `nodeAttempts`，并把 `nodeErrors` 改为结构化 Map：

```ts
const nodeErrors = ref(new Map<string, NodeDelayError>())
const nodeAttempts = ref(new Map<string, number>())
```

在 `runNodeTest` 中用 `for` 循环调用 `getProxyDelay`。正延迟立即写入 `localDelays` 和尝试次数后返回；异常通过 `normalizeErrorMessage` 保存为最后错误；`delay <= 0` 统一使用 `home.nodes.unavailable`。失败且仍可重试时执行 `await sleep(DELAY_RETRY_INTERVAL)`。三次失败后写入：

```ts
nodeErrors.value.set(name, {
  category: classifyDelayError(lastError),
  message: lastError,
  attempts: MAX_DELAY_ATTEMPTS,
})
```

将 `nodeAttempts` 传给 `filterAndSortNodes`。刷新获得正延迟时，同时清除本地错误、延迟和尝试次数。

- [ ] **步骤 4：运行控制器测试验证通过**

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

预期：新增测试 PASS；更新旧的单次失败断言以等待 `600 ms` 并断言 3 次调用及结构化错误。

- [ ] **步骤 5：编写三次失败分类和零延迟重试测试**

```ts
it('classifies a node after three failed attempts', async () => {
  mocks.getProxyDelay.mockRejectedValue(new Error('connection refused'))
  // 创建控制器并启动测试
  // 推进两个 300 ms 定时器
  expect(controller.nodeErrors.value.get('JP 01')).toEqual({
    category: 'connection-refused',
    message: 'connection refused',
    attempts: 3,
  })
})

it('retries zero delay responses before marking the node unavailable', async () => {
  mocks.getProxyDelay.mockResolvedValue({ delay: 0 })
  // 推进两个 300 ms 定时器
  expect(mocks.getProxyDelay).toHaveBeenCalledTimes(3)
  expect(controller.nodeErrors.value.get('JP 01')).toMatchObject({
    category: 'unknown',
    attempts: 3,
  })
})
```

- [ ] **步骤 6：运行测试验证通过**

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

预期：全部 PASS。

- [ ] **步骤 7：编写批量取消停止重试的失败测试**

令首个活动请求立即失败，调用 `cancelGroupTest()`，推进 `300 ms`，断言该节点只调用 1 次，排队节点没有调用，且 `batch.cancelled` 为 `true`。

- [ ] **步骤 8：实现取消检查并验证批量统计**

增加仅在批量运行期间使用的取消判断。失败后若 `batch.value.cancelled`，跳出尝试循环并返回取消结果；批量 worker 对取消结果不增加失败数。运行：

`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

预期：取消、重试及原有批量统计测试全部 PASS。

- [ ] **步骤 9：Commit**

```bash
git add frontend/src/views/HomeView/useNodeController.ts frontend/src/views/HomeView/__tests__/useNodeController.spec.ts
git commit -m "feat: retry node delay tests"
```

### 任务 3：节点卡片错误分类展示

**文件：**
- 修改：`frontend/src/views/HomeView/components/NodeSelectorModal.vue:158-176`
- 测试：`frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts:22-198`
- 修改：`frontend/src/lang/locale/zh.ts:434-457`
- 修改：`frontend/src/lang/locale/en.ts:436-460`

- [ ] **步骤 1：扩展组件 fixture 并编写失败渲染测试**

将成功节点增加 `attempts: 2`，失败节点增加：

```ts
error: {
  category: 'timeout',
  message: 'context deadline exceeded',
  attempts: 3,
}
```

增加断言：

```ts
expect(wrapper.get('[data-delay="HK 01"] .delay-success').text()).toBe('80 ms · 2')
expect(wrapper.get('[data-delay="US Timeout"] .delay-failed').text()).toContain(
  'home.nodes.delayError.timeout',
)
expect(wrapper.get('[data-delay="US Timeout"]').attributes('data-tips')).toBe(
  'context deadline exceeded',
)
```

在测试挂载配置中将 `v-tips` stub 为设置 `data-tips` 的 directive。

- [ ] **步骤 2：运行组件测试验证正确失败**

运行：`npm test -- src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：FAIL，仍显示 `home.nodes.unavailable`，没有次数和提示属性。

- [ ] **步骤 3：实现本地化展示和提示**

在成功状态中，当 `attempts > 1` 时追加 `· {{ attempts }}` 和本地化单位。在失败按钮上绑定 `v-tips.fast="node.error?.message"`，显示：

```vue
{{ t(`home.nodes.delayError.${node.error?.category || 'unknown'}`) }} ·
{{ node.error?.attempts || 1 }}/3
```

中文语言包新增：

```ts
attempts: '次',
delayError: {
  dns: 'DNS 失败',
  authentication: '认证失败',
  tls: 'TLS/Reality 失败',
  'connection-refused': '连接被拒绝',
  'network-unreachable': '网络不可达',
  'connection-reset': '连接被重置',
  timeout: '连接超时',
  unknown: '测试失败',
},
```

英文语言包增加对应的 `attempts: 'attempts'`、`DNS failure`、`Authentication failure`、`TLS/Reality failure`、`Connection refused`、`Network unreachable`、`Connection reset`、`Timeout`、`Test failed`。

- [ ] **步骤 4：运行组件测试验证通过**

运行：`npm test -- src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/views/HomeView/components/NodeSelectorModal.vue frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "feat: show node delay failure categories"
```

### 任务 4：完整验证

**文件：**
- 验证：`frontend/src/views/HomeView/**`

- [ ] **步骤 1：运行 HomeView 测试集**

运行：`npm test -- src/views/HomeView`

工作目录：`frontend`

预期：全部 PASS，0 个失败。

- [ ] **步骤 2：运行前端类型检查**

运行：`npm run type-check`

工作目录：`frontend`

预期：退出码 0，无 TypeScript 或 Vue 类型错误。

- [ ] **步骤 3：运行完整前端测试**

运行：`npm test`

工作目录：`frontend`

预期：全部 PASS，0 个失败。

- [ ] **步骤 4：检查最终差异**

运行：`git diff --check` 和 `git diff -- frontend/src/views/HomeView frontend/src/lang/locale docs/superpowers`

预期：`git diff --check` 无输出；差异只包含本功能及已确认的设计、计划文档，不覆盖工作区中原有的 Wails 生成文件变更。

- [ ] **步骤 5：最终 Commit**

仅当步骤 1 至 4 全部通过且用户要求提交时运行：

```bash
git add frontend/src/views/HomeView frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts docs/superpowers/specs/2026-07-12-node-delay-retry-classification-design.md docs/superpowers/plans/2026-07-12-node-delay-retry-classification.md
git commit -m "feat: improve node delay diagnostics"
```
