<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLogsStore, useScheduledTasksStore } from '@/stores'
import { buildSmartRegExp, confirm, formatDate, message } from '@/utils'

import type { Column } from '@/components/Table/index.vue'

interface Props {
  id?: string
}

const props = withDefaults(defineProps<Props>(), { id: '' })

const { t } = useI18n()
const logsStore = useLogsStore()
const scheduledTasksStore = useScheduledTasksStore()

const selectedTaskId = ref(props.id || '')
const keywords = ref('')

const columns: Column[] = [
  {
    title: 'scheduledtask.name',
    align: 'center',
    key: 'name',
  },
  {
    title: 'scheduledtasks.startTime',
    align: 'center',
    key: 'startTime',
    sort: (a, b) => a.startTime - b.startTime,
    customRender: ({ value }) => formatDate(value, 'YYYY-MM-DD HH:mm:ss'),
  },
  {
    title: 'scheduledtasks.endTime',
    align: 'center',
    key: 'endTime',
    customRender: ({ value }) => formatDate(value, 'YYYY-MM-DD HH:mm:ss'),
  },
  {
    title: 'scheduledtasks.duration',
    align: 'center',
    key: 'duration',
    sort: (a, b) => a.endTime - a.startTime - (b.endTime - b.startTime),
    customRender: ({ record }) => {
      return ((record.endTime - record.startTime) / 1000).toFixed(2) + 's'
    },
  },
  {
    title: 'scheduledtasks.result',
    align: 'center',
    key: 'result',
  },
]

const taskOptions = computed(() =>
  [{ label: 'workspace.all', value: '' }].concat(
    scheduledTasksStore.scheduledtasks.map((v) => ({
      label: v.name,
      value: v.id,
    })),
  ),
)

const filteredLogs = computed(() => {
  const q = keywords.value.trim()
  const matcher = q ? buildSmartRegExp(q, 'i') : null
  const selectedTask = selectedTaskId.value
    ? scheduledTasksStore.getScheduledTaskById(selectedTaskId.value)
    : undefined
  return logsStore.scheduledtasksLogs
    .filter((v) => {
      const hitTask = selectedTaskId.value
        ? v.id
          ? v.id === selectedTaskId.value
          : Boolean(selectedTask && v.name === selectedTask.name)
        : true
      if (!hitTask) return false
      if (!matcher) return true
      const text = Array.isArray(v.result)
        ? v.result.map((entry: any) => String(entry?.result ?? entry ?? '')).join(' ')
        : String(v.result ?? '')
      return matcher.test(v.name) || matcher.test(text)
    })
    .map((v, idx) => ({
      ...v,
      _rowKey: `${v.id || v.name}-${v.startTime}-${v.endTime}-${idx}`,
    }))
})

const clearLogs = async () => {
  if (logsStore.scheduledtasksLogs.length === 0) return
  const ok = await confirm(
    t('common.clear'),
    t('common.confirmClear', [t('scheduledtasks.logs')]),
    { type: 'text', danger: true, okText: 'common.clear' },
  ).then(
    () => true,
    () => false,
  )
  if (ok) await scheduledTasksStore.clearScheduledTaskLogs().catch(message.error)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-8">
      <span class="text-12 text-muted"> {{ t('scheduledtask.name') }}: </span>
      <Select v-model="selectedTaskId" :options="taskOptions" size="small" />
      <Input
        v-model="keywords"
        clearable
        size="small"
        :placeholder="t('common.keywords')"
        class="flex-1 min-w-160"
      />
      <Button
        v-tips="'common.clear'"
        :aria-label="t('common.clear')"
        :disabled="logsStore.scheduledtasksLogs.length === 0"
        icon="clear"
        size="small"
        type="text"
        @click="clearLogs"
      />
    </div>

    <div
      v-if="filteredLogs.length === 0"
      class="flex-1 flex flex-col items-center justify-center gap-8"
    >
      <Empty />
      <Button
        v-if="keywords.trim() || selectedTaskId"
        size="small"
        @click="
          () => {
            keywords = ''
            selectedTaskId = ''
          }
        "
      >
        {{ t('workspace.clearFilters') }}
      </Button>
    </div>

    <Table
      v-else
      :columns="columns"
      :data-source="filteredLogs"
      sort="startTime"
      class="mt-8"
    >
      <template #result="{ record }">
        <div class="flex flex-col gap-6 text-left">
          <div
            v-for="(item, index) in record.result"
            :key="`${record._rowKey}-${index}`"
            class="break-all"
          >
            <span :style="{ color: item.ok ? 'var(--success-color)' : 'var(--danger-color)' }"
              >●</span
            >
            {{ item.result }}
          </div>
        </div>
      </template>
    </Table>
  </div>
</template>
