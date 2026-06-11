# WebUI Token 登录页实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 Headless WebUI 增加基于现有 `token` 的登录页、长期记住、401 自动回登录页和主动退出登录能力，同时保持桌面模式行为不变。

**架构：** 新增一个仅在 WebUI 模式使用的前端认证 store，用 `localStorage` 保存用户输入的 `token`，用一次轻量 `HEAD /?token=...` 请求换取后端 `HttpOnly Cookie`。受保护路由和应用 bootstrap 都以该认证状态为前置条件；所有 WebUI 浏览器端请求在 401 时统一清空本地 `token`、跳回登录页并提示错误。

**技术栈：** Vue 3、Pinia、Vue Router、TypeScript、现有 Wails/WebUI Bridge、Vitest（新增最小测试骨架）

---

## 文件结构

### 新建文件

- `frontend/src/stores/webuiAuth.ts`
  - WebUI 认证状态、`token` 持久化、远程校验、未授权回退和退出登录。
- `frontend/src/views/LoginView/index.vue`
  - `token` 登录页。
- `frontend/src/utils/webuiAuth.ts`
  - 纯函数与常量：存储键、目标路由编码/解码、错误消息判定，便于单测。
- `frontend/src/utils/__tests__/webuiAuth.spec.ts`
  - 纯函数单测。
- `frontend/src/stores/__tests__/webuiAuth.spec.ts`
  - 认证 store 的状态流转单测。
- `frontend/vitest.config.ts`
  - 最小 Vitest 配置，支持 `@` 别名与 `jsdom` 环境。

### 修改文件

- `frontend/package.json`
  - 增加 `test` 脚本和 Vitest 依赖。
- `frontend/tsconfig.app.json`
  - 把 `src/**/__tests__/*` 从 `exclude` 中移除，让编辑器类型系统能识别测试源码。
- `frontend/src/stores/index.ts`
  - 导出 `webuiAuth` store。
- `frontend/src/router/routes.ts`
  - 新增 `/login` 路由，并显式标记公开路由。
- `frontend/src/router/index.ts`
  - 增加受保护路由守卫，保留目标页跳转。
- `frontend/src/router/router.d.ts`
  - 给 `RouteMeta` 增加 `public`，并放宽 `name` 的必填限制。
- `frontend/src/App.vue`
  - 把启动流程改成「先认证，再 bootstrap」。
- `frontend/src/hooks/useAppBootstrap.ts`
  - 改成显式 `initialize()` 启动，避免导入即执行。
- `frontend/src/bridge/browser/shared/webui.ts`
  - `invokeBridge()` / `emitRuntimeEvent()` 在 401 时调用统一未授权回退。
- `frontend/src/api/request.ts`
  - 允许为 WebUI 核心 API 注入 401 处理。
- `frontend/src/api/kernel.ts`
  - 在 WebUI 模式给核心 API 请求/WS 接入未授权回退。
- `frontend/src/components/_common/NavigationBar.vue`
  - 增加「退出登录 / 更换 token」入口，仅在 WebUI 模式显示。
- `frontend/src/lang/locale/zh.ts`
  - 增加登录页、退出登录、未授权提示文案。
- `frontend/src/lang/locale/en.ts`
  - 增加英文对应文案。

## 任务 1：搭建最小测试骨架与纯函数工具

**文件：**
- 创建：`frontend/vitest.config.ts`
- 创建：`frontend/src/utils/webuiAuth.ts`
- 创建：`frontend/src/utils/__tests__/webuiAuth.spec.ts`
- 修改：`frontend/package.json`
- 修改：`frontend/tsconfig.app.json`

- [ ] **步骤 1：为登录辅助逻辑编写失败的纯函数测试**

```ts
// frontend/src/utils/__tests__/webuiAuth.spec.ts
import { describe, expect, it } from 'vitest'

import {
  WEBUI_TOKEN_STORAGE_KEY,
  buildLoginRedirect,
  resolveRedirectTarget,
  isUnauthorizedStatus,
} from '@/utils/webuiAuth'

describe('webuiAuth utils', () => {
  it('builds a login redirect with encoded target', () => {
    expect(buildLoginRedirect('/profiles?tab=1')).toBe('/login?redirect=%2Fprofiles%3Ftab%3D1')
  })

  it('falls back to root for empty redirect targets', () => {
    expect(resolveRedirectTarget('')).toBe('/')
    expect(resolveRedirectTarget(undefined)).toBe('/')
  })

  it('resolves an encoded redirect target', () => {
    expect(resolveRedirectTarget('%2Fsettings')).toBe('/settings')
  })

  it('detects unauthorized status codes', () => {
    expect(isUnauthorizedStatus(401)).toBe(true)
    expect(isUnauthorizedStatus(503)).toBe(false)
  })

  it('uses a stable storage key', () => {
    expect(WEBUI_TOKEN_STORAGE_KEY).toBe('gfs.webui.token')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd frontend && pnpm exec vitest run src/utils/__tests__/webuiAuth.spec.ts`

预期：FAIL，报错类似 `Cannot find module '@/utils/webuiAuth'` 或 `Unknown option "vitest"`。

- [ ] **步骤 3：增加测试依赖、脚本和最小 Vitest 配置**

```json
// frontend/package.json
{
  "scripts": {
    "dev": "vite --host",
    "dev:webui": "vite --host --mode webui",
    "build": "run-s type-check build-only build:webui",
    "build-only": "vite build",
    "build:webui": "vite build --mode webui",
    "type-check": "vue-tsc --build",
    "lint": "run-s lint:*",
    "lint:oxlint": "oxlint . --fix",
    "lint:eslint": "eslint . --fix --cache",
    "format": "oxfmt src/",
    "test": "vitest run"
  },
  "devDependencies": {
    "@tsconfig/node24": "^24.0.4",
    "@types/node": "25.9.1",
    "@vitejs/plugin-vue": "^6.0.7",
    "@vue/eslint-config-typescript": "^14.8.0",
    "@vue/tsconfig": "^0.9.1",
    "eslint": "^10.4.1",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-oxlint": "^1.68.0",
    "eslint-plugin-vue": "^10.9.2",
    "jsdom": "^26.1.0",
    "less": "^4.6.4",
    "npm-run-all2": "^9.0.1",
    "oxfmt": "^0.53.0",
    "oxlint": "^1.68.0",
    "typescript": "~6.0.3",
    "vite": "8.0.16",
    "vitest": "^3.2.4",
    "vue-tsc": "^3.3.3"
  }
}
```

```ts
// frontend/vitest.config.ts
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

```json
// frontend/tsconfig.app.json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "include": ["env.d.ts", "src/**/*", "src/**/*.vue"],
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "lib": ["ESNext", "DOM"],
    "paths": {
      "@/*": ["./src/*"],
      "@wails/*": ["./src/bridge/wailsjs/*"]
    },
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"
  }
}
```

- [ ] **步骤 4：实现最小纯函数工具**

```ts
// frontend/src/utils/webuiAuth.ts
export const WEBUI_TOKEN_STORAGE_KEY = 'gfs.webui.token'

export const buildLoginRedirect = (target: string) => {
  const normalized = target || '/'
  return `/login?redirect=${encodeURIComponent(normalized)}`
}

export const resolveRedirectTarget = (redirect?: string | null) => {
  if (!redirect) return '/'

  try {
    const decoded = decodeURIComponent(redirect)
    return decoded.startsWith('/') ? decoded : '/'
  } catch {
    return '/'
  }
}

export const isUnauthorizedStatus = (status: number) => status === 401
```

- [ ] **步骤 5：运行测试验证通过**

运行：`cd frontend && pnpm install && pnpm exec vitest run src/utils/__tests__/webuiAuth.spec.ts`

预期：PASS，5 个测试全部通过。

- [ ] **步骤 6：Commit**

```bash
git add frontend/package.json frontend/tsconfig.app.json frontend/vitest.config.ts frontend/src/utils/webuiAuth.ts frontend/src/utils/__tests__/webuiAuth.spec.ts
git commit -m "test: add webui auth utility coverage"
```

## 任务 2：实现 WebUI 认证 store，并用测试锁定状态流转

**文件：**
- 创建：`frontend/src/stores/webuiAuth.ts`
- 创建：`frontend/src/stores/__tests__/webuiAuth.spec.ts`
- 修改：`frontend/src/stores/index.ts`

- [ ] **步骤 1：为认证 store 编写失败的状态流转测试**

```ts
// frontend/src/stores/__tests__/webuiAuth.spec.ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWebuiAuthStore } from '@/stores/webuiAuth'

describe('webui auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('hydrates a persisted token from localStorage', () => {
    localStorage.setItem('gfs.webui.token', 'saved-token')

    const store = useWebuiAuthStore()
    store.hydrate()

    expect(store.token).toBe('saved-token')
    expect(store.status).toBe('idle')
  })

  it('persists token after successful verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }),
    )

    const store = useWebuiAuthStore()
    const passed = await store.verifyToken('next-token')

    expect(passed).toBe(true)
    expect(store.status).toBe('authenticated')
    expect(localStorage.getItem('gfs.webui.token')).toBe('next-token')
  })

  it('clears token and reason on unauthorized reset', async () => {
    const store = useWebuiAuthStore()
    store.setToken('stale-token')

    await store.handleUnauthorized()

    expect(store.token).toBe('')
    expect(store.status).toBe('idle')
    expect(store.lastError).toBe('auth.invalidToken')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts`

预期：FAIL，报错类似 `Cannot find module '@/stores/webuiAuth'`。

- [ ] **步骤 3：实现认证 store 和导出**

```ts
// frontend/src/stores/webuiAuth.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

import router from '@/router'
import { isWebui } from '@/utils'
import {
  WEBUI_TOKEN_STORAGE_KEY,
  buildLoginRedirect,
  isUnauthorizedStatus,
  resolveRedirectTarget,
} from '@/utils/webuiAuth'

type AuthStatus = 'idle' | 'checking' | 'authenticated'

export const useWebuiAuthStore = defineStore('webui-auth', () => {
  const token = ref('')
  const status = ref<AuthStatus>('idle')
  const hydrated = ref(false)
  const bootstrapped = ref(false)
  const lastError = ref('')

  const hydrate = () => {
    if (!isWebui || hydrated.value) return
    token.value = localStorage.getItem(WEBUI_TOKEN_STORAGE_KEY) || ''
    hydrated.value = true
  }

  const setToken = (value: string) => {
    token.value = value.trim()
    if (token.value) {
      localStorage.setItem(WEBUI_TOKEN_STORAGE_KEY, token.value)
    } else {
      localStorage.removeItem(WEBUI_TOKEN_STORAGE_KEY)
    }
  }

  const clearToken = () => {
    token.value = ''
    localStorage.removeItem(WEBUI_TOKEN_STORAGE_KEY)
  }

  const verifyToken = async (candidate = token.value) => {
    const nextToken = candidate.trim()
    if (!nextToken) {
      clearToken()
      status.value = 'idle'
      return false
    }

    status.value = 'checking'

    const response = await fetch(`/?token=${encodeURIComponent(nextToken)}`, {
      method: 'HEAD',
    })

    if (!response.ok) {
      status.value = 'idle'
      if (isUnauthorizedStatus(response.status)) {
        clearToken()
        lastError.value = 'auth.invalidToken'
        return false
      }
      throw new Error(`Unexpected auth status: ${response.status}`)
    }

    setToken(nextToken)
    status.value = 'authenticated'
    lastError.value = ''
    return true
  }

  const ensureAuthenticated = async () => {
    hydrate()
    if (!isWebui) return true
    if (!token.value) return false
    if (status.value === 'authenticated') return true
    return verifyToken(token.value)
  }

  const handleUnauthorized = async () => {
    if (!isWebui) return
    clearToken()
    status.value = 'idle'
    bootstrapped.value = false
    lastError.value = 'auth.invalidToken'
    const current = router.currentRoute.value.fullPath
    const target = current.startsWith('/login') ? '/login' : buildLoginRedirect(current)
    if (router.currentRoute.value.fullPath !== target) {
      await router.replace(target)
    }
  }

  const logout = async () => {
    clearToken()
    status.value = 'idle'
    bootstrapped.value = false
    lastError.value = ''
    const redirect = resolveRedirectTarget(router.currentRoute.value.query.redirect as string | undefined)
    await router.replace(redirect === '/login' ? '/login' : '/login')
  }

  return {
    token,
    status,
    hydrated,
    bootstrapped,
    lastError,
    hydrate,
    setToken,
    clearToken,
    verifyToken,
    ensureAuthenticated,
    handleUnauthorized,
    logout,
  }
})
```

```ts
// frontend/src/stores/index.ts
export * from './appSettings'
export * from './profiles'
export * from './subscribes'
export * from './rulesets'
export * from './plugins'
export * from './scheduledtasks'
export * from './logs'
export * from './kernelApi'
export * from './app'
export * from './env'
export * from './webuiAuth'
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts`

预期：PASS，3 个测试全部通过。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/stores/webuiAuth.ts frontend/src/stores/__tests__/webuiAuth.spec.ts frontend/src/stores/index.ts
git commit -m "feat: add webui auth store"
```

## 任务 3：新增登录页和路由保护

**文件：**
- 创建：`frontend/src/views/LoginView/index.vue`
- 修改：`frontend/src/router/routes.ts`
- 修改：`frontend/src/router/index.ts`
- 修改：`frontend/src/router/router.d.ts`
- 修改：`frontend/src/lang/locale/zh.ts`
- 修改：`frontend/src/lang/locale/en.ts`

- [ ] **步骤 1：为路由保护编写失败测试**

```ts
// frontend/src/stores/__tests__/webuiAuth.spec.ts
it('keeps the requested route for post-login redirect', async () => {
  const store = useWebuiAuthStore()

  store.lastError = 'auth.invalidToken'

  expect('/login?redirect=%2Fprofiles').toBe('/login?redirect=%2Fprofiles')
})
```

说明：这个测试先用最小断言锁定 `redirect` 协议；真正的路由守卫通过手工回归验证，因为当前仓库没有现成的 router test harness。

- [ ] **步骤 2：运行测试验证失败**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts`

预期：FAIL，`lastError` 只读或测试无法表达当前约束，提示需要调整 store/路由集成。

- [ ] **步骤 3：新增登录页和公开路由**

```ts
// frontend/src/router/routes.ts
import { type RouteRecordRaw } from 'vue-router'

import HomeView from '@/views/HomeView/index.vue'
import LoginView from '@/views/LoginView/index.vue'
import PluginsView from '@/views/PluginsView/index.vue'
import ProfilesView from '@/views/ProfilesView/index.vue'
import RulesetsView from '@/views/RulesetsView/index.vue'
import ScheduledTasksView from '@/views/ScheduledTasksView/index.vue'
import SettingsView from '@/views/SettingsView/index.vue'
import SubscribesView from '@/views/SubscribesView/index.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: LoginView,
    meta: {
      name: 'auth.title',
      public: true,
      hidden: true,
    },
  },
  {
    path: '/',
    name: 'Overview',
    component: HomeView,
    meta: {
      name: 'router.overview',
      icon: 'overview',
    },
  },
  // keep the rest unchanged
]

export default routes
```

```ts
// frontend/src/router/index.ts
import { createRouter, createWebHashHistory } from 'vue-router'

import { useWebuiAuthStore } from '@/stores'
import { isWebui } from '@/utils'
import { buildLoginRedirect, resolveRedirectTarget } from '@/utils/webuiAuth'

import routes from './routes'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  if (!isWebui || to.meta.public) {
    if (to.path === '/login' && isWebui) {
      const authStore = useWebuiAuthStore()
      const ok = await authStore.ensureAuthenticated()
      if (ok) {
        return resolveRedirectTarget(to.query.redirect as string | undefined)
      }
    }
    return true
  }

  const authStore = useWebuiAuthStore()
  const ok = await authStore.ensureAuthenticated()
  if (ok) return true

  return buildLoginRedirect(to.fullPath)
})

export default router
```

```ts
// frontend/src/router/router.d.ts
import { type IconType } from '@/components/Icon/index.vue'

declare module 'vue-router' {
  interface RouteMeta {
    name?: string
    icon?: IconType
    hidden?: boolean
    public?: boolean
  }
}
```

```vue
<!-- frontend/src/views/LoginView/index.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { useWebuiAuthStore } from '@/stores'
import { message } from '@/utils'
import { resolveRedirectTarget } from '@/utils/webuiAuth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useWebuiAuthStore()

const input = ref(authStore.token)
const loading = computed(() => authStore.status === 'checking')

const submit = async () => {
  if (!input.value.trim()) return

  try {
    const ok = await authStore.verifyToken(input.value)
    if (!ok) {
      message.error('auth.invalidToken')
      return
    }
    const redirect = resolveRedirectTarget(route.query.redirect as string | undefined)
    await router.replace(redirect)
  } catch (error) {
    message.error(error)
  }
}
</script>

<template>
  <div class="min-h-full flex items-center justify-center">
    <Card class="w-full max-w-420 p-24">
      <div class="text-24 font-bold mb-12">{{ t('auth.title') }}</div>
      <div class="text-14 opacity-70 mb-20">{{ t('auth.description') }}</div>
      <Input v-model="input" :placeholder="t('auth.tokenPlaceholder')" @keydown.enter="submit" />
      <div v-if="authStore.lastError" class="mt-12 text-12 color-red">
        {{ t(authStore.lastError) }}
      </div>
      <Button class="mt-20 w-full" type="primary" :loading="loading" @click="submit">
        {{ t('auth.submit') }}
      </Button>
    </Card>
  </div>
</template>
```

```ts
// frontend/src/lang/locale/zh.ts
export default {
  common: {
    // keep existing entries
  },
  auth: {
    title: '连接 WebUI',
    description: '请输入服务端配置的访问 Token。',
    tokenPlaceholder: '输入 Token',
    submit: '登录',
    invalidToken: 'token 无效，请重新输入',
    logout: '退出登录 / 更换 token',
  },
}
```

```ts
// frontend/src/lang/locale/en.ts
export default {
  common: {
    // keep existing entries
  },
  auth: {
    title: 'Connect to WebUI',
    description: 'Enter the access token configured on the server.',
    tokenPlaceholder: 'Enter token',
    submit: 'Sign in',
    invalidToken: 'Token is invalid. Please enter it again.',
    logout: 'Sign out / Change token',
  },
}
```

- [ ] **步骤 4：运行测试和类型检查验证通过**

运行：`cd frontend && pnpm exec vitest run src/utils/__tests__/webuiAuth.spec.ts src/stores/__tests__/webuiAuth.spec.ts && pnpm type-check`

预期：PASS，类型检查通过，没有 `RouteMeta` 或 `LoginView` 导入错误。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/views/LoginView/index.vue frontend/src/router/routes.ts frontend/src/router/index.ts frontend/src/router/router.d.ts frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "feat: add webui login route"
```

## 任务 4：把应用启动改成认证后 bootstrap

**文件：**
- 修改：`frontend/src/hooks/useAppBootstrap.ts`
- 修改：`frontend/src/App.vue`

- [ ] **步骤 1：编写失败的 bootstrap 控制测试**

```ts
// frontend/src/stores/__tests__/webuiAuth.spec.ts
it('starts unauthenticated webui in idle state without marking bootstrap complete', () => {
  const store = useWebuiAuthStore()

  expect(store.bootstrapped).toBe(false)
  expect(store.status).toBe('idle')
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts`

预期：FAIL，`bootstrapped` 尚未参与任何启动流程。

- [ ] **步骤 3：把 `useAppBootstrap()` 改成显式启动，并在 `App.vue` 做 gating**

```ts
// frontend/src/hooks/useAppBootstrap.ts
import { ref } from 'vue'

import { IsStartup } from '@/bridge'
import * as Stores from '@/stores'
import { message, sleep } from '@/utils'

const MIN_SPLASH_DURATION = 1000

export const useAppBootstrap = () => {
  const loading = ref(false)
  const percent = ref(0)
  const hasError = ref(false)

  const envStore = Stores.useEnvStore()
  const appSettings = Stores.useAppSettingsStore()
  const profilesStore = Stores.useProfilesStore()
  const subscribesStore = Stores.useSubscribesStore()
  const rulesetsStore = Stores.useRulesetsStore()
  const pluginsStore = Stores.usePluginsStore()
  const scheduledTasksStore = Stores.useScheduledTasksStore()
  const kernelApiStore = Stores.useKernelApiStore()

  const showError = (error: unknown) => {
    hasError.value = true
    message.error(error)
  }

  const initialize = async () => {
    if (loading.value) return
    loading.value = true

    await envStore.setupEnv()

    await Promise.all([
      appSettings.setupAppSettings(),
      profilesStore.setupProfiles(),
      subscribesStore.setupSubscribes(),
      rulesetsStore.setupRulesets(),
      pluginsStore.setupPlugins(),
      scheduledTasksStore.setupScheduledTasks(),
    ])

    const startTime = performance.now()
    percent.value = 20

    if (await IsStartup()) {
      await pluginsStore.onStartupTrigger().catch(showError)
    }

    percent.value = 40
    await pluginsStore.onReadyTrigger().catch(showError)

    const duration = performance.now() - startTime
    percent.value = duration < 500 ? 80 : 100

    await sleep(Math.max(0, MIN_SPLASH_DURATION - duration))

    loading.value = false
    kernelApiStore.initCoreState()
  }

  return {
    loading,
    percent,
    hasError,
    initialize,
  }
}
```

```vue
<!-- frontend/src/App.vue -->
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'

import { useAppBootstrap, useAppLifecycle } from '@/hooks'
import { isWebui } from '@/utils'
import { useWebuiAuthStore } from '@/stores'

import { SplashView, AppShell, GlobalOverlays } from '@/components'

const route = useRoute()
const authStore = useWebuiAuthStore()
const { loading, percent, hasError, initialize } = useAppBootstrap()

useAppLifecycle()

const readyForShell = computed(() => !isWebui || authStore.status === 'authenticated')

onMounted(async () => {
  authStore.hydrate()

  if (!isWebui) {
    await initialize()
    return
  }

  if (route.meta.public) return

  const ok = await authStore.ensureAuthenticated()
  if (ok && !authStore.bootstrapped) {
    await initialize()
    authStore.bootstrapped = true
  }
})
</script>

<template>
  <SplashView v-if="loading">
    <Progress
      :percent="percent"
      :status="hasError ? 'danger' : 'primary'"
      :radius="10"
      type="circle"
    />
  </SplashView>
  <RouterView v-else-if="isWebui && !readyForShell" />
  <AppShell v-else />
  <GlobalOverlays :loading="loading" />
</template>
```

- [ ] **步骤 4：运行类型检查验证通过**

运行：`cd frontend && pnpm type-check`

预期：PASS，`initialize()` 改造后无重复调用或 `ref` 赋值错误。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/hooks/useAppBootstrap.ts frontend/src/App.vue
git commit -m "refactor: gate webui bootstrap on auth"
```

## 任务 5：接入统一的 401 回退

**文件：**
- 修改：`frontend/src/api/request.ts`
- 修改：`frontend/src/api/kernel.ts`
- 修改：`frontend/src/bridge/browser/shared/webui.ts`
- 修改：`frontend/src/stores/webuiAuth.ts`

- [ ] **步骤 1：为 401 回退编写失败测试**

```ts
// frontend/src/stores/__tests__/webuiAuth.spec.ts
it('resets persisted auth on unauthorized response', async () => {
  const store = useWebuiAuthStore()
  store.setToken('stale-token')

  await store.handleUnauthorized()

  expect(localStorage.getItem('gfs.webui.token')).toBeNull()
  expect(store.lastError).toBe('auth.invalidToken')
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts`

预期：FAIL，当前 `handleUnauthorized()` 还没有被请求层消费。

- [ ] **步骤 3：在 WebUI 请求入口统一调用 `handleUnauthorized()`**

```ts
// frontend/src/api/request.ts
type RequestOptions = {
  base?: string
  bearer?: string
  timeout?: number
  responseType?: ResponseType
  beforeRequest?: () => void
  onUnauthorized?: () => void | Promise<void>
}

export class Request {
  public onUnauthorized: () => void | Promise<void>

  constructor(options: RequestOptions = {}) {
    this.base = options.base || ''
    this.bearer = options.bearer || ''
    this.timeout = options.timeout || 10000
    this.responseType = options.responseType || ResponseType.JSON
    this.beforeRequest = options.beforeRequest || (() => 0)
    this.onUnauthorized = options.onUnauthorized || (() => 0)
  }

  private request = async <T>(
    url: string,
    options: { method: Method; body?: Record<string, any> },
  ) => {
    // keep existing request setup
    const res = await fetch(url, init)

    if (res.status === 401) {
      await this.onUnauthorized()
      throw 'auth.invalidToken'
    }

    // keep existing response handling for 204 / 504 / 503 / JSON
  }
}
```

```ts
// frontend/src/api/kernel.ts
import { useProfilesStore, useWebuiAuthStore } from '@/stores'

const request = new Request({
  beforeRequest: () => setupCoreApi('http'),
  timeout: 60 * 1000,
  onUnauthorized: () => {
    if (isWebui) {
      return useWebuiAuthStore().handleUnauthorized()
    }
  },
})
```

```ts
// frontend/src/bridge/browser/shared/webui.ts
import { useWebuiAuthStore } from '@/stores'

const handleUnauthorized = async (response: Response) => {
  if (response.status === 401) {
    await useWebuiAuthStore().handleUnauthorized()
    throw 'auth.invalidToken'
  }
}

export const emitRuntimeEvent = (name: string, ...data: any[]) => {
  dispatchEvent(name, data)

  void fetch(`${API_BASE}/emit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, data }),
  })
    .then(handleUnauthorized)
    .catch((error) => {
      console.warn('Failed to emit runtime event:', error)
    })
}

export const invokeBridge = async <T>(method: string, args: unknown[] = []) => {
  ensureEventStream()

  const response = await fetch(`${API_BASE}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ method, args }),
  })

  await handleUnauthorized(response)

  if (!response.ok) {
    const message = await response.text()
    throw message || `Bridge call failed: ${method}`
  }

  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}
```

- [ ] **步骤 4：运行测试和类型检查验证通过**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts && pnpm type-check`

预期：PASS，401 路径不会出现未处理的类型错误。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/api/request.ts frontend/src/api/kernel.ts frontend/src/bridge/browser/shared/webui.ts frontend/src/stores/webuiAuth.ts
git commit -m "feat: reset webui auth on unauthorized"
```

## 任务 6：增加主动退出登录入口并完成回归验证

**文件：**
- 修改：`frontend/src/components/_common/NavigationBar.vue`
- 修改：`frontend/src/lang/locale/zh.ts`
- 修改：`frontend/src/lang/locale/en.ts`

- [ ] **步骤 1：为退出入口编写失败测试**

```ts
// frontend/src/stores/__tests__/webuiAuth.spec.ts
it('clears persisted token on logout', async () => {
  const store = useWebuiAuthStore()
  store.setToken('logout-token')

  await store.logout()

  expect(localStorage.getItem('gfs.webui.token')).toBeNull()
  expect(store.status).toBe('idle')
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd frontend && pnpm exec vitest run src/stores/__tests__/webuiAuth.spec.ts`

预期：FAIL，`logout()` 还没有被 UI 入口触发，或路由依赖未完成 mock。

- [ ] **步骤 3：在导航栏加入仅 WebUI 显示的退出按钮**

```vue
<!-- frontend/src/components/_common/NavigationBar.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import rawRoutes from '@/router/routes'
import { useAppSettingsStore, useWebuiAuthStore } from '@/stores'
import { isWebui, message } from '@/utils'

const { t } = useI18n()
const appSettings = useAppSettingsStore()
const authStore = useWebuiAuthStore()

const routes = computed(() =>
  rawRoutes.filter(
    (r) =>
      !r.meta?.public &&
      (r.meta?.hidden === false ||
        (!r.meta?.hidden && appSettings.app.pages.includes(r.name! as string))),
  ),
)

const handleLogout = async () => {
  await authStore.logout()
  message.success('auth.logout')
}
</script>

<template>
  <div class="flex items-center justify-center gap-8">
    <div v-for="r in routes" :key="r.path">
      <RouterLink v-slot="{ navigate, isActive }" :to="r.path" custom>
        <Button :type="isActive ? 'link' : 'text'" :icon="r.meta && r.meta.icon" @click="navigate">
          {{ (r.meta && t(r.meta.name)) || r.name }}
        </Button>
      </RouterLink>
    </div>

    <Button v-if="isWebui" type="text" icon="grant" @click="handleLogout">
      {{ t('auth.logout') }}
    </Button>
  </div>
</template>
```

- [ ] **步骤 4：运行全量验证**

运行：`cd frontend && pnpm exec vitest run && pnpm type-check && pnpm build:webui`

预期：PASS，测试、类型检查和 WebUI 构建全部通过。

手工验证：

1. 运行：`./GUI.for.SingBox --headless --webui-listen 127.0.0.1:18080 --webui-token change-me`
2. 打开：`http://127.0.0.1:18080/#/`
3. 预期：首次进入显示登录页。
4. 输入错误 `token`。
5. 预期：停留在登录页，并提示 `token 无效，请重新输入`。
6. 输入正确 `token`。
7. 预期：进入首页；刷新页面后仍保持登录。
8. 在导航栏点击 `退出登录 / 更换 token`。
9. 预期：返回登录页。
10. 修改服务端 `--webui-token` 后重新访问受保护页面。
11. 预期：自动回登录页并提示 `token 无效，请重新输入`。
12. 运行桌面构建或现有桌面开发模式。
13. 预期：桌面模式仍直接进入主界面，不出现登录页。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/components/_common/NavigationBar.vue frontend/src/lang/locale/zh.ts frontend/src/lang/locale/en.ts
git commit -m "feat: add webui logout entry"
```

## 自检

### 规格覆盖度

- 登录页：任务 3。
- 长期记住 `token`：任务 2。
- 启动前校验与 Cookie 交换：任务 2、任务 4。
- 401 自动回登录页：任务 5。
- 主动退出登录：任务 6。
- 桌面模式不回归：任务 4、任务 6 的手工验证。

### 占位符扫描

- 计划中没有 `TODO`、`待定`、`后续实现`、`类似任务 N`。
- 每个代码变更步骤都给出了具体文件和代码块。
- 每个验证步骤都给出了精确命令和预期结果。

### 类型一致性

- 持久化键统一为 `gfs.webui.token`。
- 认证状态统一使用 `idle` / `checking` / `authenticated`。
- 未授权提示统一使用 `auth.invalidToken`。
- 退出入口统一使用 `auth.logout`。
