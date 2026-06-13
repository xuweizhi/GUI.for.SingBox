import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { CoreApiLogsData } from "@/types/kernel";

interface TaskLogRecord<T = any> {
  id?: string
  name: string
  startTime: number
  endTime: number
  result: T
}

const inferKernelLogType = (line: string): CoreApiLogsData["type"] => {
  const type = line.match(/\b(trace|debug|info|warn|warning|error|fatal|panic)\b/i)?.[1];
  if (!type) return "info";
  return type.toLowerCase() === "warning"
    ? "warn"
    : (type.toLowerCase() as CoreApiLogsData["type"]);
};

const parseKernelLogLine = (line: string): CoreApiLogsData => ({
  type: inferKernelLogType(line),
  payload: line,
});

const formatKernelApiLog = ({ type, payload }: CoreApiLogsData) => `[${type}] ${payload}`;

export const useLogsStore = defineStore("logs", () => {
  const kernelLogs = ref<string[]>([]);
  const kernelApiLogs = ref<CoreApiLogsData[]>([]);
  const scheduledtasksLogs = ref<TaskLogRecord[]>([]);

  const recordKernelLog = (msg: string) => {
    kernelLogs.value.unshift(msg);
    kernelApiLogs.value.unshift(parseKernelLogLine(msg));
  };

  const recordKernelApiLog = (log: CoreApiLogsData) => {
    kernelLogs.value.unshift(formatKernelApiLog(log));
    kernelApiLogs.value.unshift(log);
  };

  const hydrateKernelLogs = (content: string) => {
    const nextKernelLogs = content
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter(Boolean)
      .reverse();

    kernelLogs.value = nextKernelLogs;
    kernelApiLogs.value = nextKernelLogs.map(parseKernelLogLine);
  };

  const recordScheduledTasksLog = (log: TaskLogRecord) => scheduledtasksLogs.value.unshift(log);

  const hydrateScheduledTasksLogs = (logs: TaskLogRecord[]) => {
    scheduledtasksLogs.value = logs;
  };

  const isTasksLogEmpty = computed(() => scheduledtasksLogs.value.length === 0);

  const isEmpty = computed(() => kernelLogs.value.length === 0);

  const clearKernelLog = () => {
    kernelLogs.value.splice(0);
    kernelApiLogs.value.splice(0);
  };

  return {
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
  };
});
