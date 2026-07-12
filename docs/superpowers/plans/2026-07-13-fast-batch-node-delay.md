# 批量节点测速提速实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将首页批量节点测速改为每个节点只请求 1 次，同时保留手动单节点测速最多 3 次的重试行为，并展示真实尝试次数。

**架构：** `runNodeTest` 继续作为唯一节点探测流程，通过调用选项接收最大尝试次数。单节点入口使用默认的 3 次，批量入口显式使用 1 次；结构化错误保存实际次数和最大次数，Vue 组件仅负责渲染。

**技术栈：** Vue 3、TypeScript、Pinia、Vitest、Vue Test Utils

---

## 文件结构

- 修改 `frontend/src/views/HomeView/nodeController.ts`：在节点测速错误中保存本次最大尝试次数。
- 修改 `frontend/src/views/HomeView/useNodeController.ts`：支持按调用上下文设置最大尝试次数，并让批量测速使用 1 次。
- 修改 `frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`：覆盖批量单次请求及手动三次重试。
- 修改 `frontend/src/views/HomeView/components/NodeSelectorModal.vue`：显示实际的已尝试次数和最大尝试次数。
- 修改 `frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`：覆盖 `1/1` 和 `3/3` 渲染。

### 任务 1：区分手动与批量测速尝试次数

**文件：**
- 修改：`frontend/src/views/HomeView/nodeController.ts:16-20`
- 修改：`frontend/src/views/HomeView/useNodeController.ts:190-241,262-309`
- 测试：`frontend/src/views/HomeView/__tests__/useNodeController.spec.ts`

- [ ] **步骤 1：编写批量测速只请求一次的失败测试**

将现有 `counts retried group results once per node` 测试替换为明确的快速批量行为：

```ts
it('tests each group node only once and records actual attempts', async () => {
  mocks.getProxyDelay
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ delay: 81 })
  const scope = effectScope()
  const controller = scope.run(() => useNodeController())!
  await controller.prepareModal()

  await controller.testGroup()

  expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)
  expect(controller.batch.value).toMatchObject({ completed: 2, success: 1, failure: 1 })
  expect(controller.nodeErrors.value.get('HK 01')).toMatchObject({
    category: 'timeout',
    attempts: 1,
    maxAttempts: 1,
  })
  expect(controller.nodeAttempts.value.get('JP 01')).toBe(1)
  scope.stop()
})
```

- [ ] **步骤 2：运行测试并确认因批量仍重试而失败**

工作目录：`frontend`

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

预期：FAIL；延迟 API 调用次数超过 2，或错误对象缺少 `maxAttempts`。

- [ ] **步骤 3：实现可配置尝试上限的最少代码**

在 `nodeController.ts` 扩展错误模型：

```ts
export interface NodeDelayError {
  category: DelayErrorCategory
  message: string
  attempts: number
  maxAttempts: number
}
```

在 `useNodeController.ts` 扩展选项，并统一使用局部上限：

```ts
const runNodeTest = async (
  name: string,
  options: { cancelled?: () => boolean; maxAttempts?: number } = {},
): Promise<NodeOperationResult> => {
  // 保留现有前置检查。
  const maxAttempts = options.maxAttempts ?? MAX_DELAY_ATTEMPTS
  let lastError = 'home.nodes.unavailable'
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // 保留现有请求、成功短路和取消检查。
    if (attempt < maxAttempts) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, DELAY_RETRY_INTERVAL))
      // 保留现有等待后的取消检查。
    }
  }

  nodeErrors.value.set(name, {
    category: classifyDelayError(lastError),
    message: lastError,
    attempts: maxAttempts,
    maxAttempts,
  })
  // 保留现有失败返回。
}
```

批量池任务调用改为：

```ts
const result = await runNodeTest(name, {
  cancelled: () => batch.value.cancelled,
  maxAttempts: 1,
})
```

- [ ] **步骤 4：更新现有错误对象断言**

为手动失败相关断言增加 `maxAttempts: 3`。保留以下关键断言，证明手动行为未变化：

```ts
expect(mocks.getProxyDelay).toHaveBeenCalledTimes(3)
expect(controller.nodeErrors.value.get('JP 01')).toMatchObject({
  attempts: 3,
  maxAttempts: 3,
})
```

将取消测试的活动请求设为单次失败，并继续断言取消后 API 总调用次数为 1、完成数和失败数均为 0。

- [ ] **步骤 5：运行控制器测试验证通过**

工作目录：`frontend`

运行：`npm test -- src/views/HomeView/__tests__/useNodeController.spec.ts`

预期：该测试文件全部 PASS。

### 任务 2：展示真实最大尝试次数

**文件：**
- 修改：`frontend/src/views/HomeView/components/NodeSelectorModal.vue:176-180`
- 测试：`frontend/src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

- [ ] **步骤 1：编写批量单次失败展示的失败测试**

在组件测试的控制器夹具中提供错误：

```ts
error: {
  category: 'timeout' as const,
  message: 'timeout',
  attempts: 1,
  maxAttempts: 1,
},
```

增加测试：

```ts
it('renders the actual attempt limit for a failed delay test', () => {
  const wrapper = mountModal()
  expect(wrapper.get('[data-delay="JP 01"]').text()).toContain('1/1')
})
```

- [ ] **步骤 2：运行组件测试验证正确失败**

工作目录：`frontend`

运行：`npm test -- src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：FAIL；组件仍固定渲染 `1/3`。

- [ ] **步骤 3：实现动态分母**

将失败状态展示改为：

```vue
{{ t(`home.nodes.delayError.${node.error?.category ?? 'unknown'}`) }} ·
{{ node.error?.attempts ?? 1 }}/{{ node.error?.maxAttempts ?? MAX_DELAY_ATTEMPTS }}
```

从控制器模块导入 `MAX_DELAY_ATTEMPTS`，用于兼容没有结构化错误对象的展示状态：

```ts
import { MAX_DELAY_ATTEMPTS } from '@/views/HomeView/useNodeController'
```

- [ ] **步骤 4：补充手动失败 `3/3` 回归断言并运行组件测试**

使用 `attempts: 3, maxAttempts: 3` 的节点夹具断言文本包含 `3/3`。

工作目录：`frontend`

运行：`npm test -- src/views/HomeView/components/__tests__/NodeSelectorModal.spec.ts`

预期：该测试文件全部 PASS。

### 任务 3：完整验证

**文件：**
- 验证：`frontend/src/views/HomeView/**`

- [ ] **步骤 1：运行首页节点控制器相关测试**

工作目录：`frontend`

运行：`npm test -- src/views/HomeView`

预期：全部 PASS，无未处理异常。

- [ ] **步骤 2：运行 TypeScript 类型检查**

工作目录：`frontend`

运行：`npm run type-check`

预期：退出码为 0。

- [ ] **步骤 3：运行完整前端测试**

工作目录：`frontend`

运行：`npm test`

预期：全部 PASS。

- [ ] **步骤 4：检查最终差异**

运行：`git diff --check`

预期：无空白错误。检查差异只包含设计文档、实现计划、上述生产代码和测试。
