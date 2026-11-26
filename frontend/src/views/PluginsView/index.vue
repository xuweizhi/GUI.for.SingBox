<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { PluginTriggerEvent, PluginTrigger, View } from '@/enums/app'
import { usePluginsStore, useAppSettingsStore } from '@/stores'
import { confirm, debounce, message, deepClone, modal } from '@/utils'

import ResourceActions from '@/components/_common/ResourceActions.vue'
import ResourcePageShell from '@/components/_common/ResourcePageShell.vue'
import Button from '@/components/Button/index.vue'

import PluginChangelog from './components/PluginChangelog.vue'
import PluginConfigurator from './components/PluginConfigurator.vue'
import PluginForm from './components/PluginForm.vue'
import PluginHub from './components/PluginHub.vue'
import PluginView from './components/PluginView.vue'

const handleReloadPlugin = async (id: string) => {
  const plugin = pluginsStore.getPluginById(id)
  try {
    await pluginsStore.reloadPlugin(plugin!)
    message.success('common.success')
  } catch (error: any) {
    console.log(error)
    message.error(error)
  }
}

const handleConfigurePlugin = (plugin: App.Plugin) => {
  const m = modal({ title: 'plugins.configuration', size: 'md' })
  m.setContent(PluginConfigurator, { plugin }).open()
}

const menuList: App.Menu[] = [
  {
    label: 'plugins.reload',
    handler: handleReloadPlugin,
  },
]

const { t } = useI18n()

const pluginsStore = usePluginsStore()
const appSettingsStore = useAppSettingsStore()
const keywords = ref('')

const matches = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return pluginsStore.plugins
  return pluginsStore.plugins.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q),
  )
})
const filter = ref('')
const sort = ref('manual')
const filters = [
  { label: 'common.enabled', value: 'enabled' },
  { label: 'common.disabled', value: 'disabled' },
]
const filteredPlugins = computed(() => {
  const records = matches.value.filter(
    (item) => !filter.value || (filter.value === 'disabled' ? item.disabled : !item.disabled),
  )
  return sort.value === 'name' ? records.sort((a, b) => a.name.localeCompare(b.name)) : records
})

const handleImportPlugin = () => {
  const m = modal({
    title: 'plugins.hub',
    toolbar: { minimize: true, maximize: true },
    height: '90',
    width: '90',
    submit: false,
    maskClosable: true,
    cancelText: 'common.close',
  })
  m.setContent(PluginHub).open()
}

const openPluginFormModal = (id?: string) => {
  const m = modal({ title: id ? 'common.edit' : 'common.add', size: 'lg' })
  m.setContent(PluginForm, { id }).open()
}

const handleAddPlugin = () => {
  openPluginFormModal()
}

const handleEditPlugin = (id: string) => {
  openPluginFormModal(id)
}

const handleViewChangelog = (id: string) => {
  const m = modal({
    title: 'Changelog',
    cancelText: 'common.close',
    width: '90',
    height: '90',
    submit: false,
    maskClosable: true,
  })
  m.setContent(PluginChangelog, { id }).open()
}

const handleUpdatePluginHub = async () => {
  try {
    await pluginsStore.updatePluginHub()
    message.success('plugins.updateSuccess')
  } catch (error: any) {
    console.error('handleUpdatePluginHub: ', error)
    message.error(error)
  }
}

const updatingAll = ref(false)
const handleUpdatePlugins = async () => {
  if (updatingAll.value || pluginsStore.plugins.some((item) => item.updating)) return
  updatingAll.value = true
  try {
    const results = await pluginsStore.updatePlugins()
    const failures = results.filter((item) => !item.ok)
    if (failures.length) throw new Error(failures.map((item) => item.result).join('\n'))
    message.success('common.success')
  } catch (error: any) {
    console.error('handleUpdatePlugins: ', error)
    message.error(error)
  } finally {
    updatingAll.value = false
  }
}

const handleUpdatePlugin = async (s: App.Plugin) => {
  if (updatingAll.value || s.updating) return
  try {
    await pluginsStore.updatePlugin(s.id)
    message.success('common.success')
  } catch (error: any) {
    console.error('handleUpdatePlugin: ', error)
    message.error(error)
  }
}

const handleDeletePlugin = async (p: App.Plugin) => {
  try {
    await confirm(t('common.delete'), t('common.confirmDelete', [p.name]), {
      type: 'text',
      okText: 'common.delete',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await pluginsStore.deletePlugin(p.id)
    message.success('common.success')
  } catch (error: any) {
    console.error('handleDeletePlugin: ', error)
    message.error(error)
  }
}

const handleDisablePlugin = async (p: App.Plugin) => {
  const nextPlugin = deepClone(p)
  nextPlugin.disabled = !nextPlugin.disabled

  try {
    await pluginsStore.editPlugin(p.id, nextPlugin)
  } catch (error: any) {
    console.error('handleDisablePlugin: ', error)
    message.error(error)
  }
}

const handleEditPluginCode = (id: string, title: string) => {
  const m = modal({ title, width: '90' })
  m.setContent(PluginView, { id }).open()
}

const handleOnRun = async (p: App.Plugin) => {
  p.running = true
  try {
    await pluginsStore.manualTrigger(p.id, PluginTriggerEvent.OnManual)
  } catch (error: any) {
    message.error(error)
  }
  p.running = false
}

const handlePluginMenuTrigger = async (p: App.Plugin, fn: string) => {
  try {
    p.running = true
    await pluginsStore.manualTrigger(p.id, fn as any)
  } catch (error: any) {
    message.error(error)
  } finally {
    p.running = false
  }
}

const generateMenus = (p: App.Plugin) => {
  const builtInMenus: App.Menu[] = menuList.map((v) => ({ ...v, handler: () => v.handler?.(p.id) }))

  if (p.configuration.length) {
    builtInMenus.push({
      label: 'plugins.configuration',
      handler: () => handleConfigurePlugin(p),
    })
  }

  if (Object.keys(p.menus).length !== 0) {
    builtInMenus.push({
      label: '',
      separator: true,
    })
  }

  const pluginMenus: App.Menu[] = Object.entries(p.menus).map(([title, fn]) => ({
    label: title,
    handler: () => handlePluginMenuTrigger(p, fn),
  }))

  return [
    { label: 'common.update', disabled: p.updating, handler: () => handleUpdatePlugin(p) },
    ...builtInMenus,
    ...pluginMenus,
    { label: 'plugins.source', handler: () => handleEditPluginCode(p.id, p.name) },
    ...(p.triggers.includes(PluginTrigger.OnManual) && !p.disabled
      ? [{ label: 'common.run', handler: () => handleOnRun(p) }]
      : []),
    {
      label: p.disabled ? 'common.enable' : 'common.disable',
      handler: () => handleDisablePlugin(p),
    },
    { label: 'common.develop', handler: () => handleEditPlugin(p.id) },
    { label: 'common.delete', handler: () => handleDeletePlugin(p) },
  ]
}

const noUpdateNeeded = computed(() => pluginsStore.plugins.every((v) => v.disabled))

const onSortUpdate = debounce(pluginsStore.savePlugins, 1000)
</script>

<template>
  <div v-if="pluginsStore.plugins.length === 0" class="grid-list-empty">
    <Empty>
      <template #description>
        <I18nT keypath="plugins.empty" tag="div" scope="global" class="flex items-center mt-12">
          <template #action>
            <Button type="link" @click="handleAddPlugin">{{ t('common.add') }}</Button>
          </template>
          <template #import>
            <Button type="link" @click="handleImportPlugin">{{ t('plugins.hub') }}</Button>
          </template>
        </I18nT>
      </template>
    </Empty>
  </div>

  <ResourcePageShell
    v-else
    v-model:query="keywords"
    v-model:view="appSettingsStore.app.pluginsView"
    v-model:sort="sort"
    v-model:filter="filter"
    :filters="filters"
    :total="pluginsStore.plugins.length"
    :count="filteredPlugins.length"
  >
    <Button type="link" @click="handleImportPlugin">
      {{ t('plugins.hub') }}
    </Button>
    <Button :loading="pluginsStore.pluginHubLoading" type="link" @click="handleUpdatePluginHub">
      {{ t('plugins.checkForUpdates') }}
    </Button>
    <Button
      :disabled="noUpdateNeeded"
      :type="noUpdateNeeded ? 'text' : 'link'"
      :loading="updatingAll"
      @click="handleUpdatePlugins"
    >
      {{ t('common.updateAll') }}
    </Button>
    <Button type="primary" icon="add" @click="handleAddPlugin">
      {{ t('common.add') }}
    </Button>
  </ResourcePageShell>

  <VueDraggable
    v-if="filteredPlugins.length"
    v-model="pluginsStore.plugins"
    v-bind="DraggableOptions"
    :disabled="Boolean(keywords.trim() || filter || sort !== 'manual')"
    :class="'grid-list-' + appSettingsStore.app.pluginsView"
    @update="onSortUpdate"
  >
    <Card
      v-for="p in filteredPlugins"
      :key="p.id"
      v-menu="generateMenus(p)"
      :title="p.name"
      :disabled="p.disabled"
      class="grid-list-item"
    >
      <template #title-prefix>
        <span
          v-show="p.status !== 0"
          class="plugin-status-dot"
          :class="p.status === 1 ? 'is-ok' : 'is-error'"
          aria-hidden="true"
        ></span>
        <Tag v-if="pluginsStore.isDevVersion(p)" color="purple" size="small">Dev</Tag>
        <Tag v-if="pluginsStore.isDeprecated(p)" color="red" size="small">
          {{ t('plugins.deprecated') }}
        </Tag>
        <Tag
          v-if="pluginsStore.hasNewPluginVersion(p)"
          size="small"
          color="cyan"
          class="cursor-pointer"
          @click="handleViewChangelog(p.id)"
        >
          {{ t('plugins.newVersion') }}
        </Tag>
        <Tag v-if="p.updating" color="cyan" size="small">
          {{ t('plugins.updating') }}
        </Tag>
      </template>

      <template #extra><ResourceActions :items="generateMenus(p)" :name="p.name" /></template>

      <div class="resource-meta-list">
        <div class="flex flex-wrap items-center gap-4">
          <span class="text-12">{{ t('plugin.trigger') }}:</span>
          <Tag v-if="p.triggers.length === 0" size="small" color="red">{{ t('common.none') }}</Tag>

          <template v-else-if="appSettingsStore.app.pluginsView === View.Grid">
            <Tag v-for="trigger in p.triggers.slice(0, 2)" :key="trigger" size="small">
              {{ t('plugin.' + trigger) }}
            </Tag>
            <Tag
              v-if="p.triggers.length > 2"
              v-tips="p.triggers.map((v) => t('plugin.' + v)).join(', ')"
              size="small"
              color="cyan"
            >
              +{{ p.triggers.length - 2 }}
            </Tag>
          </template>
          <template v-else>
            <Tag v-for="trigger in p.triggers" :key="trigger" size="small">
              {{ t('plugin.' + trigger) }}
            </Tag>
          </template>
        </div>

        <div
          v-tips="p.description"
          :class="{ 'line-clamp-2': appSettingsStore.app.pluginsView === View.Grid }"
          class="text-12 text-muted mt-4"
        >
          {{ p.description || '--' }}
        </div>
      </div>

      <div class="flex items-center gap-6 mt-10">
        <Button type="link" size="small" class="pl-0" @click="handleEditPluginCode(p.id, p.name)">
          {{ t('plugins.source') }}
        </Button>
        <Button
          v-if="p.configuration.length"
          type="link"
          size="small"
          @click="handleConfigurePlugin(p)"
        >
          {{ t('plugins.configuration') }}
        </Button>

        <template v-if="p.triggers.includes(PluginTrigger.OnManual)">
          <Button
            v-if="!p.disabled"
            :loading="p.running"
            :icon="p.hasUI ? 'sparkle' : undefined"
            type="primary"
            size="small"
            class="ml-auto"
            @click="handleOnRun(p)"
          >
            {{ t('common.run') }}
          </Button>
        </template>
      </div>
    </Card>
  </VueDraggable>
</template>

<style lang="less" scoped>
.plugin-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
  margin-right: 2px;

  &.is-ok {
    background: var(--success-color);
    box-shadow: 0 0 0 3px var(--success-soft);
  }
  &.is-error {
    background: var(--danger-color);
    box-shadow: 0 0 0 3px var(--danger-soft);
  }
}
</style>
