import * as App from "@wails/go/bridge/App";
import {
  IsNotificationAvailable,
  RequestNotificationAuthorization,
  SendNotification,
} from "@wails/runtime/runtime";

import { sampleID } from "@/utils";

import type { AppEnv } from "@/types/app";

export const RestartApp = App.RestartApp;

export const ExitApp = App.ExitApp;

export const ShowMainWindow = App.ShowMainWindow;

export const UpdateTray = App.UpdateTray;

export const UpdateTrayMenus = App.UpdateTrayMenus;

export const UpdateTrayAndMenus = App.UpdateTrayAndMenus;

export const GetEnv = <T extends string | undefined = undefined>(
  key?: T,
): Promise<T extends string ? string : AppEnv> => {
  return App.GetEnv(key || "");
};

export const IsStartup = App.IsStartup;

export const GetSystemProxy = async () => {
  const { flag, data } = await App.GetSystemProxy()
  if (!flag) {
    throw data
  }
  return data
}

export const SetSystemProxy = async (
  enable: boolean,
  server: string,
  proxyType: 'mixed' | 'http' | 'socks' = 'mixed',
  bypass = '',
  darwinServices: string[] = [],
) => {
  const { flag, data } = await App.SetSystemProxy(enable, server, proxyType, bypass, darwinServices)
  if (!flag) {
    throw data
  }
  return data
}

export const GetSystemProxyBypass = async () => {
  const { flag, data } = await App.GetSystemProxyBypass()
  if (!flag) {
    throw data
  }
  return data
}

export const GetInterfaces = async () => {
  const { flag, data } = await App.GetInterfaces();
  if (!flag) {
    throw data;
  }
  return data.split("|");
};

export interface ScheduledTaskWorkerStatus {
  available: boolean;
  nodePath: string;
  supportedTypes: string[];
}

export interface ScheduledTaskWorkerLogRecord {
  id?: string;
  name: string;
  startTime: number;
  endTime: number;
  result: { ok: boolean; result: string }[];
}

export const GetScheduledTaskWorkerStatus = async (): Promise<ScheduledTaskWorkerStatus> => {
  const { flag, data } = await App.GetScheduledTaskWorkerStatus();
  if (!flag) {
    throw data;
  }
  return JSON.parse(data || "{}") as ScheduledTaskWorkerStatus;
};

export const GetScheduledTaskWorkerLogs = async (): Promise<ScheduledTaskWorkerLogRecord[]> => {
  const { flag, data } = await App.GetScheduledTaskWorkerLogs();
  if (!flag) {
    throw data;
  }
  return JSON.parse(data || "[]") as ScheduledTaskWorkerLogRecord[];
};

export const ClearScheduledTaskWorkerLogs = async () => {
  const { flag, data } = await App.ClearScheduledTaskWorkerLogs();
  if (!flag) {
    throw data;
  }
  return data;
};

export const RecordScheduledTaskLog = async (record: ScheduledTaskWorkerLogRecord) => {
  const { flag, data } = await App.RecordScheduledTaskLog(JSON.stringify(record));
  if (!flag) {
    throw data;
  }
  return data;
};

export const ReloadScheduledTaskWorker = async () => {
  const { flag, data } = await App.ReloadScheduledTaskWorker();
  if (!flag) {
    throw data;
  }
  return data;
};

export const RunScheduledTaskWorker = async (id: string) => {
  const { flag, data } = await App.RunScheduledTaskWorker(id);
  if (!flag) {
    throw data;
  }
  return data;
};

export const Notify = async (title: string, body: string) => {
  if (!(await IsNotificationAvailable())) {
    throw new Error("Notifications not available on this platform");
  }
  await RequestNotificationAuthorization();
  await SendNotification({ id: sampleID(), title, body });
};
