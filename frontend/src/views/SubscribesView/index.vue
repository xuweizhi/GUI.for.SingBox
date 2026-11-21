<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n, I18nT } from 'vue-i18n'

import { BrowserOpenURL, ClipboardSetText, RemoveFile } from '@/bridge'
import { DraggableOptions, ViewOptions } from '@/constant/app'
import { RequestProxyMode, View } from '@/enums/app'
import { useSubscribesStore, useAppSettingsStore, usePluginsStore, useAppStore } from '@/stores'
import {
  confirm,
  formatBytes,
  formatRelativeTime,
  debounce,
  ignoredError,
  formatDate,
  message,
  modal,
} from '@/utils'

import ProxiesEditor from './components/ProxiesEditor.vue'
import ProxiesView from './components/ProxiesView.vue'
import SubscribeForm from './components/SubscribeForm.vue'
import SubscribeScript from './components/SubscribeScript.vue'

const menuList: App.Menu[] = [
  {
    label: 'subscribes.editProxies',
    handler: (id: string) => handleEditProxies(id),
  },
  {
    label: 'subscribes.editSourceFile',
    handler: (id: string) => handleEditProxies(id, true),
  },
  {
    label: 'subscribes.copySub',
    handler: async (id: string) => {
      const sub = subscribeStore.getSubscribeById(id)!
      if (sub) {
        await ClipboardSetText(sub.url)
        message.success('common.copied')
      }
    },
  },
  {
    label: 'subscribes.script',
    handler: async (id: string) => {
      const m = modal({ title: 'common.edit', width: '90' })
      m.setContent(SubscribeScript, { id }).open()
    },
  },
  {
    label: 'common.update',
    children: [
      {
        label: 'subscribes.updateDirect',
        handler: (id: string) => {
          const sub = subscribeStore.getSubscribeById(id)!
          handleUpdateSub(sub, { requestProxyMode: RequestProxyMode.None })
        },
      },
      {
        label: 'subscribes.updateSystemProxy',
        handler: (id: string) => {
          const sub = subscribeStore.getSubscribeById(id)!
          handleUpdateSub(sub, { requestProxyMode: RequestProxyMode.System })
        },
      },
      {
        label: 'subscribes.updateKernelProxy',
        handler: (id: string) => {
          const sub = subscribeStore.getSubscribeById(id)!
          handleUpdateSub(sub, { requestProxyMode: RequestProxyMode.Kernel })
        },
      },
    ],
  },
]

const { t } = useI18n()
const appStore = useAppStore()
const subscribeStore = useSubscribesStore()
const appSettingsStore = useAppSettingsStore()
const pluginsStore = usePluginsStore()
const keywords = ref('')

const filteredSubscribes = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return subscribeStore.subscribes
  return subscribeStore.subscribes.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.url || '').toLowerCase().includes(q),
  )
})

const generateMenus = (subscription: App.Subscription) => {
  const builtInMenus: App.Menu[] = menuList.map((v) => ({
    ...v,
    handler: () => v.handler?.(subscription.id),
    children: v.children?.map((child) => ({
      ...child,
      handler: () => child.handler?.(subscription.id),
    })),
  }))

  const contextMenus = pluginsStore.plugins.filter(
    (plugin) => Object.keys(plugin.context.subscriptions).length !== 0,
  )

  if (contextMenus.length !== 0) {
    builtInMenus.push(
      {
        label: '',
        separator: true,
      },
      {
        label: 'common.more',
        children: contextMenus.reduce((prev, plugin) => {
          const menus = Object.entries(plugin.context.subscriptions)
          return prev.concat(
            menus.map(([title, fn]) => {
              return {
                label: title,
                handler: async () => {
                  try {
                    plugin.running = true
                    await pluginsStore.manualTrigger(plugin.id, fn as any, subscription)
                  } catch (error: any) {
                    message.error(error)
                  } finally {
                    plugin.running = false
                  }
                },
              }
            }),
          )
        }, [] as App.Menu[]),
      },
    )
  }

  return builtInMenus
}

const handleShowSubForm = (id?: string) => {
  const m = modal({
    title: id ? 'common.edit' : 'common.add',
    class: 'subscription-dialog',
  })
  m.setContent(SubscribeForm, { id }).open()
}

const handleUpdateSubs = async () => {
  try {
    await subscribeStore.updateSubscribes({ throwOnFailure: true })
    message.success('common.success')
  } catch (error: any) {
    console.error('updateSubscribes: ', error)
    message.error(error.message || error)
  }
}

const handleSyncOutboundRefs = async () => {
  try {
    await subscribeStore.syncSubscribeOutboundRefs()
    message.success('common.success')
  } catch (error: any) {
    console.error('syncSubscribeOutboundRefs: ', error)
    message.error(error)
  }
}

const handleEditProxies = (id: string, editor = false) => {
  const sub = subscribeStore.getSubscribeById(id)
  if (sub) {
    const m = modal({ title: sub.name, height: '90', width: '90' })
    m.setContent(editor ? ProxiesEditor : ProxiesView, { sub }).open()
  }
}

const handleCopySubUrl = async (s: App.Subscription) => {
  if (!s.url) return
  await ClipboardSetText(s.url)
  message.success('common.copied')
}

const handleEditScript = (id: string) => {
  const m = modal({ title: 'common.edit', width: '90' })
  m.setContent(SubscribeScript, { id }).open()
}

const handleUpdateSub = async (s: App.Subscription, options?: Partial<App.Subscription>) => {
  try {
    await subscribeStore.updateSubscribe(s.id, options)
  } catch (error: any) {
    console.error('updateSubscribe: ', error)
    message.error(error)
  }
}

const refreshingUsage = ref(new Set<string>())
const handleRefreshUsage = async (id: string) => {
  if (refreshingUsage.value.has(id)) return
  refreshingUsage.value.add(id)
  try {
    if (await subscribeStore.refreshUsage(id)) message.success('subscribes.usageRefreshed')
    else message.info('subscribes.usageNotReported')
  } catch (error) {
    message.error(error)
  } finally {
    refreshingUsage.value.delete(id)
  }
}

const handleDeleteSub = async (s: App.Subscription) => {
  try {
    await confirm(t('common.delete'), t('common.confirmDelete', [s.name]), {
      type: 'text',
      okText: 'common.delete',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await ignoredError(RemoveFile, s.path)
    await subscribeStore.deleteSubscribe(s.id)
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteSubscribe: ', error)
    message.error(error)
  }
}

const handleDisableSub = async (s: App.Subscription) => {
  s.disabled = !s.disabled
  subscribeStore.editSubscribe(s.id, s)
}

const noUpdateNeeded = computed(() => subscribeStore.subscribes.every((v) => v.disabled))

const usageKnown = (s: App.Subscription, field: 'upload' | 'download' | 'total') =>
  s[field] > 0 || !!s.usageFields?.includes(field)

const clacTrafficPercent = (s: App.Subscription) =>
  s.total > 0 ? ((s.upload + s.download) / s.total) * 100 : 0

const clacTrafficStatus = (s: App.Subscription) => {
  const percent = clacTrafficPercent(s)
  if (percent > 90) return 'danger'
  if (percent > 80) return 'warning'
  return 'primary'
}

const onSortUpdate = debounce(subscribeStore.saveSubscribes, 1000)
</script>

<template>
  <div v-if="subscribeStore.subscribes.length === 0" class="grid-list-empty">
    <Empty>
      <template #description>
        <I18nT keypath="subscribes.empty" tag="div" scope="global" class="flex items-center mt-12">
          <template #action>
            <Button type="link" @click="handleShowSubForm()">{{ t('common.add') }}</Button>
          </template>
        </I18nT>
        <div class="flex items-center">
          <CustomAction :actions="appStore.customActions.subscriptions_header" />
        </div>
      </template>
    </Empty>
  </div>

  <div v-else class="grid-list-header subscriptions-toolbar">
    <Radio v-model="appSettingsStore.app.subscribesView" :options="ViewOptions" />
    <span class="resource-count-badge">
      {{
        keywords.trim()
          ? `${filteredSubscribes.length} / ${subscribeStore.subscribes.length}`
          : subscribeStore.subscribes.length
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
    <div class="subscriptions-actions">
      <CustomAction :actions="appStore.customActions.subscriptions_header" />
      <Button
        :disabled="noUpdateNeeded"
        :type="noUpdateNeeded ? 'text' : 'link'"
        @click="handleUpdateSubs"
      >
        {{ t('common.updateAll') }}
      </Button>
      <Button type="link" @click="handleSyncOutboundRefs">
        {{ t('subscribes.syncOutboundRefs') }}
      </Button>
    </div>
    <Button type="primary" icon="add" class="subscriptions-add" @click="handleShowSubForm()">
      {{ t('common.add') }}
    </Button>
  </div>

  <Empty v-if="subscribeStore.subscribes.length > 0 && filteredSubscribes.length === 0" />

  <div
    v-else-if="subscribeStore.subscribes.length > 0"
    v-draggable="[
      subscribeStore.subscribes,
      { ...DraggableOptions, disabled: Boolean(keywords.trim()), onUpdate: onSortUpdate },
    ]"
    :class="'grid-list-' + appSettingsStore.app.subscribesView"
  >
    <Card
      v-for="s in filteredSubscribes"
      :key="s.id"
      v-menu="generateMenus(s)"
      :title="s.name"
      :disabled="s.disabled"
      class="grid-list-item"
    >
      <template #title-prefix>
        <Tag v-if="s.updating" color="cyan" size="small">
          {{ t('subscribe.updating') }}
        </Tag>
      </template>

      <template #title-suffix>
        <Icon
          v-if="s.type !== 'File' && s.website"
          v-tips="'subscribe.website'"
          icon="link"
          color="var(--muted-color)"
          class="mx-4 cursor-pointer shrink-0"
          @click="BrowserOpenURL(s.website)"
        />
      </template>

      <template v-if="appSettingsStore.app.subscribesView === View.Grid" #extra>
        <Dropdown>
          <Button
            type="text"
            size="small"
            icon="more"
            :aria-label="t('common.more') + ' · ' + s.name"
          />
          <template #overlay="{ close }">
            <div class="flex flex-col gap-2 min-w-128 p-6">
              <Button
                :disabled="s.disabled"
                :loading="s.updating"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    handleUpdateSub(s)
                    close()
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
                    handleEditProxies(s.id)
                    close()
                  }
                "
              >
                {{ t('subscribes.editProxies') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    handleEditProxies(s.id, true)
                    close()
                  }
                "
              >
                {{ t('subscribes.editSourceFile') }}
              </Button>
              <Button
                v-if="s.url"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    handleCopySubUrl(s)
                    close()
                  }
                "
              >
                {{ t('subscribes.copySub') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    handleEditScript(s.id)
                    close()
                  }
                "
              >
                {{ t('subscribes.script') }}
              </Button>
              <Divider size="small" />
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    handleDisableSub(s)
                    close()
                  }
                "
              >
                {{ s.disabled ? t('common.enable') : t('common.disable') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    handleShowSubForm(s.id)
                    close()
                  }
                "
              >
                {{ t('common.edit') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start text-danger"
                @click="
                  () => {
                    close()
                    handleDeleteSub(s)
                  }
                "
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </template>
        </Dropdown>
      </template>

      <template v-else #extra>
        <Button
          :disabled="s.disabled"
          :loading="s.updating"
          type="text"
          size="small"
          @click="handleUpdateSub(s)"
        >
          {{ t('common.update') }}
        </Button>
        <Button type="text" size="small" @click="handleEditProxies(s.id)">
          {{ t('subscribes.editProxies') }}
        </Button>
        <Button type="text" size="small" @click="handleDisableSub(s)">
          {{ s.disabled ? t('common.enable') : t('common.disable') }}
        </Button>
        <Button type="text" size="small" @click="handleShowSubForm(s.id)">
          {{ t('common.edit') }}
        </Button>
        <Button type="text" size="small" class="text-danger" @click="handleDeleteSub(s)">
          {{ t('common.delete') }}
        </Button>
      </template>

      <template v-if="appSettingsStore.app.subscribesView === View.List">
        <div style="margin-bottom: 8px">
          <Progress :percent="clacTrafficPercent(s)" :status="clacTrafficStatus(s)" />
        </div>
        <div class="resource-meta-list">
          <div>
            {{ t('subscribes.proxyCount') }}:
            <span class="resource-meta-value">{{ s.proxies.length }}</span>
          </div>
          <div>
            {{ t('subscribes.upload') }}:
            <span class="resource-meta-value">
              {{ usageKnown(s, 'upload') ? formatBytes(s.upload, 2) : '--' }}
            </span>
            · {{ t('subscribes.download') }}:
            <span class="resource-meta-value">
              {{ usageKnown(s, 'download') ? formatBytes(s.download, 2) : '--' }}
            </span>
            · {{ t('subscribes.total') }}:
            <span class="resource-meta-value">
              {{ usageKnown(s, 'total') ? formatBytes(s.total, 2) : '--' }}
            </span>
          </div>
          <div>
            {{ t('subscribes.expire') }}:
            {{ s.expire ? formatDate(s.expire, 'YYYY-MM-DD HH:mm:ss') : '--' }} ·
            {{ t('common.updateTime') }}:
            {{ s.updateTime ? formatDate(s.updateTime, 'YYYY-MM-DD HH:mm:ss') : '--' }}
          </div>
        </div>
      </template>
      <template v-else>
        <div class="subscription-summary">
          <div class="subscription-traffic">
            {{
              usageKnown(s, 'upload') || usageKnown(s, 'download')
                ? formatBytes(s.upload + s.download)
                : '--'
            }}
            /
            {{ usageKnown(s, 'total') ? formatBytes(s.total) : '--' }}
          </div>
          <div class="traffic-diagram">
            <Progress
              :percent="clacTrafficPercent(s)"
              :status="clacTrafficStatus(s)"
              type="circle"
              :radius="20"
            />
          </div>
          <div class="subscription-meta">
            {{ t('subscribes.expire') }}:
            {{ s.expire ? formatRelativeTime(s.expire) : '--' }}
          </div>
          <div class="subscription-meta">
            {{ t('common.updateTime') }}:
            {{ s.updateTime ? formatRelativeTime(s.updateTime) : '--' }}
          </div>
          <div class="subscription-meta">
            {{ t('subscribes.proxyCount') }}:
            <span class="resource-meta-value">{{ s.proxies.length }}</span>
          </div>
        </div>
      </template>
      <div v-if="s.type === 'Http'" class="subscription-usage mt-6">
        <Button
          type="link"
          size="small"
          :disabled="s.disabled || s.updating"
          :loading="refreshingUsage.has(s.id)"
          style="padding-left: 0"
          @click="handleRefreshUsage(s.id)"
        >
          {{ t('subscribes.refreshUsage') }}
        </Button>
        <span v-if="s.total > 0 && usageKnown(s, 'upload') && usageKnown(s, 'download')">
          {{
            t('subscribes.remaining', [formatBytes(Math.max(0, s.total - s.upload - s.download))])
          }}
        </span>
        <span v-if="s.usageUpdatedAt" :title="formatDate(s.usageUpdatedAt, 'YYYY-MM-DD HH:mm:ss')">
          {{ t('subscribes.usageAsOf', [formatRelativeTime(s.usageUpdatedAt)]) }}
        </span>
      </div>

      <div v-if="appSettingsStore.app.subscribesView === View.Grid" class="resource-card-footer">
        <Button
          :disabled="s.disabled"
          :loading="s.updating"
          type="normal"
          size="small"
          icon="refresh"
          @click="handleUpdateSub(s)"
        >
          {{ t('common.update') }}
        </Button>
        <Button type="text" size="small" @click="handleEditProxies(s.id)">
          {{ t('subscribes.editProxies') }}
        </Button>
        <Button type="text" size="small" class="ml-auto" @click="handleShowSubForm(s.id)">
          {{ t('common.edit') }}
        </Button>
      </div>
    </Card>
  </div>
</template>

<style lang="less" scoped>
.subscription-usage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-color);
}
.traffic-diagram {
  position: absolute;
  top: 4px;
  right: 0;
}
.subscription-summary {
  position: relative;
  padding-right: 56px;
}
.subscription-traffic {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 10px;
}
.subscription-meta {
  font-size: 13px;
  color: var(--muted-color);
  line-height: 1.8;
}
.subscriptions-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
@media (max-width: 700px) {
  .subscriptions-toolbar {
    display: flex;
  }
  .subscriptions-add {
    margin-left: auto;
    min-height: 36px;
  }
}
</style>

<style>
.subscription-dialog.gui-modal-modal:not(.is-maximized) {
  width: 720px !important;
  min-width: 0 !important;
}
</style>
