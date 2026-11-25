<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Cron } from 'croner'
import { useI18n, I18nT } from 'vue-i18n'

import { DraggableOptions, ViewOptions } from '@/constant/app'
import { View } from '@/enums/app'
import { useAppSettingsStore, useScheduledTasksStore } from '@/stores'
import { confirm, debounce, formatRelativeTime, formatDate, message, alert, modal } from '@/utils'

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
    alert(t('scheduledtasks.next'), list.join('\n'))
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

const filteredTasks = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return scheduledTasksStore.scheduledtasks
  return scheduledTasksStore.scheduledtasks.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.cron.toLowerCase().includes(q) ||
      t('scheduledtask.' + s.type).toLowerCase().includes(q),
  )
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
    minWidth: '70',
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

  <div v-else class="grid-list-header">
    <Radio
      v-model="appSettingsStore.app.scheduledtasksView"
      :options="ViewOptions"
    />
    <span class="resource-count-badge">
      {{
        keywords.trim()
          ? `${filteredTasks.length} / ${scheduledTasksStore.scheduledtasks.length}`
          : scheduledTasksStore.scheduledtasks.length
      }}
    </span>
    <Input
      v-model="keywords"
      size="small"
      clearable
      auto-size
      :placeholder="t('common.search')"
      class="resource-search mr-auto"
    />
    <Button type="text" @click="handleShowTaskLogs()">
      {{ t('scheduledtasks.logs') }}
    </Button>
    <Button type="primary" icon="add" class="ml-16" @click="handleShowTaskForm()">
      {{ t('common.add') }}
    </Button>
  </div>

  <Empty v-if="scheduledTasksStore.scheduledtasks.length > 0 && filteredTasks.length === 0" />

  <VueDraggable
    v-else-if="scheduledTasksStore.scheduledtasks.length > 0"
    v-model="scheduledTasksStore.scheduledtasks"
    v-bind="DraggableOptions"
    @update="onSortUpdate"
    :disabled="Boolean(keywords.trim())"
    :class="'grid-list-' + appSettingsStore.app.scheduledtasksView"
  >
    <Card
      v-for="s in filteredTasks"
      :key="s.id"
      v-menu="menuList.map((v) => ({ ...v, handler: () => v.handler?.(s.id) }))"
      :title="s.name"
      :disabled="s.disabled"
      class="grid-list-item"
    >
      <template v-if="appSettingsStore.app.scheduledtasksView === View.Grid" #extra>
        <Dropdown>
          <Button
            type="text"
            size="small"
            icon="more"
            :aria-label="t('common.more') + ' · ' + s.name"
          />
          <template #overlay="{ close }">
            <div class="flex flex-col gap-2 min-w-128 p-6">
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleRunTaskNow(s.id)
                  }
                "
              >
                {{ t('scheduledtasks.run') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleShowNextRuns(s.id)
                  }
                "
              >
                {{ t('scheduledtasks.next') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleShowTaskLogs(s.id)
                  }
                "
              >
                {{ t('scheduledtasks.log') }}
              </Button>
              <Divider size="small" />
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleDisableTask(s)
                  }
                "
              >
                {{ s.disabled ? t('common.enable') : t('common.disable') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleShowTaskForm(s.id)
                  }
                "
              >
                {{ t('common.edit') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start text-danger"
                @click="
                  () => {
                    close()
                    handleDeleteTask(s)
                  }
                "
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </template>
        </Dropdown>
      </template>

      <template v-else #extra>
        <Button type="text" size="small" :loading="runningTasks.has(s.id)" @click="handleRunTaskNow(s.id)">
          {{ t('scheduledtasks.run') }}
        </Button>
        <Button type="text" size="small" @click="handleShowTaskLogs(s.id)">
          {{ t('scheduledtasks.log') }}
        </Button>
        <Button type="text" size="small" @click="handleDisableTask(s)">
          {{ s.disabled ? t('common.enable') : t('common.disable') }}
        </Button>
        <Button type="text" size="small" @click="handleShowTaskForm(s.id)">
          {{ t('common.edit') }}
        </Button>
        <Button type="text" size="small" class="text-danger" @click="handleDeleteTask(s)">
          {{ t('common.delete') }}
        </Button>
      </template>

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

      <div v-if="appSettingsStore.app.scheduledtasksView === View.Grid" class="resource-card-footer">
        <Button type="normal" size="small" icon="play" :loading="runningTasks.has(s.id)" @click="handleRunTaskNow(s.id)">
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
