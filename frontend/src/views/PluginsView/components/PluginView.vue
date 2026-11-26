<script setup lang="ts">
import { ref, inject, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { ReadFile, WriteFile } from '@/bridge'
import { PluginTriggerEvent } from '@/enums/app'
import { useFormDraft } from '@/hooks/useFormDraft'
import { usePluginsStore } from '@/stores'
import { deepClone, message } from '@/utils'

import Button from '@/components/Button/index.vue'
import Dropdown from '@/components/Dropdown/index.vue'

interface Props {
  id: string
}

const props = defineProps<Props>()

const loading = ref(false)
const plugin = ref<App.Plugin>()
const metadata = ref<Record<string, any>>()
const code = ref('')
const ready = ref(false)
const loadError = ref('')

const { t } = useI18n()
const pluginsStore = usePluginsStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any
const { resetBaseline } = useFormDraft(() => code.value)

const handleSave = async () => {
  if (!plugin.value || !ready.value || loading.value) return
  loading.value = true
  try {
    await WriteFile(plugin.value.path, code.value)
    await pluginsStore.reloadPlugin(plugin.value, code.value, false)
    await handleSubmit()
  } catch (error: any) {
    message.error(error)
    console.log(error)
  } finally {
    loading.value = false
  }
}

const testing = ref(false)

const handleTest = async (event: PluginTriggerEvent, arg1?: any, arg2?: any) => {
  if (!plugin.value || !ready.value || testing.value) return
  testing.value = true
  try {
    const metadata = JSON.stringify({
      ...pluginsStore.getPluginMetadata(props.id),
      Mode: 'Dev',
    })
    if (event === PluginTriggerEvent.OnSubscribe) {
      arg1 = '[]'
      arg2 = '{}'
    } else if (event === PluginTriggerEvent.OnGenerate) {
      arg1 = '{}'
      arg2 = '{}'
    } else if (event === PluginTriggerEvent.OnConfigure) {
      arg1 = metadata
      arg2 = metadata
    }
    const fn = new window.AsyncFunction(
      `const Plugin = ${metadata};\n${code.value}\nreturn await ${event}(${arg1}, ${arg2})`,
    )
    await fn()
    message.success('common.success')
  } catch (error: any) {
    message.error(error.message || error)
  } finally {
    testing.value = false
  }
}

const initPluginCode = async (p: App.Plugin) => {
  loadError.value = ''
  ready.value = false
  try {
    code.value = pluginsStore.getPluginCodefromCache(p.id) ?? (await ReadFile(p.path))
    ready.value = true
    resetBaseline()
  } catch (error: any) {
    loadError.value = error?.message || String(error)
    message.error(error)
  }
}

const p = pluginsStore.getPluginById(props.id)
if (p) {
  plugin.value = deepClone(p)
  metadata.value = pluginsStore.getPluginMetadata(props.id)
  initPluginCode(p)
}

const modalSlots = {
  action: () => {
    const events = [
      [PluginTriggerEvent.OnEnabled, 'plugin.on::enabled'],
      [PluginTriggerEvent.OnDisabled, 'plugin.on::disabled'],
      [PluginTriggerEvent.OnDispose, 'plugin.on::dispose'],
      [PluginTriggerEvent.OnManual, 'plugin.on::manual'],
      [PluginTriggerEvent.OnInstall, 'plugin.on::install'],
      [PluginTriggerEvent.OnUninstall, 'plugin.on::uninstall'],
      [PluginTriggerEvent.OnStartup, 'plugin.on::startup'],
      [PluginTriggerEvent.OnShutdown, 'plugin.on::shutdown'],
      [PluginTriggerEvent.OnReady, 'plugin.on::ready'],
      [PluginTriggerEvent.OnTask, 'plugin.on::task'],
      [PluginTriggerEvent.OnConfigure, 'plugin.on::configure'],
      [PluginTriggerEvent.OnSubscribe, 'plugin.on::subscribe'],
      [PluginTriggerEvent.OnGenerate, 'plugin.on::generate'],
      [PluginTriggerEvent.OnCoreStarted, 'plugin.on::core::started'],
      [PluginTriggerEvent.OnCoreStopped, 'plugin.on::core::stopped'],
      [PluginTriggerEvent.OnBeforeCoreStart, 'plugin.on::before::core::start'],
      [PluginTriggerEvent.OnBeforeCoreStop, 'plugin.on::before::core::stop'],
    ] as const

    return h(
      Dropdown,
      {
        placement: 'top',
        class: 'mr-auto',
      },
      {
        default: () =>
          h(
            Button,
            {
              loading: testing.value,
              disabled: !ready.value,
              type: 'link',
            },
            () => t('plugins.testRun'),
          ),
        overlay: ({ close }: { close: () => void }) =>
          h(
            'div',
            {
              class: 'p-4 flex flex-col gap-2 min-w-128',
            },
            events.map(([type, label]) =>
              h(
                Button,
                {
                  onClick: () => { close(); void handleTest(type) },
                  type: 'text',
                  size: 'small',
                },
                () => t(label),
              ),
            ),
          ),
      },
    )
  },
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
        disabled: !ready.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div ref="formRoot" class="h-full flex flex-col">
    <CodeEditor
      v-if="ready"
      v-model="code"
      :plugin="metadata"
      lang="javascript"
      editable
      class="h-full"
    />
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-12 p-16">
      <div class="text-13 text-danger text-center break-all" role="alert">{{ loadError }}</div>
      <Button v-if="plugin" type="primary" size="small" @click="initPluginCode(plugin)">{{
        t('common.retry')
      }}</Button>
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <Icon icon="loading" :size="24" class="rotation" />
    </div>
  </div>
</template>
