import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
const mocks = vi.hoisted(() => ({
  app: {} as any,
  subscriptions: {} as any,
  plugins: {} as any,
  profiles: {} as any,
  rulesets: {} as any,
  logs: [] as any[],
  event: undefined as undefined | ((record: any) => Promise<void>),
  status: vi.fn(),
  reload: vi.fn(),
  history: vi.fn(),
  record: vi.fn(),
  notify: vi.fn(),
  emit: vi.fn(),
  cron: vi.fn(function (_expression: string, callback: () => void) {
    return { stop: vi.fn(), callback }
  }),
}))
vi.mock('croner', () => ({ Cron: mocks.cron }))
vi.mock('@/bridge', () => ({
  EventsOn: vi.fn((_event: string, handler: typeof mocks.event) => {
    mocks.event = handler
    return vi.fn()
  }),
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
  Notify: mocks.notify,
  GetScheduledTaskWorkerLogs: mocks.history,
  GetScheduledTaskWorkerStatus: mocks.status,
  ReloadScheduledTaskWorker: mocks.reload,
  RecordScheduledTaskLog: mocks.record,
  RunScheduledTaskWorker: vi.fn(),
  ClearScheduledTaskWorkerLogs: vi.fn(),
}))
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: mocks.app }),
  useSubscribesStore: () => mocks.subscriptions,
  usePluginsStore: () => mocks.plugins,
  useProfilesStore: () => mocks.profiles,
  useRulesetsStore: () => mocks.rulesets,
  useLogsStore: () => ({
    get scheduledtasksLogs() {
      return mocks.logs
    },
    recordScheduledTasksLog: (log: any) => mocks.logs.unshift(log),
    hydrateScheduledTasksLogs: (logs: any[]) => {
      mocks.logs = logs
    },
  }),
}))
vi.mock('@/utils', () => ({
  stringifyNoFolding: JSON.stringify,
  eventBus: { emit: mocks.emit },
  ignoredError: async (fn: (...args: any[]) => any, ...args: any[]) => {
    try {
      return await fn(...args)
    } catch {
      return undefined
    }
  },
}))
import { RequestProxyMode, ScheduledTasksType } from '@/enums/app'

import { useScheduledTasksStore } from '../scheduledtasks'
const makeTask = (type = ScheduledTasksType.UpdateSubscription): App.ScheduledTask => ({
  id: 'task',
  name: 'Task',
  type,
  subscriptions: ['sub'],
  rulesets: ['rules'],
  plugins: ['plugin'],
  script: '',
  cron: '* * * * * *',
  notification: false,
  disabled: false,
  lastTime: 0,
})
const log = (type = ScheduledTasksType.UpdateSubscription, startTime = 10) => ({
  id: 'task',
  name: 'Task',
  type,
  source: 'backend',
  startTime,
  endTime: startTime + 1,
  result: [{ ok: true, result: 'done' }],
})
let store: ReturnType<typeof useScheduledTasksStore>
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  mocks.logs = []
  mocks.event = undefined
  mocks.app = reactive({ requestProxyMode: RequestProxyMode.System })
  mocks.subscriptions = reactive({
    subscribes: [] as any[],
    getSubscribeById: (id: string) =>
      mocks.subscriptions.subscribes.find((item: any) => item.id === id),
    reloadFromDisk: vi.fn().mockResolvedValue(undefined),
    updateSubscribe: vi.fn().mockResolvedValue('updated'),
  })
  mocks.plugins = reactive({
    plugins: [] as any[],
    getPluginById: vi.fn(),
    reloadFromDisk: vi.fn().mockResolvedValue(undefined),
  })
  mocks.profiles = reactive({
    profiles: [{ id: 'profile' }],
    reloadFromDisk: vi.fn().mockResolvedValue(undefined),
  })
  mocks.rulesets = { reloadFromDisk: vi.fn().mockResolvedValue(undefined) }
  mocks.history.mockResolvedValue([])
  mocks.reload.mockResolvedValue(undefined)
  mocks.status.mockResolvedValue({
    available: true,
    nodePath: '',
    supportedTypes: Object.values(ScheduledTasksType),
    managedTaskIds: [],
  })
  store = useScheduledTasksStore()
})
afterEach(() => {
  store.$dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('scheduled task ownership', () => {
  it('uses actual backend registration instead of globally supported task types', async () => {
    mocks.subscriptions.subscribes.push({ id: 'sub', requestProxyMode: RequestProxyMode.Kernel })
    store.scheduledtasks.push(makeTask())
    await store.setupScheduledTasks()
    expect(mocks.cron).toHaveBeenCalledOnce()
  })

  it('reconciles after a subscription finishes loading and stops local timers before backend reload', async () => {
    store.scheduledtasks.push(makeTask())
    await store.setupScheduledTasks()
    const first = mocks.cron.mock.results[0]!.value
    let release!: () => void
    mocks.reload.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    mocks.status.mockResolvedValue({
      available: true,
      nodePath: '',
      supportedTypes: [ScheduledTasksType.UpdateSubscription],
      managedTaskIds: ['task'],
    })
    mocks.subscriptions.subscribes.push({ id: 'sub', requestProxyMode: RequestProxyMode.None })
    await nextTick()
    await flushPromises()
    expect(first.stop).toHaveBeenCalledOnce()
    expect(mocks.cron).toHaveBeenCalledOnce()
    release()
    await flushPromises()
    expect(mocks.cron).toHaveBeenCalledOnce()

    mocks.status.mockResolvedValue({
      available: true,
      nodePath: '',
      supportedTypes: [ScheduledTasksType.UpdateSubscription],
      managedTaskIds: [],
    })
    mocks.subscriptions.subscribes[0].requestProxyMode = RequestProxyMode.Kernel
    await nextTick()
    await flushPromises()
    expect(mocks.cron).toHaveBeenCalledTimes(2)
  })

  it('does not start fallback timers after an unknown backend status', async () => {
    store.scheduledtasks.push(makeTask())
    mocks.status.mockRejectedValueOnce(new Error('offline'))
    await expect(store.setupScheduledTasks()).rejects.toThrow('offline')
    expect(mocks.cron).not.toHaveBeenCalled()
  })
})

it('retries failed ownership status and cancels retries when disposed', async () => {
  vi.useFakeTimers()
  store.scheduledtasks.push(makeTask())
  mocks.status.mockRejectedValueOnce(new Error('offline'))
  await expect(store.setupScheduledTasks()).rejects.toThrow('offline')
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.status).toHaveBeenCalledTimes(2)
  expect(mocks.cron).toHaveBeenCalledOnce()
  store.$dispose()
  await vi.advanceTimersByTimeAsync(30000)
  expect(mocks.status).toHaveBeenCalledTimes(2)
})

it('retries a failed metadata refresh when the completion is redelivered', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  mocks.subscriptions.reloadFromDisk.mockRejectedValueOnce(new Error('transient read error'))
  await store.setupScheduledTasks()
  await mocks.event!(log())
  await mocks.event!(log())
  expect(mocks.subscriptions.reloadFromDisk).toHaveBeenCalledTimes(2)
  expect(mocks.logs).toHaveLength(1)
  expect(warning).toHaveBeenCalledOnce()
})

describe('worker metadata synchronization', () => {
  it.each([
    [ScheduledTasksType.UpdateSubscription, 'subscriptions'],
    [ScheduledTasksType.UpdateAllSubscription, 'subscriptions'],
    [ScheduledTasksType.UpdateRuleset, 'rulesets'],
    [ScheduledTasksType.UpdateAllRuleset, 'rulesets'],
    [ScheduledTasksType.UpdatePlugin, 'plugins'],
    [ScheduledTasksType.UpdateAllPlugin, 'plugins'],
  ] as const)('reloads %s only once for duplicate completion events', async (type, target) => {
    store.scheduledtasks.push(makeTask(type))
    await store.setupScheduledTasks()
    await mocks.event!(log(type))
    await mocks.event!(log(type))
    expect(mocks[target].reloadFromDisk).toHaveBeenCalledOnce()
    if (target !== 'plugins')
      expect(mocks[target].reloadFromDisk).toHaveBeenCalledWith({ emitChanges: true })
    expect(mocks.logs).toHaveLength(1)
  })

  it('refreshes profiles and subscriptions before emitting change events for a sync task', async () => {
    const sequence: string[] = []
    mocks.profiles.reloadFromDisk.mockImplementation(async () => {
      sequence.push('profiles')
    })
    mocks.subscriptions.reloadFromDisk.mockImplementation(async () => {
      sequence.push('subscriptions')
    })
    mocks.emit.mockImplementation((event) => sequence.push(event))
    await store.setupScheduledTasks()
    await mocks.event!(log(ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs))
    expect(sequence).toEqual(['profiles', 'subscriptions', 'profileChange', 'subscriptionsChange'])
  })

  it('does not refresh stores for its own frontend completion echo or failed backend records', async () => {
    store.scheduledtasks.push(makeTask())
    await store.setupScheduledTasks()
    mocks.record.mockImplementation(async (record) => {
      await mocks.event!(record)
    })
    await store.runScheduledTask('task')
    await mocks.event!({ ...log(), result: [{ ok: false, result: 'failed' }] })
    expect(mocks.subscriptions.reloadFromDisk).not.toHaveBeenCalled()
    expect(mocks.logs).toHaveLength(2)
  })

  it('keeps a live event that arrives during history hydration without duplicate refresh', async () => {
    let resolveHistory!: (value: any[]) => void
    mocks.history.mockImplementationOnce(
      () =>
        new Promise<any[]>((resolve) => {
          resolveHistory = resolve
        }),
    )
    const setup = store.setupScheduledTasks()
    await flushPromises()
    await mocks.event!(log())
    resolveHistory([log()])
    await setup
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.subscriptions.reloadFromDisk).toHaveBeenCalledOnce()
  })
})

it('waits for an in-flight local task before giving its timer to the backend', async () => {
  store.scheduledtasks.push(makeTask())
  await store.setupScheduledTasks()
  let finish!: (value: string) => void
  mocks.subscriptions.updateSubscribe.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  const running = store.runScheduledTask('task')
  mocks.subscriptions.subscribes.push({ id: 'sub', requestProxyMode: RequestProxyMode.None })
  await nextTick()
  await flushPromises()
  expect(mocks.reload).toHaveBeenCalledOnce()
  finish('updated')
  await running
  await flushPromises()
  expect(mocks.reload).toHaveBeenCalledTimes(2)
})
