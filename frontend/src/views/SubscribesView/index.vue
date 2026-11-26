<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'

import { BrowserOpenURL, ClipboardSetText } from '@/bridge'
import { DraggableOptions } from '@/constant/app'
import { RequestProxyMode, View } from '@/enums/app'
import {
  useProfilesStore,
  useNodeGroupsStore,
  useSubscribesStore,
  useAppSettingsStore,
  usePluginsStore,
  useAppStore,
} from '@/stores'
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
import { removeUnusedResourceCache } from '@/utils/configPersistence'
import { profileUsesSubscription } from '@/utils/nodeGroup'

import ResourceActions from '@/components/_common/ResourceActions.vue'
import ResourcePageShell from '@/components/_common/ResourcePageShell.vue'

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
      const sub = subscribeStore.getSubscribeById(id)
      if (!sub) return
      try {
        const ok = await ClipboardSetText(sub.url)
        if (!ok) throw 'ClipboardSetText Error'
        message.success('common.copied')
      } catch (error: any) {
        message.error(error?.message || error)
      }
    },
  },
  {
    label: 'subscribes.script',
    handler: async (id: string) => {
      const sub = subscribeStore.getSubscribeById(id)
      const m = modal({
        title: sub ? `${sub.name} · ${t('subscribes.script')}` : 'subscribes.script',
        width: '90',
        height: '90',
      })
      m.setContent(SubscribeScript, { id }).open()
    },
  },
  {
    label: 'settings.requestProxy.name',
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
const profilesStore = useProfilesStore()
const groupsStore = useNodeGroupsStore()
const subscribeStore = useSubscribesStore()
const appSettingsStore = useAppSettingsStore()
const pluginsStore = usePluginsStore()
const usedBy = (id: string) =>
  profilesStore.profiles.filter((p) => profileUsesSubscription(p, id, groupsStore.nodeGroups))
const keywords = ref('')

const matches = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return subscribeStore.subscribes
  return subscribeStore.subscribes.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.url || '').toLowerCase().includes(q),
  )
})
const filter = ref('')
const sort = ref('manual')
const filters = [
  { label: 'common.enabled', value: 'enabled' },
  { label: 'common.disabled', value: 'disabled' },
]
const filteredSubscribes = computed(() => {
  const records = matches.value.filter(
    (item) => !filter.value || (filter.value === 'disabled' ? item.disabled : !item.disabled),
  )
  return sort.value === 'name' ? records.sort((a, b) => a.name.localeCompare(b.name)) : records
})

const generateMenus = (subscription: App.Subscription) => {
  const builtInMenus: App.Menu[] = menuList
    .filter((v) => v.label !== 'subscribes.copySub' || Boolean(subscription.url))
    .map((v) => ({
      ...v,
      disabled:
        v.label === 'settings.requestProxy.name'
          ? subscription.disabled || subscription.updating || updatingAll.value
          : v.disabled,
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

  return [
    {
      label: 'common.update',
      disabled: subscription.disabled || subscription.updating || updatingAll.value,
      handler: () => handleUpdateSub(subscription),
    },
    ...builtInMenus,
    {
      label: subscription.disabled ? 'common.enable' : 'common.disable',
      handler: () => handleDisableSub(subscription),
    },
    { label: 'common.edit', handler: () => handleShowSubForm(subscription.id) },
    { label: 'common.delete', handler: () => handleDeleteSub(subscription) },
  ]
}

const handleShowSubForm = (id?: string) => {
  const m = modal({
    title: id ? 'common.edit' : 'common.add',
    size: 'lg',
  })
  m.setContent(SubscribeForm, { id }).open()
}

const updatingAll = ref(false)
const handleUpdateSubs = async () => {
  if (updatingAll.value || subscribeStore.subscribes.some((item) => item.updating)) return
  updatingAll.value = true
  try {
    await subscribeStore.updateSubscribes({ throwOnFailure: true })
    message.success('common.success')
  } catch (error: any) {
    console.error('updateSubscribes: ', error)
    message.error(error.message || error)
  } finally {
    updatingAll.value = false
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

const handleUpdateSub = async (s: App.Subscription, options?: Partial<App.Subscription>) => {
  if (updatingAll.value || s.updating) return
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
    await confirm(
      t('common.delete'),
      [
        t('common.confirmDelete', [s.name]),
        ...usedBy(s.id).map((p) => t('workspace.usedBy', [p.name])),
      ].join('\n'),
      {
        type: 'text',
        okText: 'common.delete',
        danger: true,
      },
    )
  } catch {
    return
  }

  try {
    await subscribeStore.deleteSubscribe(s.id)
    await ignoredError(removeUnusedResourceCache, s, subscribeStore.subscribes)
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteSubscribe: ', error)
    message.error(error)
  }
}

const handleDisableSub = async (s: App.Subscription) => {
  try {
    await subscribeStore.editSubscribe(s.id, { ...s, disabled: !s.disabled })
  } catch (error) {
    message.error(error)
  }
}

const noUpdateNeeded = computed(() => subscribeStore.subscribes.every((v) => v.disabled))
const anyUpdating = computed(
  () => updatingAll.value || subscribeStore.subscribes.some((item) => item.updating),
)

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

const onSortUpdate = debounce(
  () => subscribeStore.saveSubscribes().catch((error) => message.error(error)),
  1000,
)
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

  <template v-else>
    <div
      v-if="subscribeStore.pendingReferences"
      class="surface-inset p-8 mb-8 flex flex-wrap items-center gap-8"
    >
      {{ t('workspace.syncReferences', [subscribeStore.pendingReferences]) }}
      <Button type="link" @click="handleSyncOutboundRefs">{{
        t('subscribes.syncOutboundRefs')
      }}</Button>
    </div>
    <ResourcePageShell
      v-model:query="keywords"
      v-model:view="appSettingsStore.app.subscribesView"
      v-model:sort="sort"
      v-model:filter="filter"
      :filters="filters"
      :total="subscribeStore.subscribes.length"
      :count="filteredSubscribes.length"
    >
      <div class="subscriptions-actions">
        <CustomAction :actions="appStore.customActions.subscriptions_header" />
        <Button
          :disabled="noUpdateNeeded || anyUpdating"
          :type="noUpdateNeeded ? 'text' : 'link'"
          :loading="updatingAll"
          @click="handleUpdateSubs"
        >
          {{ t('common.updateAll') }}
        </Button>
      </div>
      <Button type="primary" icon="add" class="subscriptions-add" @click="handleShowSubForm()">
        {{ t('common.add') }}
      </Button>
    </ResourcePageShell>
  </template>
  <VueDraggable
    v-if="filteredSubscribes.length"
    v-model="subscribeStore.subscribes"
    v-bind="DraggableOptions"
    :disabled="Boolean(keywords.trim() || filter || sort !== 'manual')"
    :class="'grid-list-' + appSettingsStore.app.subscribesView"
    @update="onSortUpdate"
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
        <Button
          v-if="s.type !== 'File' && s.website"
          v-tips="'subscribe.website'"
          type="text"
          size="small"
          icon="link"
          icon-color="var(--muted-color)"
          :aria-label="t('subscribe.website')"
          class="shrink-0"
          @click.stop="BrowserOpenURL(s.website)"
        />
      </template>

      <template #extra><ResourceActions :items="generateMenus(s)" :name="s.name" /></template>

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

      <div v-if="usedBy(s.id).length" class="flex flex-wrap items-center gap-6 mt-8 text-12">
        <span class="text-muted">{{ t('nodeGroups.dependencies') }}</span>
        <RouterLink
          v-for="p in usedBy(s.id)"
          :key="p.id"
          :to="{ name: 'EditProfile', params: { id: p.id }, query: { step: 3 } }"
          ><Tag size="small">{{ p.name }}</Tag></RouterLink
        >
      </div>

      <div class="resource-card-footer">
        <Button
          :disabled="s.disabled || updatingAll"
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
  </VueDraggable>
</template>

<style lang="less" scoped>
.subscription-usage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: calc(12px * var(--font-scale, 1));
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
  font-size: calc(18px * var(--font-scale, 1));
  font-weight: 600;
  margin-bottom: 10px;
}
.subscription-meta {
  font-size: calc(13px * var(--font-scale, 1));
  color: var(--muted-color);
  line-height: 1.8;
}
.subscriptions-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
@container (max-width: 640px) {
  .subscriptions-add {
    margin-left: auto;
    min-height: 36px;
  }
}
</style>
