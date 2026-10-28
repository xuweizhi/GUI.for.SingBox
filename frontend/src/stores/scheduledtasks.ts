import { Cron } from 'croner'
import { defineStore } from 'pinia'
import { ref, watch, onScopeDispose } from 'vue'
import { parse } from 'yaml'

import {
  EventsOn,
  ReadFile,
  WriteFile,
  Notify,
  GetScheduledTaskWorkerLogs,
  GetScheduledTaskWorkerStatus,
  ReloadScheduledTaskWorker,
  RunScheduledTaskWorker,
  ClearScheduledTaskWorkerLogs,
  RecordScheduledTaskLog,
} from '@/bridge'
import { ScheduledTasksFilePath } from '@/constant/app'
import { ScheduledTasksType, PluginTriggerEvent, RequestProxyMode } from '@/enums/app'
import {
  useAppSettingsStore,
  useSubscribesStore,
  useRulesetsStore,
  usePluginsStore,
  useLogsStore,
  useProfilesStore,
} from '@/stores'
import { eventBus, ignoredError, stringifyNoFolding } from '@/utils'

import type { ScheduledTaskWorkerLogRecord, ScheduledTaskWorkerStatus } from '@/bridge'

type ScheduledTaskLog = {
  id: string
  name: string
  startTime: number
  endTime: number
  result: { ok: boolean; result: unknown }[] | { ok: boolean; result: string }[]
}

export const useScheduledTasksStore = defineStore('scheduledtasks', () => {
  const scheduledtasks = ref<App.ScheduledTask[]>([])
  const cronJobsMap: Recordable<Cron> = {}
  const appSettingsStore = useAppSettingsStore()
  const workerStatus = ref<ScheduledTaskWorkerStatus>({
    available: false,
    nodePath: '',
    supportedTypes: [],
  })

  let offScheduledTaskLog: null | (() => void) = null
  const localRuns = new Map<string, Promise<ScheduledTaskLog | undefined>>()
  let initialized = false
  let disposed = false
  let ownershipQueue: Promise<void> = Promise.resolve()
  let refreshQueue: Promise<void> = Promise.resolve()
  const seenLogs = new Set<string>()
  const ownLogs = new Set<string>()
  const failedMetadataLogs = new Map<string, ScheduledTaskWorkerLogRecord>()
  let ownershipRetry: ReturnType<typeof setTimeout> | undefined
  let ownershipRetryDelay = 1000
  let metadataRetry: ReturnType<typeof setTimeout> | undefined
  const logKey = (record: Pick<ScheduledTaskWorkerLogRecord, 'id' | 'startTime' | 'endTime'>) =>
    `${record.id}:${record.startTime}:${record.endTime}`
  const rememberLog = (key: string) => {
    seenLogs.add(key)
    if (seenLogs.size > 1000) seenLogs.delete(seenLogs.values().next().value!)
  }

  const isPureSubscription = (id: string) => {
    const subscribesStore = useSubscribesStore()
    const subscribe = subscribesStore.getSubscribeById(id)
    if (!subscribe) return true

    const proxyMode =
      subscribe.requestProxyMode === RequestProxyMode.Global
        ? appSettingsStore.app.requestProxyMode
        : subscribe.requestProxyMode

    return proxyMode !== RequestProxyMode.Kernel
  }

  const canTaskRunInBackend = (task: App.ScheduledTask) => {
    switch (task.type) {
      case ScheduledTasksType.UpdateSubscription:
        return task.subscriptions.every(isPureSubscription)
      case ScheduledTasksType.UpdateAllSubscription:
      case ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs: {
        const subscribesStore = useSubscribesStore()
        return subscribesStore.subscribes
          .filter((item) => !item.disabled)
          .every((item) => isPureSubscription(item.id))
      }
      case ScheduledTasksType.UpdatePlugin:
      case ScheduledTasksType.UpdateAllPlugin:
        return appSettingsStore.app.requestProxyMode !== RequestProxyMode.Kernel
      case ScheduledTasksType.RunPlugin: {
        const pluginsStore = usePluginsStore()
        return task.plugins.every((id) => {
          const plugin = pluginsStore.getPluginById(id)
          return plugin ? !plugin.hasUI : true
        })
      }
      default:
        return true
    }
  }

  const isHandledByWorker = (taskOrType: App.ScheduledTask | App.ScheduledTask['type']) => {
    const type = typeof taskOrType === 'string' ? taskOrType : taskOrType.type
    const available =
      workerStatus.value.available && workerStatus.value.supportedTypes.includes(type)
    if (!available) return false
    if (typeof taskOrType === 'string') return true
    if (workerStatus.value.managedTaskIds)
      return workerStatus.value.managedTaskIds.includes(taskOrType.id)
    return canTaskRunInBackend(taskOrType)
  }

  const refreshWorkerStatus = async () => {
    workerStatus.value = await GetScheduledTaskWorkerStatus()
  }

  const stopLocalCronJobs = () => {
    Object.keys(cronJobsMap).forEach((id) => {
      cronJobsMap[id]?.stop()
      delete cronJobsMap[id]
    })
  }

  const refreshLocalCronJobs = () => {
    stopLocalCronJobs()
    if (disposed) return
    scheduledtasks.value.forEach((task) => {
      if (!task.disabled && !isHandledByWorker(task)) {
        cronJobsMap[task.id] = new Cron(task.cron, () => {
          void runScheduledTask(task.id).catch((error) =>
            console.warn('Scheduled task failed:', error),
          )
        })
      }
    })
  }

  const reconcileOwnership = (reloadWorker = true) => {
    const reconcile = async () => {
      if (disposed) return
      clearTimeout(ownershipRetry)
      ownershipRetry = undefined
      // Stop local timers before the backend can claim their tasks.
      stopLocalCronJobs()
      try {
        await Promise.allSettled(localRuns.values())
        if (disposed) return
        if (reloadWorker) await ReloadScheduledTaskWorker()
        await refreshWorkerStatus()
        refreshLocalCronJobs()
        ownershipRetryDelay = 1000
      } catch (error) {
        if (!disposed) {
          ownershipRetry = setTimeout(() => {
            void reconcileOwnership(reloadWorker).catch(() => undefined)
          }, ownershipRetryDelay)
          ownershipRetryDelay = Math.min(ownershipRetryDelay * 2, 30000)
        }
        throw error
      }
    }
    const result = ownershipQueue.then(reconcile, reconcile)
    ownershipQueue = result.catch(() => undefined)
    return result
  }

  const refreshTaskMetadata = async (record: ScheduledTaskWorkerLogRecord) => {
    if (!record.result.some((item) => item.ok)) return
    const type = record.type || getScheduledTaskById(record.id || '')?.type
    switch (type) {
      case ScheduledTasksType.UpdateSubscription:
      case ScheduledTasksType.UpdateAllSubscription:
        await useSubscribesStore().reloadFromDisk({ emitChanges: true })
        break
      case ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs: {
        const subscribes = useSubscribesStore()
        const profiles = useProfilesStore()
        const ids = new Set(subscribes.subscribes.map((item) => item.id))
        const profileIds = new Set(profiles.profiles.map((item) => item.id))
        await profiles.reloadFromDisk()
        await subscribes.reloadFromDisk()
        subscribes.subscribes.forEach((item) => ids.add(item.id))
        profiles.profiles.forEach((item) => profileIds.add(item.id))
        // Publish only after both related stores contain the committed backend state.
        profileIds.forEach((id) => eventBus.emit('profileChange', { id }))
        eventBus.emit('subscriptionsChange', { ids: [...ids] })
        break
      }
      case ScheduledTasksType.UpdateRuleset:
      case ScheduledTasksType.UpdateAllRuleset:
        await useRulesetsStore().reloadFromDisk({ emitChanges: true })
        break
      case ScheduledTasksType.UpdatePlugin:
      case ScheduledTasksType.UpdateAllPlugin:
      case ScheduledTasksType.RunPlugin:
        await usePluginsStore().reloadFromDisk()
        break
    }
  }

  const queueMetadataRefresh = (record: ScheduledTaskWorkerLogRecord, key: string) => {
    failedMetadataLogs.delete(key)
    refreshQueue = refreshQueue
      .then(async () => {
        if (!disposed) await refreshTaskMetadata(record)
      })
      .catch((error) => {
        console.warn('Failed to refresh scheduled task metadata:', error)
        if (disposed) return
        failedMetadataLogs.set(key, record)
        if (!metadataRetry)
          metadataRetry = setTimeout(() => {
            metadataRetry = undefined
            for (const [failedKey, failedRecord] of failedMetadataLogs) {
              queueMetadataRefresh(failedRecord, failedKey)
            }
          }, 3000)
      })
  }

  const bindScheduledTaskLogEvent = () => {
    if (offScheduledTaskLog) return
    const logsStore = useLogsStore()
    offScheduledTaskLog = EventsOn(
      'scheduledTaskLog',
      (entry?: ScheduledTaskWorkerLogRecord | ScheduledTaskWorkerLogRecord[]) => {
        const records = Array.isArray(entry) ? entry : entry ? [entry] : []
        records.forEach((record) => {
          const key = logKey(record)
          if (seenLogs.has(key)) {
            if (failedMetadataLogs.has(key)) queueMetadataRefresh(record, key)
            return
          }
          rememberLog(key)
          if (!ownLogs.delete(key)) {
            queueMetadataRefresh(record, key)
          }
          logsStore.recordScheduledTasksLog(record)
          if (record.id) {
            const task = getScheduledTaskById(record.id)
            if (task) {
              task.lastTime = record.startTime
              if (task.notification) {
                const successes = record.result.filter((item) => item.ok).length
                const failures = record.result.length - successes
                const details = record.result.map((item) => String(item.result)).join('\n')
                const content = `Successes: ${successes}; Failures: ${failures}.\n\n${details}`
                void Notify(task.name, content).catch((error) => {
                  console.warn('Failed to show scheduled task notification:', error)
                })
              }
            }
          }
        })
        return refreshQueue
      },
    )
  }

  const hydrateWorkerLogs = async () => {
    const logsStore = useLogsStore()
    const workerLogs = (await ignoredError(GetScheduledTaskWorkerLogs)) ?? []
    const merged = new Map<string, ScheduledTaskWorkerLogRecord>()
    for (const record of [...workerLogs, ...logsStore.scheduledtasksLogs]) {
      const key = logKey(record)
      rememberLog(key)
      merged.set(key, record)
    }
    logsStore.hydrateScheduledTasksLogs(
      [...merged.values()].sort((a, b) => b.startTime - a.startTime),
    )
  }

  const setupScheduledTasks = async () => {
    const data = await ignoredError(ReadFile, ScheduledTasksFilePath)
    data && (scheduledtasks.value = parse(data))

    bindScheduledTaskLogEvent()
    await hydrateWorkerLogs()
    initialized = true
    await reconcileOwnership()
  }

  const runScheduledTaskLocally = async (id: string): Promise<ScheduledTaskLog | undefined> => {
    const task = getScheduledTaskById(id)
    if (!task) return

    const previousLastTime = task.lastTime
    const startTime = Date.now()
    task.lastTime = startTime
    let recorded = false

    try {
      const result = await getTaskFn(task)()

      const log = {
        id: task.id,
        name: task.name,
        type: task.type,
        source: 'frontend' as const,
        startTime,
        endTime: Date.now(),
        result,
      }

      const key = logKey(log)
      ownLogs.add(key)
      if (ownLogs.size > 1000) ownLogs.delete(ownLogs.values().next().value!)
      try {
        await RecordScheduledTaskLog(log)
      } catch (error) {
        ownLogs.delete(key)
        throw error
      }
      recorded = true

      return log
    } catch (error) {
      if (!recorded) {
        task.lastTime = previousLastTime
      }
      throw error
    }
  }

  const runScheduledTask = async (id: string) => {
    const task = getScheduledTaskById(id)
    if (!task) return

    if (isHandledByWorker(task)) {
      await RunScheduledTaskWorker(id)
      const logs = (await ignoredError(GetScheduledTaskWorkerLogs)) ?? []
      return logs.find((log) => log.id === id)
    }

    const running = localRuns.get(id)
    if (running) return running
    const result = runScheduledTaskLocally(id).finally(() => localRuns.delete(id))
    localRuns.set(id, result)
    return result
  }

  const withOutput = <T>(list: string[], fn: (id: string) => Promise<T>) => {
    return async () => {
      const output: { ok: boolean; result: T }[] = []
      for (const id of list) {
        try {
          const result = await fn(id)
          if (Array.isArray(result)) {
            output.push(...result)
          } else {
            output.push({ ok: true, result })
          }
        } catch (error: any) {
          output.push({ ok: false, result: error.message || error })
        }
      }
      return output
    }
  }

  const getTaskFn = (task: App.ScheduledTask) => {
    switch (task.type) {
      case ScheduledTasksType.UpdateSubscription: {
        const subscribesStore = useSubscribesStore()
        return withOutput(task.subscriptions, subscribesStore.updateSubscribe)
      }
      case ScheduledTasksType.UpdateRuleset: {
        const rulesetsStore = useRulesetsStore()
        return withOutput(task.rulesets, rulesetsStore.updateRuleset)
      }
      case ScheduledTasksType.UpdatePlugin: {
        const pluginsStores = usePluginsStore()
        return withOutput(task.plugins, pluginsStores.updatePlugin)
      }
      case ScheduledTasksType.UpdateAllSubscription: {
        const subscribesStore = useSubscribesStore()
        return withOutput(['0'], () => subscribesStore.updateSubscribes())
      }
      case ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs: {
        const subscribesStore = useSubscribesStore()
        return async () => {
          const output = await subscribesStore.updateSubscribes()
          const syncResult = await subscribesStore.syncSubscribeOutboundRefs()
          return [
            ...output.map((item) => ({ ok: item.ok, result: item.result })),
            {
              ok: true,
              result: `Subscription outbound refs synced. Added: ${syncResult.added}; Removed: ${syncResult.removed}.`,
            },
          ]
        }
      }
      case ScheduledTasksType.UpdateAllRuleset: {
        const rulesetsStore = useRulesetsStore()
        return withOutput(['1'], () => rulesetsStore.updateRulesets())
      }
      case ScheduledTasksType.UpdateAllPlugin: {
        const pluginsStores = usePluginsStore()
        return withOutput(['2'], () => pluginsStores.updatePlugins())
      }
      case ScheduledTasksType.RunPlugin: {
        const pluginsStores = usePluginsStore()
        return withOutput(task.plugins, async (id: string) =>
          pluginsStores.manualTrigger(id, PluginTriggerEvent.OnTask),
        )
      }
      case ScheduledTasksType.RunScript:
        return withOutput([task.script], (script: string) => new window.AsyncFunction(script)())
      default:
        throw new Error('Unsupported scheduled task type: ' + task.type)
    }
  }

  const saveScheduledTasks = async (options: { reloadWorker?: boolean } = {}) => {
    await WriteFile(ScheduledTasksFilePath, stringifyNoFolding(scheduledtasks.value))
    if (options.reloadWorker !== false) {
      await reconcileOwnership().catch((error) =>
        console.warn('Failed to refresh scheduled task ownership:', error),
      )
    } else {
      refreshLocalCronJobs()
    }
  }

  const addScheduledTask = async (s: App.ScheduledTask) => {
    scheduledtasks.value.push(s)
    try {
      await saveScheduledTasks()
    } catch (error) {
      const idx = scheduledtasks.value.indexOf(s)
      if (idx !== -1) {
        scheduledtasks.value.splice(idx, 1)
      }
      refreshLocalCronJobs()
      throw error
    }
  }

  const deleteScheduledTask = async (id: string) => {
    const idx = scheduledtasks.value.findIndex((v) => v.id === id)
    if (idx === -1) return
    const backup = scheduledtasks.value.splice(idx, 1)[0]!
    try {
      await saveScheduledTasks()
    } catch (error) {
      scheduledtasks.value.splice(idx, 0, backup)
      refreshLocalCronJobs()
      throw error
    }
  }

  const editScheduledTask = async (
    id: string,
    s: App.ScheduledTask,
    options: { reloadWorker?: boolean } = {},
  ) => {
    const idx = scheduledtasks.value.findIndex((v) => v.id === id)
    if (idx === -1) return
    const backup = scheduledtasks.value.splice(idx, 1, s)[0]!
    try {
      await saveScheduledTasks(options)
    } catch (error) {
      scheduledtasks.value.splice(idx, 1, backup)
      refreshLocalCronJobs()
      throw error
    }
  }

  const clearScheduledTaskLogs = async () => {
    const logsStore = useLogsStore()
    logsStore.scheduledtasksLogs.splice(0)
    await ignoredError(ClearScheduledTaskWorkerLogs)
  }

  const getScheduledTaskById = (id: string) => scheduledtasks.value.find((v) => v.id === id)

  watch(
    () =>
      JSON.stringify({
        proxy: appSettingsStore.app.requestProxyMode,
        subscriptions: useSubscribesStore().subscribes.map(
          ({ id, disabled, requestProxyMode, customProxy }) => ({
            id,
            disabled,
            requestProxyMode,
            customProxy,
          }),
        ),
        plugins: usePluginsStore().plugins.map(({ id, disabled, hasUI }) => ({
          id,
          disabled,
          hasUI,
        })),
      }),
    () => {
      if (initialized)
        void reconcileOwnership().catch((error) =>
          console.warn('Failed to refresh scheduled task ownership:', error),
        )
    },
  )

  onScopeDispose(() => {
    disposed = true
    clearTimeout(ownershipRetry)
    clearTimeout(metadataRetry)
    stopLocalCronJobs()
    offScheduledTaskLog?.()
  })

  return {
    scheduledtasks,
    workerStatus,
    setupScheduledTasks,
    saveScheduledTasks,
    addScheduledTask,
    editScheduledTask,
    deleteScheduledTask,
    clearScheduledTaskLogs,
    getScheduledTaskById,
    getTaskFn,
    runScheduledTask,
  }
})
