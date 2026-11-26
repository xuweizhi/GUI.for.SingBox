<script lang="ts" setup>
import { computed, ref, nextTick, onMounted, type SetupContext, type Slot } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  usePluginsStore,
  useProfilesStore,
  useRulesetsStore,
  useScheduledTasksStore,
  useSubscribesStore,
} from '@/stores'
import { message, modal } from '@/utils'

type ResourceType = 'profile' | 'subscription' | 'ruleset' | 'plugin' | 'scheduledtask'
type ResourceItem = App.Profile | App.Subscription | App.RuleSet | App.Plugin | App.ScheduledTask
type ResourceConfig = {
  title: string
  list: ResourceItem[]
  getById: (id: string) => ResourceItem | undefined
  getName: (item: ResourceItem) => string
  getDescription: (item: ResourceItem) => string
}

export interface ResourceSelectProps {
  type: ResourceType
  title?: string
  cols?: number
  max?: number
  min?: number
  renderSlot?: boolean
  openImmediate?: boolean
}

const props = withDefaults(defineProps<ResourceSelectProps>(), {
  title: undefined,
  cols: 3,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
  renderSlot: true,
  openImmediate: false,
})

const model = defineModel<string[]>({ default: () => [] })

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'change', val: string[], items: ResourceItem[]): void
  (e: 'submit', val: string[], items: ResourceItem[]): void
}>()

const { t } = useI18n()
const profilesStore = useProfilesStore()
const subscribesStore = useSubscribesStore()
const rulesetsStore = useRulesetsStore()
const pluginsStore = usePluginsStore()
const scheduledTasksStore = useScheduledTasksStore()

const resourceConfig = computed(() => {
  const configs: Record<ResourceType, ResourceConfig> = {
    profile: {
      title: 'profiles.select',
      list: profilesStore.profiles,
      getById: profilesStore.getProfileById,
      getName: (item) => (item as App.Profile).name,
      getDescription: () => '',
    },
    subscription: {
      title: 'subscribes.select',
      list: subscribesStore.subscribes,
      getById: subscribesStore.getSubscribeById,
      getName: (item) => (item as App.Subscription).name,
      getDescription: (item) => (item as App.Subscription).type,
    },
    ruleset: {
      title: 'rulesets.select',
      list: rulesetsStore.rulesets,
      getById: rulesetsStore.getRulesetById,
      getName: (item) => (item as App.RuleSet).name,
      getDescription: (item) => {
        const ruleset = item as App.RuleSet
        return `${ruleset.type} / ${ruleset.format}`
      },
    },
    plugin: {
      title: 'plugins.select',
      list: pluginsStore.plugins,
      getById: pluginsStore.getPluginById,
      getName: (item) => (item as App.Plugin).name,
      getDescription: (item) => {
        const plugin = item as App.Plugin
        return plugin.description || plugin.type
      },
    },
    scheduledtask: {
      title: 'scheduledtasks.select',
      list: scheduledTasksStore.scheduledtasks,
      getById: scheduledTasksStore.getScheduledTaskById,
      getName: (item) => (item as App.ScheduledTask).name,
      getDescription: (item) => t('scheduledtask.' + (item as App.ScheduledTask).type),
    },
  }

  return configs[props.type]
})

const modalTitle = computed(() => props.title || resourceConfig.value.title)

let defaultSlot: Slot | undefined
let actionSlot: Slot | undefined

const DefineTemplate = (_: unknown, { slots }: SetupContext) => {
  defaultSlot = slots.default
  actionSlot = slots.action
  return null
}

const draft = ref<string[]>([])
const query = ref('')
const filtered = computed(() =>
  resourceConfig.value.list.filter((item) =>
    resourceConfig.value.getName(item).toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
)
const open = () => {
  draft.value = [...model.value]
  query.value = ''
  let confirmed: string[] = []
  const m = modal(
    {
      title: modalTitle.value,
      size: 'lg',
      submitText: 'common.confirm',
      onOk: () => {
        if (isBelowMinSelection.value) return false
        confirmed = [...draft.value]
        model.value = confirmed
        emit('change', confirmed, getItems(confirmed))
        return true
      },
      afterClose: (ok) => {
        if (ok) emit('submit', confirmed, getItems(confirmed))
        else emit('cancel')
      },
      maskClosable: true,
    },
    {
      default: defaultSlot,
      action: actionSlot,
    },
  )
  m.open()
}

const isBelowMinSelection = computed(() => draft.value.length < props.min)

const getItems = (val = model.value) => {
  return val.flatMap((id) => {
    const item = resourceConfig.value.getById(id)
    return item ? [item] : []
  })
}

const handleSelect = (item: ResourceItem) => {
  const id = item.id

  const nextValue: string[] = []

  if (draft.value.includes(id)) {
    nextValue.push(...draft.value.filter((item) => item !== id))
  } else {
    nextValue.push(...draft.value, id)
    if (nextValue.length > props.max) {
      message.warn('common.maxSelectionExceeded')
      return
    }
  }

  draft.value = nextValue
}

onMounted(() => {
  if (props.openImmediate) {
    nextTick(open)
  }
})
</script>

<template>
  <slot v-if="renderSlot" v-bind="{ selected: model, open }">
    <Button @click="open">{{ t('common.select') }}</Button>
  </slot>

  <DefineTemplate>
    <template #action>
      <span class="mr-auto text-12 text-secondary" aria-live="polite">
        {{
          isBelowMinSelection
            ? t('common.selectAtLeast', [props.min])
            : t('common.selectedCount', [draft.length])
        }}
      </span>
    </template>
    <Input v-model="query" clearable :placeholder="t('common.search')" class="w-full mb-8" />
    <Empty v-if="!filtered.length" />
    <div class="resource-picker-grid pb-8" :style="{ '--columns': Math.max(1, cols) }">
      <Card
        v-for="item in filtered"
        :key="item.id"
        :title="resourceConfig.getName(item)"
        :selected="draft.includes(item.id)"
        @click="handleSelect(item)"
      >
        <div class="text-12 line-clamp-2">{{ resourceConfig.getDescription(item) }}</div>
      </Card>
    </div>
  </DefineTemplate>
</template>

<style scoped>
.resource-picker-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(
    auto-fill,
    minmax(min(100%, max(190px, calc((100% + 8px) / var(--columns) - 8px))), 1fr)
  );
}
</style>
