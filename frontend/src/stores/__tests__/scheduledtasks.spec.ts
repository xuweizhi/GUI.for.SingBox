import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridgeMocks = vi.hoisted(() => ({
  ClearScheduledTaskWorkerLogs: vi.fn(),
  Cron: vi.fn(function () {
    return { stop: vi.fn() }
  }),
  EventsOn: vi.fn(),
  GetScheduledTaskWorkerLogs: vi.fn(),
  GetScheduledTaskWorkerStatus: vi.fn(),
  RecordScheduledTaskLog: vi.fn(),
  RunScheduledTaskWorker: vi.fn(),
}))

vi.mock('croner', () => ({ Cron: bridgeMocks.Cron }))

vi.mock('@/bridge', () => ({
  EventsOn: bridgeMocks.EventsOn,
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
  Notify: vi.fn(),
  GetScheduledTaskWorkerLogs: bridgeMocks.GetScheduledTaskWorkerLogs,
  GetScheduledTaskWorkerStatus: bridgeMocks.GetScheduledTaskWorkerStatus,
  ReloadScheduledTaskWorker: vi.fn(),
  RunScheduledTaskWorker: bridgeMocks.RunScheduledTaskWorker,
  ClearScheduledTaskWorkerLogs: bridgeMocks.ClearScheduledTaskWorkerLogs,
  RecordScheduledTaskLog: bridgeMocks.RecordScheduledTaskLog,
  ReadDir: vi.fn().mockResolvedValue([]),
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
import { useLogsStore, useScheduledTasksStore, useSubscribesStore } from '@/stores'

describe('scheduledtasks store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMocks.GetScheduledTaskWorkerLogs.mockResolvedValue([])
    bridgeMocks.GetScheduledTaskWorkerStatus.mockResolvedValue({
      available: false,
      nodePath: '',
      supportedTypes: [],
    })
  })

  it('does not create a frontend cron for a worker-managed task', async () => {
    setActivePinia(createPinia())
    bridgeMocks.GetScheduledTaskWorkerStatus.mockResolvedValue({
      available: true,
      nodePath: '/usr/bin/node',
      supportedTypes: [ScheduledTasksType.UpdatePlugin],
    })
    const store = useScheduledTasksStore()
    store.scheduledtasks.push(createTask(ScheduledTasksType.UpdatePlugin))

    await store.setupScheduledTasks()

    expect(bridgeMocks.Cron).not.toHaveBeenCalled()
  })

  it('creates a fallback frontend cron when the worker is unavailable', async () => {
    setActivePinia(createPinia())
    const store = useScheduledTasksStore()
    store.scheduledtasks.push(createTask(ScheduledTasksType.UpdatePlugin))

    await store.setupScheduledTasks()

    expect(bridgeMocks.Cron).toHaveBeenCalledOnce()
    expect(bridgeMocks.Cron).toHaveBeenCalledWith('* * * * * *', expect.any(Function))
  })

  it('hydrates worker logs and applies log events to task lastTime', async () => {
    setActivePinia(createPinia())
    const workerLog = createLog(100)
    const eventLog = createLog(300)
    bridgeMocks.GetScheduledTaskWorkerLogs.mockResolvedValue([workerLog])
    const store = useScheduledTasksStore()
    const logsStore = useLogsStore()
    store.scheduledtasks.push(createTask(ScheduledTasksType.UpdatePlugin))

    await store.setupScheduledTasks()
    const eventHandler = bridgeMocks.EventsOn.mock.calls[0]?.[1]
    eventHandler(eventLog)

    expect(logsStore.scheduledtasksLogs).toEqual([eventLog, workerLog])
    expect(store.scheduledtasks[0]?.lastTime).toBe(300)
  })

  it('clears frontend logs and the backend worker log store', async () => {
    setActivePinia(createPinia())
    const store = useScheduledTasksStore()
    const logsStore = useLogsStore()
    logsStore.scheduledtasksLogs.push(createLog(100))

    await store.clearScheduledTaskLogs()

    expect(logsStore.scheduledtasksLogs).toEqual([])
    expect(bridgeMocks.ClearScheduledTaskWorkerLogs).toHaveBeenCalledOnce()
  })

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

const createTask = (type: App.ScheduledTask['type']): App.ScheduledTask => ({
  id: 'task-1',
  name: 'Task',
  type,
  subscriptions: [],
  rulesets: [],
  plugins: [],
  script: '',
  cron: '* * * * * *',
  notification: false,
  disabled: false,
  lastTime: 0,
})

const createLog = (startTime: number) => ({
  id: 'task-1',
  name: 'Task',
  startTime,
  endTime: startTime + 10,
  result: [{ ok: true, result: 'updated' }],
})
