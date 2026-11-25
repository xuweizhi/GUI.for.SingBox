<script lang="ts" setup>
import { computed, shallowReactive } from 'vue'

import { useAppSettingsStore, usePluginsStore } from '@/stores'
import { message } from '@/utils'
import PluginConfigItem from '@/views/PluginsView/components/PluginConfigItem.vue'

const appSettingsStore = useAppSettingsStore()
const pluginsStore = usePluginsStore()

const plugins = computed(() =>
  pluginsStore.plugins.filter((plugin) => plugin.configuration.length > 0),
)
const drafts = shallowReactive<Record<string, Recordable>>({})
const configure = async (plugin: App.Plugin, value: Recordable) => {
  drafts[plugin.id] = value
  try {
    await pluginsStore.configurePlugin(plugin, value)
  } catch (error) {
    message.error(error)
  } finally {
    if (drafts[plugin.id] === value) delete drafts[plugin.id]
  }
}
</script>

<template>
  <div class="flex flex-col gap-8 pr-12 mb-8">
    <template v-if="plugins.length === 0">
      <div class="px-8 py-12 text-18 font-bold">
        {{ $t('plugins.configuration') }}
      </div>
      <Card>
        <div class="py-32"><Empty /></div>
      </Card>
    </template>

    <PluginConfigItem
      v-for="plugin in plugins"
      :key="plugin.id"
      :plugin="plugin"
      :model-value="drafts[plugin.id] ?? appSettingsStore.app.pluginSettings[plugin.id]"
      @change="(value: Recordable) => configure(plugin, value)"
    >
      <template #header="{ handleResetAll }">
        <div class="flex items-center px-8 py-12">
          <Dropdown>
            <Button
              icon="settings"
              type="text"
              size="small"
              class="mr-4"
              style="margin-left: -8px"
            />
            <template #overlay="{ close }">
              <div class="flex flex-col gap-4 min-w-64 p-4">
                <Button
                  type="text"
                  size="small"
                  @click="
                    () => {
                      handleResetAll()
                      close()
                    }
                  "
                >
                  {{ $t('settings.plugin.resetSettings') }}
                </Button>
              </div>
            </template>
          </Dropdown>
          <div class="text-18 font-bold">{{ plugin.name }}</div>
        </div>
      </template>
    </PluginConfigItem>
  </div>
</template>
