<script setup lang="ts">
import { computed, ref, inject, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { IsNotificationAvailable, RequestNotificationAuthorization } from '@/bridge'
import { ScheduledTaskOptions } from '@/constant/app'
import { ScheduledTasksType } from '@/enums/app'
import { useFormDraft } from '@/hooks/useFormDraft'
import {
  useScheduledTasksStore,
  useSubscribesStore,
  useRulesetsStore,
  usePluginsStore,
} from '@/stores'
import { previewCode, deepClone, formatDate, isValidCron, message, sampleID } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  id?: string
}

const props = defineProps<Props>()

const loading = ref(false)

const task = ref<App.ScheduledTask>({
  id: sampleID(),
  name: '',
  type: ScheduledTasksType.RunScript,
  subscriptions: [],
  rulesets: [],
  plugins: [],
  script: '',
  cron: '',
  notification: false,
  disabled: false,
  lastTime: 0,
})

const { t } = useI18n()
const scheduledTasksStore = useScheduledTasksStore()
const subscribesStore = useSubscribesStore()
const rulesetsStore = useRulesetsStore()
const pluginsStore = usePluginsStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const handleSave = async () => {
  if (loading.value) return
  errorField.value = ''
  if (!task.value.name.trim()) {
    return invalid('name')
  }
  if (!task.value.cron.trim()) {
    return invalid('cron')
  }
  const { ok, reason } = isValidCron(task.value.cron)
  if (!ok) {
    return invalid('cron', String(reason))
  }

  switch (task.value.type) {
    case ScheduledTasksType.UpdateSubscription:
      task.value.subscriptions = task.value.subscriptions.filter((id) =>
        subscribesStore.getSubscribeById(id),
      )
      if (!task.value.subscriptions.length) {
        return invalid('target', t('common.selectAtLeast', [1]))
      }
      break
    case ScheduledTasksType.UpdateRuleset:
      task.value.rulesets = task.value.rulesets.filter((id) => rulesetsStore.getRulesetById(id))
      if (!task.value.rulesets.length) {
        return invalid('target', t('common.selectAtLeast', [1]))
      }
      break
    case ScheduledTasksType.UpdatePlugin:
    case ScheduledTasksType.RunPlugin:
      task.value.plugins = task.value.plugins.filter((id) => pluginsStore.getPluginById(id))
      if (!task.value.plugins.length) {
        return invalid('target', t('common.selectAtLeast', [1]))
      }
      break
    case ScheduledTasksType.RunScript:
      if (!task.value.script.trim()) {
        return invalid('script')
      }
      break
  }

  loading.value = true

  try {
    if (props.id) {
      await scheduledTasksStore.editScheduledTask(props.id, task.value)
    } else {
      await scheduledTasksStore.addScheduledTask(task.value)
    }
    message.success('common.success')
    await handleSubmit()
  } catch (error: any) {
    console.error(error)
    message.error(error)
  } finally {
    loading.value = false
  }
}

const handleUse = (list: string[], id: string) => {
  const idx = list.findIndex((v) => v === id)
  if (idx !== -1) {
    list.splice(idx, 1)
  } else {
    list.push(id)
  }
}

const handleValidate = () => {
  const { ok, reason } = isValidCron(task.value.cron)
  if (!ok) {
    message.error(reason)
    return
  }
  message.success('common.success')
}

const handleViewNextRuns = () => {
  const { ok, reason, instance } = isValidCron(task.value.cron)
  if (!ok) {
    message.error(reason)
    return
  }
  const list = instance!.nextRuns(20).map((v, i) => {
    const index = (i + 1).toString().padStart(2, '0')
    return `${index}.  ${formatDate(v.getTime(), 'YYYY-MM-DD HH:mm:ss')}`
  })
  previewCode(t('scheduledtasks.next'), list.join('\n'), 'text')
}

const nextRuns = computed(
  () =>
    isValidCron(task.value.cron)
      .instance?.nextRuns(3)
      .map((d) => formatDate(d.getTime(), 'YYYY-MM-DD HH:mm:ss')) || [],
)
const onNotificationChange = async (v: boolean) => {
  if (v) {
    try {
      if (!(await IsNotificationAvailable())) {
        throw 'Notifications not available on this platform'
      }
      const granted = await RequestNotificationAuthorization()
      if (!granted) {
        task.value.notification = false
        message.warn('Notification permission was not granted')
      }
    } catch (error: any) {
      task.value.notification = false
      message.warn(error)
    }
  }
}

if (props.id) {
  const s = scheduledTasksStore.getScheduledTaskById(props.id)
  if (s) {
    task.value = deepClone(s)
  }
}

const { errorField, errorMessage, invalid } = useFormDraft(() => task.value)
const modalSlots = {
  cancel: () =>
    h(
      Button,
      {
        disabled: loading.value,
        onClick: handleCancel,
      },
      () => t('common.cancel'),
    ),
  submit: () =>
    h(
      Button,
      {
        type: 'primary',
        loading: loading.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div ref="formRoot" class="resource-form">
    <div class="form-item" :data-invalid="errorField === 'name'">
      {{ t('scheduledtask.name') }} *
      <div class="w-full">
        <Input v-model="task.name" autofocus class="w-full" />
        <small v-if="errorField === 'name'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div class="form-item items-start" :data-invalid="errorField === 'cron'">
      <div class="pt-6">{{ t('scheduledtask.cron') }} *</div>
      <div class="w-full flex flex-col gap-6">
        <div class="flex flex-wrap gap-4">
          <Button
            v-for="(cron, period) in {
              hourly: '0 * * * *',
              daily: '0 0 * * *',
              weekly: '0 0 * * 1',
            }"
            :key="period"
            size="small"
            @click="task.cron = cron"
            >{{ t('workspace.' + period) }}</Button
          >
        </div>
        <Input
          v-model="task.cron"
          :placeholder="t('scheduledtask.cronTips')"
          clearable
          class="w-full"
        />
        <small v-if="errorField === 'cron'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
        <div v-if="nextRuns.length" aria-live="polite" class="text-muted text-12">
          {{ t('scheduledtasks.next') }} · {{ nextRuns.join(' / ') }}
        </div>
        <div class="flex flex-wrap items-center gap-6">
          <Button type="normal" size="small" :disabled="!task.cron" @click="handleValidate">
            {{ t('scheduledtask.validate') }}
          </Button>
          <Button type="text" size="small" :disabled="!task.cron" @click="handleViewNextRuns">
            {{ t('scheduledtasks.next') }}
          </Button>
        </div>
      </div>
    </div>
    <div class="form-item">
      <div>{{ t('scheduledtask.type') }}</div>
      <div class="w-full">
        <Select v-model="task.type" :options="ScheduledTaskOptions" auto-size />
      </div>
    </div>
    <div class="form-item">
      {{ t('scheduledtask.notification') }}
      <Switch v-model="task.notification" @change="onNotificationChange" />
    </div>

    <div
      v-if="task.type === ScheduledTasksType.UpdateSubscription"
      :data-invalid="errorField === 'target'"
    >
      <Divider>{{ t('scheduledtask.subscriptions') }}</Divider>
      <small v-if="errorField === 'target'" class="field-error block mb-8" role="alert">{{
        errorMessage
      }}</small>
      <Empty v-if="subscribesStore.subscribes.length === 0" />
      <div class="responsive-card-grid">
        <Card
          v-for="s in subscribesStore.subscribes"
          :key="s.id"
          :title="s.name"
          :selected="task.subscriptions.includes(s.id)"
          interactive
          @click="handleUse(task.subscriptions, s.id)"
        >
          <div class="text-12 text-muted line-clamp-2">{{ s.type }}</div>
        </Card>
      </div>
    </div>

    <div
      v-else-if="task.type === ScheduledTasksType.UpdateRuleset"
      :data-invalid="errorField === 'target'"
    >
      <Divider>{{ t('scheduledtask.rulesets') }}</Divider>
      <small v-if="errorField === 'target'" class="field-error block mb-8" role="alert">{{
        errorMessage
      }}</small>
      <Empty v-if="rulesetsStore.rulesets.length === 0" />
      <div class="responsive-card-grid">
        <Card
          v-for="r in rulesetsStore.rulesets"
          :key="r.id"
          :title="r.name"
          :selected="task.rulesets.includes(r.id)"
          interactive
          @click="handleUse(task.rulesets, r.id)"
        >
          <div class="text-12 text-muted line-clamp-2">{{ r.type }}</div>
        </Card>
      </div>
    </div>

    <div
      v-else-if="task.type === ScheduledTasksType.UpdatePlugin"
      :data-invalid="errorField === 'target'"
    >
      <Divider>{{ t('scheduledtask.plugins') }}</Divider>
      <small v-if="errorField === 'target'" class="field-error block mb-8" role="alert">{{
        errorMessage
      }}</small>
      <Empty v-if="pluginsStore.plugins.length === 0" />
      <div class="responsive-card-grid">
        <Card
          v-for="p in pluginsStore.plugins"
          :key="p.id"
          :title="p.name"
          :selected="task.plugins.includes(p.id)"
          interactive
          @click="handleUse(task.plugins, p.id)"
        >
          <div class="text-12 text-muted line-clamp-2">{{ p.type }}</div>
        </Card>
      </div>
    </div>

    <div
      v-else-if="task.type === ScheduledTasksType.RunPlugin"
      :data-invalid="errorField === 'target'"
    >
      <Divider>{{ t('scheduledtask.plugins') }}</Divider>
      <small v-if="errorField === 'target'" class="field-error block mb-8" role="alert">{{
        errorMessage
      }}</small>
      <Empty v-if="pluginsStore.plugins.length === 0" />
      <div class="responsive-card-grid">
        <Card
          v-for="p in pluginsStore.plugins"
          :key="p.id"
          v-tips="p.description"
          :title="p.name"
          :selected="task.plugins.includes(p.id)"
          interactive
          @click="handleUse(task.plugins, p.id)"
        >
          <div class="text-12 text-muted line-clamp-2">{{ p.description }}</div>
        </Card>
      </div>
    </div>

    <div
      v-else-if="task.type === ScheduledTasksType.RunScript"
      :data-invalid="errorField === 'script'"
    >
      <Divider>{{ t('scheduledtask.script') }}</Divider>
      <small v-if="errorField === 'script'" class="field-error block mb-8" role="alert">{{
        errorMessage
      }}</small>
      <CodeEditor v-model="task.script" editable lang="javascript" class="task-script-editor" />
    </div>
  </div>
</template>

<style scoped>
.task-script-editor {
  height: 280px;
  min-height: 220px;
}
</style>
