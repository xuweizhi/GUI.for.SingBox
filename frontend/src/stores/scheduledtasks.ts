import { Cron } from "croner";
import { defineStore } from "pinia";
import { ref } from "vue";
import { parse } from "yaml";

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
} from "@/bridge";
import { DefaultSubscribeScript, ScheduledTasksFilePath } from "@/constant/app";
import {
  ScheduledTasksType,
  PluginTrigger,
  PluginTriggerEvent,
  RequestProxyMode,
} from "@/enums/app";
import {
  useAppSettingsStore,
  useSubscribesStore,
  useRulesetsStore,
  usePluginsStore,
  useLogsStore,
} from "@/stores";
import { ignoredError, stringifyNoFolding } from "@/utils";

import type { ScheduledTask } from "@/types/app";
import type { ScheduledTaskWorkerLogRecord, ScheduledTaskWorkerStatus } from "@/bridge";

export const useScheduledTasksStore = defineStore("scheduledtasks", () => {
  const scheduledtasks = ref<ScheduledTask[]>([]);
  const cronJobsMap: Recordable<Cron> = {};
  const appSettingsStore = useAppSettingsStore();
  const workerStatus = ref<ScheduledTaskWorkerStatus>({
    available: false,
    nodePath: "",
    supportedTypes: [],
  });

  let offScheduledTaskLog: null | (() => void) = null;

  const hasActiveSubscribePlugins = () => {
    const pluginsStore = usePluginsStore();
    return pluginsStore.plugins.some(
      (plugin) => !plugin.disabled && plugin.triggers.includes(PluginTrigger.OnSubscribe),
    );
  };

  const isPureSubscription = (id: string) => {
    const subscribesStore = useSubscribesStore();
    const subscribe = subscribesStore.getSubscribeById(id);
    if (!subscribe) return true;

    const script = subscribe.script.trim();
    if (script && script !== DefaultSubscribeScript.trim()) {
      return false;
    }

    const proxyMode =
      subscribe.requestProxyMode === RequestProxyMode.Global
        ? appSettingsStore.app.requestProxyMode
        : subscribe.requestProxyMode;

    return proxyMode !== RequestProxyMode.Kernel;
  };

  const canTaskRunInBackend = (task: ScheduledTask) => {
    switch (task.type) {
      case ScheduledTasksType.UpdateSubscription:
        return !hasActiveSubscribePlugins() && task.subscriptions.every(isPureSubscription);
      case ScheduledTasksType.UpdateAllSubscription: {
        const subscribesStore = useSubscribesStore();
        return (
          !hasActiveSubscribePlugins() &&
          subscribesStore.subscribes
            .filter((item) => !item.disabled)
            .every((item) => isPureSubscription(item.id))
        );
      }
      case ScheduledTasksType.UpdatePlugin:
      case ScheduledTasksType.UpdateAllPlugin:
        return appSettingsStore.app.requestProxyMode !== RequestProxyMode.Kernel;
      case ScheduledTasksType.RunPlugin: {
        const pluginsStore = usePluginsStore();
        return task.plugins.every((id) => {
          const plugin = pluginsStore.getPluginById(id);
          return plugin ? !plugin.hasUI : true;
        });
      }
      default:
        return true;
    }
  };

  const isHandledByWorker = (taskOrType: ScheduledTask | ScheduledTask["type"]) => {
    const type = typeof taskOrType === "string" ? taskOrType : taskOrType.type;
    const available =
      workerStatus.value.available && workerStatus.value.supportedTypes.includes(type);
    if (!available) return false;
    return typeof taskOrType === "string" ? true : canTaskRunInBackend(taskOrType);
  };

  const refreshWorkerStatus = async () => {
    workerStatus.value = (await ignoredError(GetScheduledTaskWorkerStatus)) || {
      available: false,
      nodePath: "",
      supportedTypes: [],
    };
  };

  const refreshLocalCronJobs = () => {
    Object.keys(cronJobsMap).forEach((id) => {
      cronJobsMap[id]?.stop();
      delete cronJobsMap[id];
    });

    scheduledtasks.value.forEach((task) => {
      if (!task.disabled && !isHandledByWorker(task)) {
        cronJobsMap[task.id] = new Cron(task.cron, () => runScheduledTask(task.id));
      }
    });
  };

  const bindScheduledTaskLogEvent = () => {
    if (offScheduledTaskLog) return;
    const logsStore = useLogsStore();
    offScheduledTaskLog = EventsOn(
      "scheduledTaskLog",
      (entry?: ScheduledTaskWorkerLogRecord | ScheduledTaskWorkerLogRecord[]) => {
        const records = Array.isArray(entry) ? entry : entry ? [entry] : [];
        records.forEach((record) => {
          logsStore.recordScheduledTasksLog(record);
          if (record.id) {
            const task = getScheduledTaskById(record.id);
            if (task) {
              task.lastTime = record.startTime;
            }
          }
        });
      },
    );
  };

  const hydrateWorkerLogs = async () => {
    const logsStore = useLogsStore();
    const workerLogs = workerStatus.value.available
      ? ((await ignoredError(GetScheduledTaskWorkerLogs)) ?? [])
      : [];
    logsStore.hydrateScheduledTasksLogs(workerLogs);
  };

  const setupScheduledTasks = async () => {
    const data = await ignoredError(ReadFile, ScheduledTasksFilePath);
    data && (scheduledtasks.value = parse(data));

    await refreshWorkerStatus();
    bindScheduledTaskLogEvent();
    await hydrateWorkerLogs();
    refreshLocalCronJobs();
  };

  const runScheduledTaskLocally = async (id: string) => {
    const task = getScheduledTaskById(id);
    if (!task) return;

    const logsStore = useLogsStore();

    task.lastTime = Date.now();

    const startTime = Date.now();
    const result = await getTaskFn(task)();

    if (task.notification) {
      const successes = result.filter((v) => v.ok).length;
      const failures = result.length - successes;
      const details = result.flatMap((v) => v.result).join("\n");
      const content = `Successes: ${successes}; Failures: ${failures}. \n\n${details}`;
      Notify(task.name, content);
    }

    logsStore.recordScheduledTasksLog({
      id: task.id,
      name: task.name,
      startTime,
      endTime: Date.now(),
      result: result,
    });

    await editScheduledTask(id, task, { reloadWorker: false });
  };

  const runScheduledTask = async (id: string) => {
    const task = getScheduledTaskById(id);
    if (!task) return;

    if (isHandledByWorker(task)) {
      await RunScheduledTaskWorker(id);
      return;
    }

    await runScheduledTaskLocally(id);
  };

  const withOutput = <T>(list: string[], fn: (id: string) => Promise<T>) => {
    return async () => {
      const output: { ok: boolean; result: T }[] = [];
      for (const id of list) {
        try {
          const result = await fn(id);
          if (Array.isArray(result)) {
            output.push(...result);
          } else {
            output.push({ ok: true, result });
          }
        } catch (error: any) {
          output.push({ ok: false, result: error.message || error });
        }
      }
      return output;
    };
  };

  const getTaskFn = (task: ScheduledTask) => {
    switch (task.type) {
      case ScheduledTasksType.UpdateSubscription: {
        const subscribesStore = useSubscribesStore();
        return withOutput(task.subscriptions, subscribesStore.updateSubscribe);
      }
      case ScheduledTasksType.UpdateRuleset: {
        const rulesetsStore = useRulesetsStore();
        return withOutput(task.rulesets, rulesetsStore.updateRuleset);
      }
      case ScheduledTasksType.UpdatePlugin: {
        const pluginsStores = usePluginsStore();
        return withOutput(task.plugins, pluginsStores.updatePlugin);
      }
      case ScheduledTasksType.UpdateAllSubscription: {
        const subscribesStore = useSubscribesStore();
        return withOutput(["0"], () => subscribesStore.updateSubscribes());
      }
      case ScheduledTasksType.UpdateAllRuleset: {
        const rulesetsStore = useRulesetsStore();
        return withOutput(["1"], () => rulesetsStore.updateRulesets());
      }
      case ScheduledTasksType.UpdateAllPlugin: {
        const pluginsStores = usePluginsStore();
        return withOutput(["2"], () => pluginsStores.updatePlugins());
      }
      case ScheduledTasksType.RunPlugin: {
        const pluginsStores = usePluginsStore();
        return withOutput(task.plugins, async (id: string) =>
          pluginsStores.manualTrigger(id, PluginTriggerEvent.OnTask),
        );
      }
      case ScheduledTasksType.RunScript: {
        return withOutput([task.script], (script: string) => new window.AsyncFunction(script)());
      }
    }
  };

  const saveScheduledTasks = async (options: { reloadWorker?: boolean } = {}) => {
    await WriteFile(ScheduledTasksFilePath, stringifyNoFolding(scheduledtasks.value));
    if (options.reloadWorker !== false) {
      await ignoredError(ReloadScheduledTaskWorker);
      await refreshWorkerStatus();
    }
    refreshLocalCronJobs();
  };

  const addScheduledTask = async (s: ScheduledTask) => {
    scheduledtasks.value.push(s);
    try {
      await saveScheduledTasks();
    } catch (error) {
      const idx = scheduledtasks.value.indexOf(s);
      if (idx !== -1) {
        scheduledtasks.value.splice(idx, 1);
      }
      refreshLocalCronJobs();
      throw error;
    }
  };

  const deleteScheduledTask = async (id: string) => {
    const idx = scheduledtasks.value.findIndex((v) => v.id === id);
    if (idx === -1) return;
    const backup = scheduledtasks.value.splice(idx, 1)[0]!;
    try {
      await saveScheduledTasks();
    } catch (error) {
      scheduledtasks.value.splice(idx, 0, backup);
      refreshLocalCronJobs();
      throw error;
    }
  };

  const editScheduledTask = async (
    id: string,
    s: ScheduledTask,
    options: { reloadWorker?: boolean } = {},
  ) => {
    const idx = scheduledtasks.value.findIndex((v) => v.id === id);
    if (idx === -1) return;
    const backup = scheduledtasks.value.splice(idx, 1, s)[0]!;
    try {
      await saveScheduledTasks(options);
    } catch (error) {
      scheduledtasks.value.splice(idx, 1, backup);
      refreshLocalCronJobs();
      throw error;
    }
  };

  const clearScheduledTaskLogs = async () => {
    const logsStore = useLogsStore();
    logsStore.scheduledtasksLogs.splice(0);
    if (workerStatus.value.available) {
      await ignoredError(ClearScheduledTaskWorkerLogs);
    }
  };

  const getScheduledTaskById = (id: string) => scheduledtasks.value.find((v) => v.id === id);

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
  };
});
