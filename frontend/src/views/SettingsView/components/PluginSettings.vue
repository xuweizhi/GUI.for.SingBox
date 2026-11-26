<script lang="ts" setup>
import { computed, onUnmounted, shallowReactive } from 'vue'

import { useAppSettingsStore, usePluginsStore } from '@/stores'
import { message } from '@/utils'
import PluginConfigItem from '@/views/PluginsView/components/PluginConfigItem.vue'

const appSettingsStore = useAppSettingsStore()
const pluginsStore = usePluginsStore()

const plugins = computed(() =>
  pluginsStore.plugins.filter((plugin) => plugin.configuration.length > 0),
)
const drafts = shallowReactive<Record<string, Recordable>>({})
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const commitConfigure = async (plugin: App.Plugin, value: Recordable, notifySuccess = false) => {
  try {
    await pluginsStore.configurePlugin(plugin, value)
    if (notifySuccess) message.success('common.success')
  } catch (error) {
    message.error(error)
  } finally {
    if (drafts[plugin.id] === value) delete drafts[plugin.id]
  }
}

const configure = (plugin: App.Plugin, value: Recordable, immediate = false) => {
  drafts[plugin.id] = value
  const existing = timers.get(plugin.id)
  if (existing) clearTimeout(existing)
  if (immediate) {
    timers.delete(plugin.id)
    void commitConfigure(plugin, value, true)
    return
  }
  timers.set(
    plugin.id,
    setTimeout(() => {
      timers.delete(plugin.id)
      void commitConfigure(plugin, value)
    }, 400),
  )
}

onUnmounted(() => {
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
})
</script>

<template>
  <div class="flex flex-col gap-12 mb-8">
    <template v-if="plugins.length === 0">
      <div class="px-4 py-8 text-16 font-bold">
        {{ $t('plugins.configuration') }}
      </div>
      <Card>
        <Empty />
      </Card>
    </template>

    <PluginConfigItem
      v-for="plugin in plugins"
      :key="plugin.id"
      :plugin="plugin"
      :model-value="drafts[plugin.id] ?? appSettingsStore.app.pluginSettings[plugin.id]"
      @change="(value: Recordable) => configure(plugin, value)"
      @reset="(value: Recordable) => configure(plugin, value, true)"
    >
      <template #header="{ handleResetAll }">
        <div class="flex items-center px-4 py-8">
          <strong class="mr-auto">{{ plugin.name }}</strong>
          <span class="text-12 text-muted">{{ $t('workspace.autoSaved') }}</span>
          <Button type="link" size="small" @click="handleResetAll">{{
            $t('settings.plugin.resetSettings')
          }}</Button>
        </div>
      </template>
    </PluginConfigItem>
  </div>
</template>
