<script setup lang="ts">
import { ref, inject, h, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePluginsStore, useAppSettingsStore } from '@/stores'
import { deepClone, message } from '@/utils'

import Button from '@/components/Button/index.vue'

import PluginConfigItem from './PluginConfigItem.vue'

interface Props {
  plugin: App.Plugin
}

const props = defineProps<Props>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()
const appSettingsStore = useAppSettingsStore()
const pluginConfigRef = useTemplateRef('pluginConfigRef')

const loading = ref(false)
const settings = ref(deepClone(appSettingsStore.app.pluginSettings[props.plugin.id] ?? {}))
const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const handleSave = async () => {
  loading.value = true
  try {
    await pluginsStore.configurePlugin(props.plugin, settings.value)
  } catch (error) {
    message.error(error)
    return
  } finally {
    loading.value = false
  }

  await handleSubmit()
  message.success('common.success')
}

const modalSlots = {
  action: () =>
    h(
      Button,
      {
        type: 'link',
        class: 'mr-auto',
        onClick: () => pluginConfigRef.value?.reset(),
      },
      () => t('plugin.restore'),
    ),
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
  <PluginConfigItem ref="pluginConfigRef" v-model="settings" :plugin="props.plugin" />
</template>
