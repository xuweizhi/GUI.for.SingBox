<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'

import { DraggableOptions, ViewOptions } from '@/constant/app'
import { PluginTriggerEvent, PluginTrigger, View } from '@/enums/app'
import { usePluginsStore, useAppSettingsStore } from '@/stores'
import { confirm, debounce, message, deepClone, modal } from '@/utils'

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
  const m = modal({ title: 'plugins.configuration' })
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

const filteredPlugins = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return pluginsStore.plugins
  return pluginsStore.plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q),
  )
})

const handleImportPlugin = () => {
  const m = modal({
    title: 'plugins.hub',
    height: '90',
    width: '90',
    submit: false,
    maskClosable: true,
    cancelText: 'common.close',
  })
  m.setContent(PluginHub).open()
}

const openPluginFormModal = (id?: string) => {
  const m = modal({ title: id ? 'common.edit' : 'common.add', minWidth: '80' })
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

  return builtInMenus.concat(...pluginMenus)
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

  <div v-else class="grid-list-header">
    <Radio v-model="appSettingsStore.app.pluginsView" :options="ViewOptions" />
    <span class="resource-count-badge">
      {{
        keywords.trim()
          ? `${filteredPlugins.length} / ${pluginsStore.plugins.length}`
          : pluginsStore.plugins.length
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
    <Button type="link" @click="handleImportPlugin">
      {{ t('plugins.hub') }}
    </Button>
    <Button
      :loading="pluginsStore.pluginHubLoading"
      type="link"
      @click="handleUpdatePluginHub"
    >
      {{ t('plugins.checkForUpdates') }}
    </Button>
    <Button :disabled="noUpdateNeeded" :type="noUpdateNeeded ? 'text' : 'link'" :loading="updatingAll" @click="handleUpdatePlugins">
      {{ t('common.updateAll') }}
    </Button>
    <Button type="primary" icon="add" class="ml-16" @click="handleAddPlugin">
      {{ t('common.add') }}
    </Button>
  </div>

  <Empty v-if="pluginsStore.plugins.length > 0 && filteredPlugins.length === 0" />

  <VueDraggable
    v-else-if="pluginsStore.plugins.length > 0"
    v-model="pluginsStore.plugins"
    v-bind="DraggableOptions"
    @update="onSortUpdate"
    :disabled="Boolean(keywords.trim())"
    :class="'grid-list-' + appSettingsStore.app.pluginsView"
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

      <template #extra>
        <Dropdown v-if="appSettingsStore.app.pluginsView === View.Grid">
          <Button
            type="text"
            size="small"
            icon="more"
            :aria-label="t('common.more') + ' · ' + p.name"
          />
          <template #overlay="{ close }">
            <div class="flex flex-col gap-2 min-w-128 p-6">
              <Button
                v-if="p.configuration.length"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleConfigurePlugin(p)
                  }
                "
              >
                {{ t('plugins.configuration') }}
              </Button>
              <Button
                :loading="p.updating"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleUpdatePlugin(p)
                  }
                "
              >
                {{ t('common.update') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleReloadPlugin(p.id)
                  }
                "
              >
                {{ t('plugins.reload') }}
              </Button>
              <template v-if="Object.keys(p.menus).length">
                <Divider size="small" />
                <Button
                  v-for="(fn, title) in p.menus"
                  :key="title"
                  type="text"
                  size="small"
                  class="justify-start"
                  @click="
                    () => {
                      close()
                      handlePluginMenuTrigger(p, fn)
                    }
                  "
                >
                  {{ t(title) }}
                </Button>
              </template>
              <Divider size="small" />
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleDisablePlugin(p)
                  }
                "
              >
                {{ p.disabled ? t('common.enable') : t('common.disable') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleEditPlugin(p.id)
                  }
                "
              >
                {{ t('common.develop') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start text-danger"
                @click="
                  () => {
                    close()
                    handleDeletePlugin(p)
                  }
                "
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </template>
        </Dropdown>

        <template v-else>
          <Button
            v-if="p.configuration.length"
            type="text"
            size="small"
            @click="handleConfigurePlugin(p)"
          >
            {{ t('plugins.configuration') }}
          </Button>
          <Button :loading="p.updating" type="text" size="small" @click="handleUpdatePlugin(p)">
            {{ t('common.update') }}
          </Button>
          <Button type="text" size="small" @click="handleReloadPlugin(p.id)">
            {{ t('plugins.reload') }}
          </Button>
          <Button type="text" size="small" @click="handleDisablePlugin(p)">
            {{ p.disabled ? t('common.enable') : t('common.disable') }}
          </Button>
          <Button type="text" size="small" @click="handleEditPlugin(p.id)">
            {{ t('common.develop') }}
          </Button>
          <Button type="text" size="small" class="text-danger" @click="handleDeletePlugin(p)">
            {{ t('common.delete') }}
          </Button>
        </template>
      </template>

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
              v-tips="p.triggers.map((v) => t('plugin.' + v)).join('、')"
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
        <Button
          type="link"
          size="small"
          class="pl-0"
          @click="handleEditPluginCode(p.id, p.name)"
        >
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
