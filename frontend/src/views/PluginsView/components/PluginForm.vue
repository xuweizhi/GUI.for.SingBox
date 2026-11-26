<script setup lang="ts">
import { ref, inject, computed, h } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n } from 'vue-i18n'

import { PluginsTriggerOptions, DraggableOptions } from '@/constant/app'
import { PluginTrigger } from '@/enums/app'
import { useBool } from '@/hooks'
import { useFormDraft } from '@/hooks/useFormDraft'
import { usePluginsStore } from '@/stores'
import { deepClone, message, sampleID } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  id?: string
}

const props = defineProps<Props>()

const official = computed(() => pluginsStore.findPluginInHubById(plugin.value.id))
const loading = ref(false)
const pluginID = sampleID()
const plugin = ref<App.Plugin>({
  id: pluginID,
  version: 'v1.0.0',
  name: '',
  description: '',
  tags: [],
  group: '',
  type: 'File',
  url: '',
  status: 0,
  path: `data/plugins/plugin-${pluginID}.js`,
  triggers: [PluginTrigger.OnManual],
  hasUI: false,
  menus: {},
  context: {
    profiles: {},
    subscriptions: {},
    rulesets: {},
    plugins: {},
    scheduledtasks: {},
  },
  configuration: [],
  disabled: false,
})

const componentList = [
  'CheckBox',
  'CodeEditor',
  'Input',
  'InputList',
  'KeyValueEditor',
  'Radio',
  'Select',
  'MultipleSelect',
  'Switch',
  'ColorPicker',
] as const

type ComponentType = (typeof componentList)[number]

const { t } = useI18n()
const [showMore, toggleShowMore] = useBool(false)
const pluginsStore = usePluginsStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const restored = ref(false)
const handleRestore = () => {
  if (official.value) {
    const { path, status, disabled } = plugin.value
    plugin.value = { ...deepClone(official.value), path, status, disabled }
    restored.value = true
    message.success('common.success')
  }
}

const invalidConfiguration = computed(() =>
  plugin.value.configuration.some((field) => !field.component || !field.key.trim()),
)
const handleSave = async () => {
  if (loading.value) return
  errorField.value = ''
  if (!plugin.value.name.trim()) {
    return invalid('name')
  }
  if (!plugin.value.version.trim()) {
    return invalid('version')
  }
  if (plugin.value.type === 'Http' && !plugin.value.url.trim()) {
    return invalid('url')
  }
  if (!plugin.value.path.trim()) {
    return invalid('path')
  }
  if (invalidConfiguration.value) {
    showMore.value = true
    return invalid('configuration')
  }

  loading.value = true
  try {
    if (props.id) {
      if (restored.value) await pluginsStore.updatePlugin(props.id, plugin.value)
      else await pluginsStore.editPlugin(props.id, plugin.value)
    } else {
      await pluginsStore.addPlugin(plugin.value)
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

const hasDefaultValue = (value: unknown) => {
  if (Array.isArray(value)) return value.length !== 0
  if (value && typeof value === 'object') return Object.keys(value).length !== 0
  return Boolean(value)
}

const handleAddParam = async () => {
  plugin.value.configuration.push({
    id: sampleID(),
    title: '',
    description: '',
    key: '',
    component: '',
    value: [],
    options: [],
  })
}

const handleDelParam = (index: number) => {
  plugin.value.configuration.splice(index, 1)
}

const hasOption = (component: App.PluginConfiguration['component']) => {
  return ['CheckBox', 'Radio', 'Select', 'MultipleSelect'].includes(component as ComponentType)
}

const onComponentChange = (component: ComponentType, index: number) => {
  switch (component) {
    case 'CheckBox':
    case 'InputList':
    case 'MultipleSelect': {
      plugin.value.configuration[index]!.value = []
      plugin.value.configuration[index]!.options = []
      break
    }
    case 'CodeEditor':
    case 'Input':
    case 'Radio':
    case 'Select': {
      plugin.value.configuration[index]!.value = ''
      break
    }
    case 'ColorPicker': {
      plugin.value.configuration[index]!.value = '#000000'
      break
    }
    case 'KeyValueEditor': {
      plugin.value.configuration[index]!.value = {}
      break
    }
    case 'Switch': {
      plugin.value.configuration[index]!.value = false
      break
    }
  }
  plugin.value.configuration[index]!.component = component
}

const getOptions = (val: string[]) => {
  return val.map((v) => {
    const arr = v.split(',')
    return { label: arr[0], value: arr[1] || arr[0] }
  })
}

if (props.id) {
  const p = pluginsStore.getPluginById(props.id)
  p && (plugin.value = deepClone(p))
}

const { errorField, errorMessage, invalid } = useFormDraft(() => plugin.value)
const modalSlots = {
  action: () =>
    official.value
      ? h(Button, { type: 'link', class: 'mr-auto', onClick: handleRestore }, () =>
          t('plugin.restore'),
        )
      : undefined,
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
  <div ref="formRoot" class="resource-form w-full h-full">
    <div class="form-item">
      {{ t('plugin.type') }}
      <Radio
        v-model="plugin.type"
        :options="[
          { label: 'common.http', value: 'Http' },
          { label: 'common.file', value: 'File' },
        ]"
      />
    </div>
    <div class="form-item">
      <div class="mr-8">{{ t('plugin.trigger') }}</div>
      <MultipleSelect v-model="plugin.triggers" :options="PluginsTriggerOptions" clearable />
    </div>
    <div class="form-item" :data-invalid="errorField === 'name'">
      {{ t('plugin.name') }} *
      <div class="w-full">
        <Input v-model="plugin.name" autofocus class="w-full" />
        <small v-if="errorField === 'name'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div class="form-item" :data-invalid="errorField === 'version'">
      {{ t('plugin.version') }} *
      <div class="w-full">
        <Input v-model="plugin.version" class="w-full" />
        <small v-if="errorField === 'version'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div v-show="plugin.type === 'Http'" class="form-item" :data-invalid="errorField === 'url'">
      {{ t('plugin.url') }} *
      <div class="w-full">
        <Input
          v-model="plugin.url"
          :placeholder="plugin.type === 'Http' ? 'http(s)://' : 'data/local/plugin-{filename}.js'"
          allow-paste
          class="w-full"
        />
        <small v-if="errorField === 'url'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div class="form-item" :data-invalid="errorField === 'path'">
      {{ t('plugin.path') }} *
      <div class="w-full">
        <Input
          v-model="plugin.path"
          placeholder="data/plugins/plugin-{filename}.js"
          class="w-full"
        />
        <small v-if="errorField === 'path'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div class="form-item">
      {{ t('plugin.description') }}
      <div class="w-full">
        <Input v-model="plugin.description" class="w-full" />
      </div>
    </div>
    <Divider>
      <Button type="text" size="small" @click="toggleShowMore">
        {{ t('common.more') }}
      </Button>
    </Divider>
    <div v-show="showMore" class="pb-8">
      <div class="form-item">
        {{ t('plugin.hasUI') }}
        <Switch v-model="plugin.hasUI" />
      </div>
      <div class="form-item" :class="{ 'items-start': Object.keys(plugin.menus).length !== 0 }">
        {{ t('plugin.menus') }}
        <KeyValueEditor
          v-model="plugin.menus"
          :placeholder="[t('plugin.menuKey'), t('plugin.menuValue')]"
        />
      </div>
      <div
        :class="{ 'items-start': Object.keys(plugin.context.profiles).length !== 0 }"
        class="form-item"
      >
        {{ t('plugin.context') }} - {{ t('router.profiles') }}
        <KeyValueEditor
          v-model="plugin.context.profiles"
          :placeholder="[t('plugin.menuKey'), t('plugin.menuValue')]"
        />
      </div>
      <div
        :class="{ 'items-start': Object.keys(plugin.context.subscriptions).length !== 0 }"
        class="form-item"
      >
        {{ t('plugin.context') }} - {{ t('router.subscriptions') }}
        <KeyValueEditor
          v-model="plugin.context.subscriptions"
          :placeholder="[t('plugin.menuKey'), t('plugin.menuValue')]"
        />
      </div>
      <Divider>{{ t('plugin.configuration') }}</Divider>
      <VueDraggable
        v-model="plugin.configuration"
        v-bind="DraggableOptions"
        handle=".drag"
        class="px-8 flex flex-col gap-8"
      >
        <template v-for="(conf, index) in plugin.configuration" :key="conf.id">
          <Card v-if="conf.component" :title="conf.component">
            <template #title-prefix>
              <Icon icon="drag" class="drag cursor-move" />
              <div class="ml-8">{{ index + 1 }}.</div>
            </template>
            <template #extra>
              <Button size="small" type="text" @click="handleDelParam(index)">
                {{ t('common.delete') }}
              </Button>
            </template>
            <div class="form-item">
              {{ t('plugin.confName') }}
              <div class="w-full">
                <Input v-model="conf.title" placeholder="title" class="w-full" />
              </div>
            </div>
            <div class="form-item">
              {{ t('plugin.confDescription') }}
              <div class="w-full">
                <Input v-model="conf.description" placeholder="description" class="w-full" />
              </div>
            </div>
            <div
              class="form-item"
              :data-invalid="
                errorField === 'configuration' && (!conf.component || !conf.key.trim())
              "
            >
              {{ t('plugin.confKey') }}
              <div class="w-full">
                <Input v-model="conf.key" placeholder="key" class="w-full" />
                <small
                  v-if="errorField === 'configuration' && (!conf.component || !conf.key.trim())"
                  class="field-error"
                  role="alert"
                  >{{ errorMessage }}</small
                >
              </div>
            </div>
            <div class="form-item" :class="{ 'items-start': hasDefaultValue(conf.value) }">
              {{ t('plugin.confDefault') }}
              <div
                :class="
                  conf.component === 'CodeEditor' || conf.component === ('CodeViewer' as any)
                    ? 'w-full'
                    : ''
                "
              >
                <Component
                  :is="(conf.component as any) === 'CodeViewer' ? 'CodeEditor' : conf.component"
                  v-model="conf.value"
                  :options="getOptions(conf.options)"
                  editable
                  class="w-full"
                />
              </div>
            </div>
            <div
              v-if="hasOption(conf.component)"
              :class="{ 'items-start': conf.options.length !== 0 }"
              class="form-item"
            >
              {{ t('plugin.options') }}
              <InputList v-model="conf.options" />
            </div>
          </Card>
          <Card v-else :title="t('plugin.selectComponent')">
            <template #extra>
              <Button size="small" type="text" @click="handleDelParam(index)">
                {{ t('common.delete') }}
              </Button>
            </template>
            <div
              class="component-picker"
              :data-invalid="errorField === 'configuration' && !conf.component"
            >
              <div class="component-picker__grid">
                <Button
                  v-for="item in componentList"
                  :key="item"
                  @click="onComponentChange(item, index)"
                >
                  {{ item }}
                </Button>
              </div>
              <small
                v-if="errorField === 'configuration' && !conf.component"
                class="field-error"
                role="alert"
                >{{ errorMessage }}</small
              >
            </div>
          </Card>
        </template>
      </VueDraggable>

      <div :class="plugin.configuration.length !== 0 ? 'mt-8' : ''" class="mx-8">
        <Button type="primary" icon="add" class="w-full" @click="handleAddParam" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.component-picker__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
@container (max-width: 640px) {
  .component-picker__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
