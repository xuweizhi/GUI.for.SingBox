<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import logo from '@/assets/logo'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore } from '@/stores'
import { APP_TITLE, message, modal } from '@/utils'

import ConnectionsController from './components/ConnectionsController.vue'
import GroupsController from './components/GroupsController.vue'
import KernelLogs from './components/KernelLogs.vue'
import LogsController from './components/LogsController.vue'
import OverView from './components/OverView.vue'
import QuickStart from './components/QuickStart.vue'

type HomeTab = 'overview' | 'groups' | 'connections' | 'logs'

const VALID_TABS: readonly HomeTab[] = ['overview', 'groups', 'connections', 'logs']

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const profilesStore = useProfilesStore()
const kernelApiStore = useKernelApiStore()

const resolveTab = (raw: unknown): HomeTab => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return VALID_TABS.includes(value as HomeTab) ? (value as HomeTab) : 'overview'
}

const activeTab = ref<HomeTab>(resolveTab(route.query.tab))
const activeConnectionsCount = ref(0)

const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')
const visibleProfiles = computed(() => {
  const list = profilesStore.profiles
  if (list.length <= 4) return list
  const head = list.slice(0, 3)
  const selected = list.find((p) => p.id === appSettingsStore.app.kernel.profile)
  if (selected && !head.includes(selected)) head.splice(2, 1, selected)
  return head
})
const hiddenProfiles = computed(() =>
  profilesStore.profiles.filter((profile) => !visibleProfiles.value.includes(profile)),
)

watch(
  () => route.query.tab,
  (tab) => {
    const resolved = resolveTab(tab)
    if (resolved !== activeTab.value) {
      activeTab.value = resolved
    }
  },
)

const setTab = (tab: HomeTab) => {
  activeTab.value = tab
  if (tab === 'overview') {
    void kernelApiStore.refreshConfig()
  }
  const nextQuery = { ...route.query }
  if (tab === 'overview') {
    delete nextQuery.tab
  } else {
    nextQuery.tab = tab
  }
  void router.replace({ query: nextQuery })
}

const handleStartKernel = async () => {
  try {
    await kernelApiStore.startCore()
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleShowQuickStart = () => {
  modal({ title: 'subscribes.enterLink', size: 'md' }).setContent(QuickStart).open()
}

const handleShowKernelLogs = () => {
  const m = modal({
    title: 'home.overview.viewlog',
    width: '90',
    height: '90',
    submit: false,
    cancelText: 'common.close',
    maskClosable: true,
  })
  m.setContent(KernelLogs).open()
}

const showLaunchpad = computed(
  () =>
    (!kernelApiStore.running && !kernelApiStore.stopping && !kernelApiStore.restarting) ||
    (kernelApiStore.starting && !kernelApiStore.restarting),
)

const showConsoleTabs = computed(() => {
  const pages = appSettingsStore.app.pages || []
  return !['PolicyGroups', 'Connections', 'Logs'].every((name) => pages.includes(name))
})

const tabs = computed(() => [
  { key: 'overview' as const, label: t('home.overview.tabOverview'), icon: 'overview' as const },
  { key: 'groups' as const, label: t('home.overview.tabGroups'), icon: 'link' as const },
  {
    key: 'connections' as const,
    label: t('home.overview.tabConnections'),
    icon: 'connections' as const,
    badge: activeConnectionsCount.value,
  },
  { key: 'logs' as const, label: t('home.overview.tabLogs'), icon: 'log' as const },
])

const onTabKeydown = (event: KeyboardEvent, index: number) => {
  const list = tabs.value
  let next = -1
  if (event.key === 'ArrowRight') next = (index + 1) % list.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + list.length) % list.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = list.length - 1
  if (next === -1) return
  event.preventDefault()
  setTab(list[next]!.key)
  const nav = (event.currentTarget as HTMLElement | null)?.closest('[role="tablist"]')
  nav?.querySelectorAll<HTMLElement>('[role="tab"]')?.[next]?.focus()
}
</script>

<template>
  <div class="home-view flex flex-col h-full min-h-0">
    <div
      v-if="showLaunchpad"
      class="launchpad flex-1 flex flex-col items-center justify-center py-24"
    >
      <Card class="launchpad-card">
        <div
          v-if="activeTab !== 'overview' && profilesStore.profiles.length > 0"
          class="core-required-banner mb-12 flex flex-wrap items-center justify-center gap-8 rounded-8 px-12 py-8 text-12"
        >
          <span>{{
            t('home.overview.coreRequiredForTab', [
              tabs.find((tab) => tab.key === activeTab)?.label || '',
            ])
          }}</span>
          <Button
            v-if="profilesStore.currentProfile"
            type="primary"
            size="small"
            :loading="kernelApiStore.starting"
            @click="handleStartKernel"
          >
            {{ t('home.overview.start') }}
          </Button>
        </div>
        <div class="flex flex-col items-center px-8">
          <img :src="logo" alt="" draggable="false" class="w-96 mb-16" />

          <template v-if="profilesStore.profiles.length === 0">
            <p class="text-muted text-center mb-16">{{ t('home.noProfile', [APP_TITLE]) }}</p>
            <Button type="primary" size="large" @click="handleShowQuickStart">
              {{ t('home.quickStart') }}
            </Button>
            <div class="flex flex-wrap justify-center gap-8 mt-12">
              <Button @click="router.push('/profiles/new')"
                >{{ t('common.add') }} · {{ t('router.profiles') }}</Button
              >
              <Button @click="router.push('/settings?tab=backup')">{{ t('backup.title') }}</Button>
            </div>
          </template>

          <template v-else>
            <div class="home-profile-options flex flex-wrap justify-center gap-12 mb-24 w-full">
              <Card
                v-for="p in visibleProfiles"
                :key="p.id"
                :selected="appSettingsStore.app.kernel.profile === p.id"
                :aria-pressed="appSettingsStore.app.kernel.profile === p.id"
                interactive
                @click="appSettingsStore.app.kernel.profile = p.id"
              >
                <div
                  class="w-128 min-h-48 flex items-center justify-center py-6 text-center font-bold text-13"
                >
                  {{ p.name }}
                </div>
              </Card>
              <Dropdown
                v-if="profilesStore.profiles.length > 4"
                placement="top"
                class="home-profile-dropdown"
              >
                <Card interactive class="h-full w-full">
                  <div
                    class="w-128 min-h-48 flex items-center justify-center py-6 text-center font-bold text-13"
                  >
                    {{ t('common.more') }} ({{ hiddenProfiles.length }})
                  </div>
                </Card>
                <template #overlay="{ close }">
                  <div class="flex flex-col gap-2 p-6 min-w-160">
                    <Button
                      v-for="p in hiddenProfiles"
                      :key="p.id"
                      type="text"
                      class="justify-start"
                      @click="
                        () => {
                          appSettingsStore.app.kernel.profile = p.id
                          close()
                        }
                      "
                    >
                      <span>{{ p.name }}</span>
                    </Button>
                  </div>
                </template>
              </Dropdown>
              <Card interactive class="quick-start-card" @click="handleShowQuickStart">
                <div
                  class="w-128 min-h-48 flex items-center justify-center py-6 text-center font-bold text-13 text-muted"
                >
                  + {{ t('home.quickStart') }}
                </div>
              </Card>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-10">
              <Button
                :loading="kernelApiStore.starting"
                :disabled="!profilesStore.currentProfile"
                type="primary"
                size="large"
                class="start-profile-btn"
                @click="handleStartKernel"
              >
                <span class="start-profile-btn__label"
                  >{{ t('home.overview.start') }} ·
                  {{ activeProfileName || t('profiles.select') }}</span
                >
              </Button>
              <Button type="normal" icon="log" @click="handleShowKernelLogs">
                {{ t('home.overview.viewlog') }}
              </Button>
            </div>
          </template>
        </div>
      </Card>
    </div>

    <div
      v-else-if="kernelApiStore.coreStateLoading && !kernelApiStore.restarting"
      class="flex-1 flex items-center justify-center"
    >
      <Icon icon="loading" :size="24" class="rotation text-muted" />
    </div>

    <template v-else>
      <div
        v-if="kernelApiStore.restarting"
        role="status"
        class="core-restarting-banner mb-10 flex items-center gap-8 rounded-8 px-12 py-8 text-12 shrink-0"
      >
        <Icon icon="loading" :size="14" class="rotation shrink-0" />
        <span>{{ t('home.overview.restart') }}...</span>
      </div>

      <div v-if="showConsoleTabs" class="console-header flex flex-col gap-10 mb-14 shrink-0">
        <nav class="console-tabs" role="tablist" :aria-label="t('home.overview.workspace')">
          <button
            v-for="(tab, index) in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.key"
            :class="{ 'is-active': activeTab === tab.key }"
            class="console-tab"
            @click="setTab(tab.key)"
            @keydown="onTabKeydown($event, index)"
          >
            <Icon :icon="tab.icon" :size="15" color="currentColor" />
            <span>{{ tab.label }}</span>
            <span
              v-if="tab.badge !== undefined"
              class="console-tab__badge"
              :class="{ 'is-active': activeTab === tab.key }"
            >
              {{ tab.badge }}
            </span>
          </button>
        </nav>
      </div>

      <div class="console-workspace flex-1 min-h-0 flex flex-col">
        <div
          v-show="activeTab === 'overview'"
          role="tabpanel"
          class="console-pane console-pane--scroll"
        >
          <OverView
            :active="activeTab === 'overview'"
            @open-groups="setTab('groups')"
            @open-connections="setTab('connections')"
            @open-logs="setTab('logs')"
            @connections-count="activeConnectionsCount = $event"
          />
        </div>

        <div
          v-show="activeTab !== 'overview'"
          role="tabpanel"
          class="console-pane"
          :class="activeTab === 'groups' ? 'console-pane--scroll' : 'console-pane--fill'"
        >
          <KeepAlive>
            <component
              :is="
                {
                  groups: GroupsController,
                  connections: ConnectionsController,
                  logs: LogsController,
                }[activeTab]
              "
              v-if="activeTab !== 'overview'"
              :key="activeTab"
            />
          </KeepAlive>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="less" scoped>
.launchpad-card {
  width: min(760px, 100%);
}

.home-profile-options {
  max-width: 680px;
}

.console-tabs {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border-radius: calc(var(--control-radius, 8px) + 3px);
  background: var(--surface-bg, var(--card-bg));
  border: 1px solid var(--surface-border, var(--border-color));
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  align-self: flex-start;
  max-width: 100%;
}

.console-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 12px;
  border: 0;
  border-radius: var(--control-radius, 8px);
  background: transparent;
  color: var(--muted-color);
  font: inherit;
  font-size: calc(13px * var(--font-scale, 1));
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.18s ease;

  &:hover {
    color: var(--color);
    background: var(--btn-text-hover-bg);
  }

  &.is-active {
    color: var(--accent-text);
    background: var(--accent-soft);
    box-shadow: var(--active-indicator-shadow);
    font-weight: 600;
  }
}

.console-tab__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-color);

  &.is-active {
    background: var(--card-bg);
    border-color: color-mix(in srgb, var(--accent-text) 35%, transparent);
    color: var(--accent-text);
  }
}

.console-pane {
  flex: 1;
  min-height: 0;
}

.console-pane--scroll {
  overflow-y: auto;
}

.console-pane--fill {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.launchpad {
  overflow-y: auto;
  justify-content: safe center;
}
.core-required-banner {
  color: var(--warning-color);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
}
.core-restarting-banner {
  color: var(--accent-text);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent-text) 35%, transparent);
}
.quick-start-card {
  border-style: dashed;
}
.start-profile-btn {
  max-width: min(420px, 100%);
}
.start-profile-btn__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@container (max-width: 640px) {
  .home-profile-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .home-profile-dropdown {
    width: 100%;
    align-items: stretch;
  }

  .home-profile-options :deep(.w-128) {
    width: 100%;
    overflow-wrap: anywhere;
  }

  .console-tabs {
    width: 100%;
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }

  .console-tab {
    justify-content: center;
  }
}
</style>
