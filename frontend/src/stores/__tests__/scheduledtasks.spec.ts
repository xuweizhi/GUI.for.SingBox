import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  EventsOn: vi.fn(),
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
  Notify: vi.fn(),
  GetScheduledTaskWorkerLogs: vi.fn().mockResolvedValue([]),
  GetScheduledTaskWorkerStatus: vi.fn().mockResolvedValue({
    available: false,
    nodePath: '',
    supportedTypes: [],
  }),
  ReloadScheduledTaskWorker: vi.fn(),
  RunScheduledTaskWorker: vi.fn(),
  ClearScheduledTaskWorkerLogs: vi.fn(),
  RecordScheduledTaskLog: vi.fn(),
  ReadDir: vi.fn().mockResolvedValue([]),
  GetSystemProxyBypass: vi.fn(),
  WindowSetSystemDefaultTheme: vi.fn(),
  WindowIsMaximised: vi.fn().mockResolvedValue(false),
  WindowIsMinimised: vi.fn().mockResolvedValue(false),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lang', () => ({
  default: {
    global: {
      t: (key: string) => key,
      locale: { value: 'en' },
      availableLocales: ['en'],
    },
  },
  loadLocale: vi.fn(),
}))

vi.mock('@/stores/kernelApi', () => ({
  useKernelApiStore: () => ({}),
}))

vi.mock('@/stores/env', () => ({
  useEnvStore: () => ({
    env: {},
  }),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

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
