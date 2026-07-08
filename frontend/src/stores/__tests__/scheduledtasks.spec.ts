import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

const bridgeMocks = vi.hoisted(() => ({
  GetScheduledTaskWorkerLogs: vi.fn(),
  RecordScheduledTaskLog: vi.fn(),
  RunScheduledTaskWorker: vi.fn(),
}))

vi.mock('@/bridge', () => ({
  EventsOn: vi.fn(),
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
  Notify: vi.fn(),
  GetScheduledTaskWorkerLogs: bridgeMocks.GetScheduledTaskWorkerLogs,
  GetScheduledTaskWorkerStatus: vi.fn().mockResolvedValue({
    available: false,
    nodePath: '',
    supportedTypes: [],
  }),
  ReloadScheduledTaskWorker: vi.fn(),
  RunScheduledTaskWorker: bridgeMocks.RunScheduledTaskWorker,
  ClearScheduledTaskWorkerLogs: vi.fn(),
  RecordScheduledTaskLog: bridgeMocks.RecordScheduledTaskLog,
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

  it('returns the local scheduled task log when a task runs in the frontend', async () => {
    setActivePinia(createPinia())
    bridgeMocks.GetScheduledTaskWorkerLogs.mockResolvedValue([])
    bridgeMocks.RecordScheduledTaskLog.mockResolvedValue(undefined)
    const scheduledTasksStore = useScheduledTasksStore()
    const subscribesStore = useSubscribesStore()

    vi.spyOn(subscribesStore, 'updateSubscribe').mockResolvedValue('updated')

    scheduledTasksStore.scheduledtasks.push({
      id: 'task-1',
      name: 'Update subscription',
      type: ScheduledTasksType.UpdateSubscription,
      subscriptions: ['sub-1'],
      rulesets: [],
      plugins: [],
      script: '',
      cron: '* * * * * *',
      notification: false,
      disabled: false,
      lastTime: 0,
    })

    const log = await scheduledTasksStore.runScheduledTask('task-1')

    expect(log).toMatchObject({
      id: 'task-1',
      name: 'Update subscription',
      result: [{ ok: true, result: 'updated' }],
    })
    expect(log?.startTime).toEqual(expect.any(Number))
    expect(log?.endTime).toEqual(expect.any(Number))
    expect(bridgeMocks.RecordScheduledTaskLog).toHaveBeenCalledWith(log)
  })

  it('returns the worker scheduled task log when a task runs in the backend', async () => {
    setActivePinia(createPinia())
    const workerLog = {
      id: 'task-1',
      name: 'Update plugin',
      startTime: 100,
      endTime: 200,
      result: [{ ok: true, result: 'updated' }],
    }
    bridgeMocks.RunScheduledTaskWorker.mockResolvedValue('Success')
    bridgeMocks.GetScheduledTaskWorkerLogs.mockResolvedValue([workerLog])
    const scheduledTasksStore = useScheduledTasksStore()

    scheduledTasksStore.workerStatus = {
      available: true,
      nodePath: '/usr/bin/node',
      supportedTypes: [ScheduledTasksType.UpdatePlugin],
    }
    scheduledTasksStore.scheduledtasks.push({
      id: 'task-1',
      name: 'Update plugin',
      type: ScheduledTasksType.UpdatePlugin,
      subscriptions: [],
      rulesets: [],
      plugins: [],
      script: '',
      cron: '* * * * * *',
      notification: false,
      disabled: false,
      lastTime: 0,
    })

    await expect(scheduledTasksStore.runScheduledTask('task-1')).resolves.toEqual(workerLog)
  })
})
