<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { HttpGet } from '@/bridge'
import { DefaultPluginHubSources } from '@/constant/app'
import { useBool } from '@/hooks'
import { useAppSettingsStore, usePluginsStore } from '@/stores'
import { previewCode, createTextMatcher, deepClone, message } from '@/utils'

import ResourceHubModal from '@/components/_common/ResourceHubModal.vue'

const keywords = ref('')
const category = ref('')

const { t } = useI18n()
const [settingsModalOpen, toggleSettingsModal] = useBool(false)
const appSettingsStore = useAppSettingsStore()
const pluginsStore = usePluginsStore()
const loadingSet = ref(new Set<string>())

const groupOrders = ['Recommended', 'Extensions', 'Tools', 'Fun', 'Examples', 'Development']

const groups = computed(() => {
  const map: Record<string, App.Plugin[]> = {}
  pluginsStore.pluginHub.forEach((plugin) => {
    const group = plugin.group || 'Others'
    if (!map[group]) {
      map[group] = []
    }
    map[group].push(plugin)
  })
  return Object.keys(map)
    .map((name) => ({
      name,
      plugins: map[name]!,
    }))
    .sort((a, b) => {
      const indexA = groupOrders.indexOf(a.name)
      const indexB = groupOrders.indexOf(b.name)
      if (indexA === -1 && indexB === -1) {
        return a.name.localeCompare(b.name)
      }
      if (indexA === -1) return 1
      if (indexB === -1) return -1
      return indexA - indexB
    })
})

const filteredPlugins = computed(() => {
  const keyword = keywords.value.trim()
  const visible = category.value
    ? groups.value.filter((g) => g.name === category.value)
    : groups.value
  if (!keyword) return visible
  const match = createTextMatcher(keyword.toLocaleLowerCase(), '')
  return visible
    .map((group) => ({
      name: group.name,
      plugins: group.plugins.filter((plugin) =>
        match([plugin.id, plugin.name, plugin.description].join('').toLocaleLowerCase()),
      ),
    }))
    .filter((group) => group.plugins.length)
})

const handleAddPlugin = async (plugin: App.Plugin) => {
  if (loadingSet.value.has(plugin.id) || isAlreadyAdded(plugin.id)) return
  loadingSet.value.add(plugin.id)
  try {
    await pluginsStore.addPlugin(deepClone(plugin))
    message.success('common.added')
  } catch (err: any) {
    message.error(err.message || err)
  } finally {
    loadingSet.value.delete(plugin.id)
  }
}

const previewingId = ref('')
const previewPlugin = async (plugin: App.Plugin) => {
  if (previewingId.value) return
  previewingId.value = plugin.id
  try {
    const { status, body } = await HttpGet<string>(plugin.url)
    if (status < 200 || status >= 300) throw new Error('HTTP ' + status)
    previewCode(plugin.name, body, 'javascript')
  } catch (error) {
    message.error(error)
  } finally {
    previewingId.value = ''
  }
}
const handleUpdatePluginHub = async () => {
  try {
    await pluginsStore.updatePluginHub()
    message.success('plugins.updateSuccess')
  } catch (err: any) {
    message.error(err.message || err)
  }
}

const handleAddSource = () => {
  appSettingsStore.app.plugins.sources.push({ enable: false, name: '', url: '' })
}

const handleRemoveSource = (index: number) => {
  appSettingsStore.app.plugins.sources.splice(index, 1)
}

const restoreDefaultSources = () => {
  appSettingsStore.app.plugins.sources = DefaultPluginHubSources()
}

const isAlreadyAdded = (id: string) => pluginsStore.getPluginById(id)

if (pluginsStore.pluginHub.length === 0) {
  void handleUpdatePluginHub()
}
</script>

<template>
  <ResourceHubModal
    v-model:query="keywords"
    v-model:category="category"
    :categories="groups.map((g) => g.name)"
    :loading="pluginsStore.pluginHubLoading"
    :count="filteredPlugins.length"
    @refresh="handleUpdatePluginHub"
  >
    <template #actions
      ><Button
        icon="settings3"
        size="small"
        :aria-label="t('plugins.sourceConfig.name')"
        @click="toggleSettingsModal"
    /></template>
    <div v-for="group in filteredPlugins" :key="group.name">
      <div class="text-16 font-bold mt-20 px-4">{{ group.name }}</div>

      <div class="plugin-hub__grid py-8">
        <Card v-for="plugin in group.plugins" :key="plugin.id">
          <template #title-prefix>
            <div class="text-14 font-bold">{{ plugin.name }}</div>
          </template>
          <div class="flex items-center gap-8">
            <div v-tips="plugin.description" class="flex-1 line-clamp-2 text-12 text-muted">
              {{ plugin.description || '--' }}
            </div>
            <Button
              v-if="plugin.url"
              icon="preview"
              size="small"
              type="text"
              :loading="previewingId === plugin.id"
              :aria-label="t('common.preview')"
              @click="previewPlugin(plugin)"
            />
            <Button v-if="loadingSet.has(plugin.id)" loading type="text" size="small" />
            <div v-else class="flex items-center shrink-0">
              <Tag v-if="isAlreadyAdded(plugin.id)" size="small">{{ t('common.added') }}</Tag>
              <Button
                v-else
                type="normal"
                icon="add"
                size="small"
                @click="handleAddPlugin(plugin)"
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  </ResourceHubModal>

  <Modal
    v-model:open="settingsModalOpen"
    title="plugins.sourceConfig.name"
    size="md"
    :submit="false"
    cancel-text="common.close"
  >
    <template #action>
      <div class="mr-auto">
        <Button type="link" @click="restoreDefaultSources">{{ t('plugin.restore') }}</Button>
      </div>
    </template>

    <Card v-for="(source, index) in appSettingsStore.app.plugins.sources" :key="index" class="mb-8">
      <template #extra>
        <Button icon="delete" type="text" size="small" @click="handleRemoveSource(index)" />
      </template>
      <template #title-prefix>
        <div class="flex items-center gap-8 font-bold">
          <Switch v-model="source.enable" border="square" />
          <Input v-model="source.name" editable />
        </div>
      </template>
      <Input v-model="source.url" class="w-full" placeholder="https://" />
    </Card>

    <Empty v-if="appSettingsStore.app.plugins.sources.length == 0" />

    <Button icon="add" class="w-full" type="primary" @click="handleAddSource" />
  </Modal>
</template>

<style scoped>
.plugin-hub__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 10px;
}
</style>
