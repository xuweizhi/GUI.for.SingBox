import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { CoreApiLogsData } from '@/types/kernel'

interface TaskLogRecord<T = any> {
  id?: string
  name: string
  startTime: number
  endTime: number
  result: T
}

const inferKernelLogType = (line: string): CoreApiLogsData['type'] => {
  const type = line.match(/\b(trace|debug|info|warn|warning|error|fatal|panic)\b/i)?.[1]
  if (!type) return 'info'
  return type.toLowerCase() === 'warning' ? 'warn' : (type.toLowerCase() as CoreApiLogsData['type'])
}

export const parseKernelLogLine = (line: string): CoreApiLogsData => ({
  type: inferKernelLogType(line),
  payload: line,
})

const formatKernelApiLog = ({ type, payload }: CoreApiLogsData) => `[${type}] ${payload}`

export const useLogsStore = defineStore('logs', () => {
  const kernelLogs = ref<string[]>([])
  const kernelApiLogs = ref<CoreApiLogsData[]>([])
  const scheduledtasksLogs = ref<TaskLogRecord[]>([])

  const apiEntries = ref<CoreApiLogsData[]>([])
  const processEntries = ref<CoreApiLogsData[]>([])
  const limit = 2000
  let skipHydration = false
  const trimLogs = () => {
    if (kernelLogs.value.length > limit) kernelLogs.value.length = limit
    if (kernelApiLogs.value.length > limit) kernelApiLogs.value.length = limit
  }
  const recordKernelLog = (msg: string) => {
    processEntries.value.unshift({ ...parseKernelLogLine(msg), time: new Date().toISOString() })
    if (processEntries.value.length > limit) processEntries.value.length = limit
    kernelLogs.value.unshift(msg)
    kernelApiLogs.value.unshift(parseKernelLogLine(msg))
    trimLogs()
  }

  const recordKernelApiLog = (log: CoreApiLogsData) => {
    apiEntries.value.unshift({ ...log, time: log.time || new Date().toISOString() })
    if (apiEntries.value.length > limit) apiEntries.value.length = limit
    kernelLogs.value.unshift(formatKernelApiLog(log))
    kernelApiLogs.value.unshift(log)
    trimLogs()
  }

  const hydrateKernelLogs = (content: string, reload = false) => {
    if (reload) skipHydration = false
    if (skipHydration) return
    const nextKernelLogs = content
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter(Boolean)
      .slice(-limit)
      .reverse()

    kernelLogs.value = nextKernelLogs
    kernelApiLogs.value = nextKernelLogs.map(parseKernelLogLine)
    processEntries.value = kernelApiLogs.value.slice()
  }

  const recordScheduledTasksLog = (log: TaskLogRecord) => scheduledtasksLogs.value.unshift(log)

  const hydrateScheduledTasksLogs = (logs: TaskLogRecord[]) => {
    scheduledtasksLogs.value = logs
  }

  const isTasksLogEmpty = computed(() => scheduledtasksLogs.value.length === 0)

  const isEmpty = computed(() => kernelLogs.value.length === 0)

  const clearSource = (source: 'api' | 'core') => {
    if (source === 'api') apiEntries.value = []
    else {
      processEntries.value = []
      skipHydration = true
    }
  }
  const clearKernelLog = (userCleared = false) => {
    apiEntries.value = []
    processEntries.value = []
    skipHydration = userCleared

    kernelLogs.value.splice(0)
    kernelApiLogs.value.splice(0)
  }

  return {
    clearSource,
    apiEntries,
    processEntries,
    recordKernelLog,
    recordKernelApiLog,
    hydrateKernelLogs,
    clearKernelLog,
    kernelLogs,
    kernelApiLogs,
    isEmpty,
    scheduledtasksLogs,
    isTasksLogEmpty,
    recordScheduledTasksLog,
    hydrateScheduledTasksLogs,
  }
})
