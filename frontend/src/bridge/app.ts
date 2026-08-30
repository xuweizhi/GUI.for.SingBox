import * as Bridge from '@/bridge/browser/go/bridge/App'
import {
  IsNotificationAvailable,
  RequestNotificationAuthorization,
  SendNotification,
} from '@/bridge/browser/runtime/runtime'

import { sampleID } from '@/utils'

export const RestartApp = Bridge.RestartApp

export const GetEnv = (): Promise<App.AppEnv> => Bridge.GetEnv()

export const IsStartup = Bridge.IsStartup

export const GetSystemProxy = async () => {
  const { flag, data } = await Bridge.GetSystemProxy()
  if (!flag) {
    throw data
  }
  return data
}

export const GetSystemProxyBypass = async () => {
  const { flag, data } = await Bridge.GetSystemProxyBypass()
  if (!flag) {
    throw data
  }
  return data
}

export const GetInterfaces = async () => {
  const { flag, data } = await Bridge.GetInterfaces()
  if (!flag) {
    throw data
  }
  return data.split('|')
}

export interface ScheduledTaskWorkerStatus {
  available: boolean
  nodePath: string
  supportedTypes: string[]
}

export interface ScheduledTaskWorkerLogRecord {
  id?: string
  name: string
  startTime: number
  endTime: number
  result: { ok: boolean; result: string }[]
}

export const GetScheduledTaskWorkerStatus = async (): Promise<ScheduledTaskWorkerStatus> => {
  const { flag, data } = await Bridge.GetScheduledTaskWorkerStatus()
  if (!flag) {
    throw data
  }
  return JSON.parse(data || '{}') as ScheduledTaskWorkerStatus
}

export const GetScheduledTaskWorkerLogs = async (): Promise<ScheduledTaskWorkerLogRecord[]> => {
  const { flag, data } = await Bridge.GetScheduledTaskWorkerLogs()
  if (!flag) {
    throw data
  }
  return JSON.parse(data || '[]') as ScheduledTaskWorkerLogRecord[]
}

export const ClearScheduledTaskWorkerLogs = async () => {
  const { flag, data } = await Bridge.ClearScheduledTaskWorkerLogs()
  if (!flag) {
    throw data
  }
  return data
}

export const RecordScheduledTaskLog = async (record: ScheduledTaskWorkerLogRecord) => {
  const { flag, data } = await Bridge.RecordScheduledTaskLog(JSON.stringify(record))
  if (!flag) {
    throw data
  }
  return data
}

export const ReloadScheduledTaskWorker = async () => {
  const { flag, data } = await Bridge.ReloadScheduledTaskWorker()
  if (!flag) {
    throw data
  }
  return data
}

export const RunScheduledTaskWorker = async (id: string) => {
  const { flag, data } = await Bridge.RunScheduledTaskWorker(id)
  if (!flag) {
    throw data
  }
  return data
}

export const Notify = async (title: string, body: string) => {
  if (!(await IsNotificationAvailable())) {
    throw new Error('Notifications not available on this platform')
  }
  await RequestNotificationAuthorization()
  await SendNotification({ id: sampleID(), title, body })
}
