<script setup lang="ts">
import { Cron } from 'croner'
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { View } from '@/enums/app'
import { useAppSettingsStore, useScheduledTasksStore } from '@/stores'
import {
  confirm,
  debounce,
  formatRelativeTime,
  formatDate,
  message,
  previewCode,
  modal,
} from '@/utils'

import ResourceActions from '@/components/_common/ResourceActions.vue'
import ResourcePageShell from '@/components/_common/ResourcePageShell.vue'

import ScheduledTaskForm from './components/ScheduledTaskForm.vue'
import ScheduledTasksLogs from './components/ScheduledTasksLogs.vue'

const runningTasks = ref(new Set<string>())
const handleRunTaskNow = async (id: string) => {
  if (runningTasks.value.has(id)) return
  runningTasks.value.add(id)
  try {
    await scheduledTasksStore.runScheduledTask(id)
  } catch (error) {
    message.error(error)
  } finally {
    runningTasks.value.delete(id)
  }
}

const handleShowNextRuns = (id: string) => {
  const task = scheduledTasksStore.getScheduledTaskById(id)
  if (task) {
    const list = new Cron(task.cron).nextRuns(20).map((v, i) => {
      const index = (i + 1).toString().padStart(2, '0')
      return `${index}.  ${formatDate(v.getTime(), 'YYYY-MM-DD HH:mm:ss')}`
    })
    previewCode(t('scheduledtasks.next'), list.join('\n'), 'text')
  }
}

const menuList: App.Menu[] = [
  {
    label: 'scheduledtasks.run',
    handler: handleRunTaskNow,
  },
  {
    label: 'scheduledtasks.next',
    handler: handleShowNextRuns,
  },
  {
    label: 'scheduledtasks.log',
    handler: (id: string) => {
      handleShowTaskLogs(id)
    },
  },
]

const { t } = useI18n()
const scheduledTasksStore = useScheduledTasksStore()
const appSettingsStore = useAppSettingsStore()
const keywords = ref('')

const matches = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return scheduledTasksStore.scheduledtasks
  return scheduledTasksStore.scheduledtasks.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.cron.toLowerCase().includes(q) ||
      t('scheduledtask.' + s.type)
        .toLowerCase()
        .includes(q),
  )
})
const filter = ref('')
const sort = ref('manual')
const filters = [
  { label: 'common.enabled', value: 'enabled' },
  { label: 'common.disabled', value: 'disabled' },
]
const filteredTasks = computed(() => {
  const records = matches.value.filter(
    (item) => !filter.value || (filter.value === 'disabled' ? item.disabled : !item.disabled),
  )
  return sort.value === 'name' ? records.sort((a, b) => a.name.localeCompare(b.name)) : records
})

const handleShowTaskLogs = (id?: string) => {
  const m = modal({
    title: 'scheduledtasks.logs',
    cancelText: 'common.close',
    maskClosable: true,
    submit: false,
    width: '90',
    height: '90',
  })
  m.setContent(ScheduledTasksLogs, { id }).open()
}

const handleShowTaskForm = (id?: string) => {
  const m = modal({
    title: id ? 'common.edit' : 'common.add',
    maxHeight: '90',
    size: 'lg',
    maxWidth: '90',
  })
  m.setContent(ScheduledTaskForm, { id }).open()
}

const handleDeleteTask = async (s: App.ScheduledTask) => {
  try {
    await confirm(t('common.delete'), t('common.confirmDelete', [s.name]), {
      type: 'text',
      okText: 'common.delete',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await scheduledTasksStore.deleteScheduledTask(s.id)
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteScheduledTask: ', error)
    message.error(error)
  }
}

const handleDisableTask = async (s: App.ScheduledTask) => {
  try {
    await scheduledTasksStore.editScheduledTask(s.id, { ...s, disabled: !s.disabled })
  } catch (error) {
    message.error(error)
  }
}

const generateMenus = (s: App.ScheduledTask) => [
  ...menuList.map((v) => ({ ...v, handler: () => v.handler?.(s.id) })),
  { label: s.disabled ? 'common.enable' : 'common.disable', handler: () => handleDisableTask(s) },
  { label: 'common.edit', handler: () => handleShowTaskForm(s.id) },
  { label: 'common.delete', handler: () => handleDeleteTask(s) },
]
const onSortUpdate = debounce(scheduledTasksStore.saveScheduledTasks, 1000)
</script>

<template>
  <div v-if="scheduledTasksStore.scheduledtasks.length === 0" class="grid-list-empty">
    <Empty>
      <template #description>
        <I18nT
          keypath="scheduledtasks.empty"
          tag="div"
          scope="global"
          class="flex items-center mt-12"
        >
          <template #action>
            <Button type="link" @click="handleShowTaskForm()">{{ t('common.add') }}</Button>
          </template>
        </I18nT>
      </template>
    </Empty>
  </div>

  <ResourcePageShell
    v-else
    v-model:query="keywords"
    v-model:view="appSettingsStore.app.scheduledtasksView"
    v-model:sort="sort"
    v-model:filter="filter"
    :filters="filters"
    :total="scheduledTasksStore.scheduledtasks.length"
    :count="filteredTasks.length"
  >
    <Button type="text" @click="handleShowTaskLogs()">
      {{ t('scheduledtasks.logs') }}
    </Button>
    <Button type="primary" icon="add" @click="handleShowTaskForm()">
      {{ t('common.add') }}
    </Button>
  </ResourcePageShell>

  <VueDraggable
    v-if="filteredTasks.length"
    v-model="scheduledTasksStore.scheduledtasks"
    v-bind="DraggableOptions"
    :disabled="Boolean(keywords.trim() || filter || sort !== 'manual')"
    :class="'grid-list-' + appSettingsStore.app.scheduledtasksView"
    @update="onSortUpdate"
  >
    <Card
      v-for="s in filteredTasks"
      :key="s.id"
      v-menu="generateMenus(s)"
      :title="s.name"
      :disabled="s.disabled"
      class="grid-list-item"
    >
      <template #extra><ResourceActions :items="generateMenus(s)" :name="s.name" /></template>

      <div class="resource-meta-list">
        <div class="mb-4">
          <Tag size="small" color="blue">{{ t('scheduledtask.' + s.type) }}</Tag>
        </div>
        <div class="resource-meta-row">
          <span>{{ t('scheduledtask.cron') }}</span>
          <span class="resource-meta-value font-mono">{{ s.cron }}</span>
        </div>
        <div class="resource-meta-row">
          <span>{{ t('scheduledtask.lastTime') }}</span>
          <span class="resource-meta-value">
            {{
              s.lastTime
                ? appSettingsStore.app.scheduledtasksView === View.Grid
                  ? formatRelativeTime(s.lastTime)
                  : formatDate(s.lastTime, 'YYYY-MM-DD HH:mm:ss')
                : '--'
            }}
          </span>
        </div>
      </div>

      <div class="resource-card-footer">
        <Button
          type="normal"
          size="small"
          icon="play"
          :loading="runningTasks.has(s.id)"
          @click="handleRunTaskNow(s.id)"
        >
          {{ t('scheduledtasks.run') }}
        </Button>
        <Button type="text" size="small" @click="handleShowTaskLogs(s.id)">
          {{ t('scheduledtasks.log') }}
        </Button>
        <Button type="text" size="small" class="ml-auto" @click="handleShowTaskForm(s.id)">
          {{ t('common.edit') }}
        </Button>
      </div>
    </Card>
  </VueDraggable>
</template>
