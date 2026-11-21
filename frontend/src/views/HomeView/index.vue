<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import logo from '@/assets/logo'
import {
  useAppSettingsStore,
  useAppStore,
  useKernelApiStore,
  useProfilesStore,
} from '@/stores'
import { APP_TITLE, confirm, message, modal } from '@/utils'

import CommonController from './components/CommonController.vue'
import ConnectionsController from './components/ConnectionsController.vue'
import GroupsController from './components/GroupsController.vue'
import KernelLogs from './components/KernelLogs.vue'
import LogsController from './components/LogsController.vue'
import OverView from './components/OverView.vue'
import QuickStart from './components/QuickStart.vue'

type HomeTab = 'overview' | 'groups' | 'connections' | 'logs'
type LogSource = 'api' | 'core'

const VALID_TABS: readonly HomeTab[] = ['overview', 'groups', 'connections', 'logs']

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const appStore = useAppStore()
const appSettingsStore = useAppSettingsStore()
const profilesStore = useProfilesStore()
const kernelApiStore = useKernelApiStore()

const resolveTab = (raw: unknown): HomeTab => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return VALID_TABS.includes(value as HomeTab) ? (value as HomeTab) : 'overview'
}

const activeTab = ref<HomeTab>(resolveTab(route.query.tab))
const logSource = ref<LogSource>('api')
const activeConnectionsCount = ref(0)
const switchingProfileId = ref('')

const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')

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
  if (tab === 'groups') {
    void kernelApiStore.refreshProviderProxies()
  } else if (tab === 'overview') {
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

const handleRestartKernel = async () => {
  try {
    await kernelApiStore.restartCore()
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleStopKernel = async () => {
  try {
    await confirm(t('home.overview.stop'), t('common.confirmStopCore'), {
      type: 'text',
      okText: 'home.overview.stop',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await kernelApiStore.stopCore()
    activeTab.value = 'overview'
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleSwitchProfile = async (profileId: string) => {
  if (appSettingsStore.app.kernel.profile === profileId) return
  appSettingsStore.app.kernel.profile = profileId
  switchingProfileId.value = profileId
  try {
    await kernelApiStore.restartCore()
    message.success('common.success')
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  } finally {
    switchingProfileId.value = ''
  }
}

const onTunSwitchChange = async (enable: boolean) => {
  try {
    await kernelApiStore.updateConfig('tun', { enable })
  } catch (error: any) {
    kernelApiStore.config.tun.enable = !kernelApiStore.config.tun.enable
    console.error(error)
    message.error(error.message || error)
  }
}

const handleShowSettings = () => {
  const m = modal({
    title: 'home.overview.settings',
    cancelText: 'common.close',
    width: '90',
    submit: false,
    maskClosable: true,
  })
  m.setContent(CommonController).open()
}

const handleShowQuickStart = () => {
  modal({ title: 'subscribes.enterLink' }).setContent(QuickStart).open()
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

const tabs = computed(() => [
  { key: 'overview' as const, label: t('home.overview.tabOverview'), icon: 'overview' as const },
  { key: 'groups' as const, label: t('home.overview.tabGroups'), icon: 'folder' as const },
  {
    key: 'connections' as const,
    label: t('home.overview.tabConnections'),
    icon: 'connections' as const,
    badge: activeConnectionsCount.value,
  },
  { key: 'logs' as const, label: t('home.overview.tabLogs'), icon: 'log' as const },
])
</script>

<template>
  <div class="home-view flex flex-col h-full min-h-0">
    <div
      v-if="(!kernelApiStore.running && !kernelApiStore.stopping) || kernelApiStore.starting"
      class="launchpad flex-1 flex flex-col items-center justify-center py-24"
    >
      <Card class="launchpad-card">
        <div class="flex flex-col items-center py-24 px-8">
          <img :src="logo" draggable="false" class="w-96 mb-16" />

          <template v-if="profilesStore.profiles.length === 0">
            <p class="text-muted text-center mb-16">{{ t('home.noProfile', [APP_TITLE]) }}</p>
            <Button type="primary" size="large" @click="handleShowQuickStart">
              {{ t('home.quickStart') }}
            </Button>
          </template>

          <template v-else>
            <div class="home-profile-options flex flex-wrap justify-center gap-12 mb-24 w-full">
              <Card
                v-for="p in profilesStore.profiles.slice(
                  0,
                  profilesStore.profiles.length > 4 ? 3 : 4,
                )"
                :key="p.id"
                :selected="appSettingsStore.app.kernel.profile === p.id"
                interactive
                @click="appSettingsStore.app.kernel.profile = p.id"
              >
                <div
                  class="w-128 h-full flex items-center justify-center py-20 text-center font-bold text-13"
                >
                  {{ p.name }}
                </div>
              </Card>
              <Dropdown v-if="profilesStore.profiles.length > 4" placement="top">
                <Card interactive class="h-full">
                  <div
                    class="w-128 h-full flex items-center justify-center py-20 text-center font-bold text-13"
                  >
                    {{ t('common.more') }} ({{ profilesStore.profiles.length - 3 }})
                  </div>
                </Card>
                <template #overlay="{ close }">
                  <div class="flex flex-col gap-2 p-6 min-w-160">
                    <Button
                      v-for="p in profilesStore.profiles.slice(3)"
                      :key="p.id"
                      type="text"
                      class="justify-between"
                      @click="
                        () => {
                          appSettingsStore.app.kernel.profile = p.id
                          close()
                        }
                      "
                    >
                      <span>{{ p.name }}</span>
                      <Icon
                        v-if="appSettingsStore.app.kernel.profile === p.id"
                        icon="selected"
                        color="var(--accent-text)"
                      />
                    </Button>
                  </div>
                </template>
              </Dropdown>
              <Card interactive @click="handleShowQuickStart">
                <div
                  class="w-128 h-full flex items-center justify-center py-20 text-center font-bold text-13 text-muted"
                >
                  + {{ t('home.quickStart') }}
                </div>
              </Card>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-10">
              <Button
                :loading="kernelApiStore.starting"
                type="primary"
                size="large"
                @click="handleStartKernel"
              >
                {{ t('home.overview.start') }}
              </Button>
              <Button type="normal" icon="log" @click="handleShowKernelLogs">
                {{ t('home.overview.viewlog') }}
              </Button>
            </div>
          </template>
        </div>
      </Card>
    </div>

    <template v-else-if="!kernelApiStore.coreStateLoading">
      <div class="console-header flex flex-col gap-10 mb-14 shrink-0">
        <div class="console-bar flex flex-wrap items-center rounded-12 px-12 py-8 gap-8">
          <Dropdown v-if="profilesStore.profiles.length > 0">
            <Button
              type="normal"
              size="small"
              icon="profiles"
              :loading="Boolean(switchingProfileId)"
              :title="t('home.overview.switchProfile')"
              class="profile-switcher-btn"
            >
              <span class="profile-switcher-btn__text">
                {{ activeProfileName || t('profiles.select') }}
              </span>
              <Icon icon="arrowDown" :size="12" color="var(--muted-color)" class="ml-4 shrink-0" />
            </Button>
            <template #overlay="{ close }">
              <div class="flex flex-col gap-2 min-w-192 p-6">
                <Button
                  v-for="p in profilesStore.profiles"
                  :key="p.id"
                  type="text"
                  size="small"
                  class="justify-between"
                  @click="
                    () => {
                      close()
                      handleSwitchProfile(p.id)
                    }
                  "
                >
                  <span class="line-clamp-1">{{ p.name }}</span>
                  <Icon
                    v-if="appSettingsStore.app.kernel.profile === p.id"
                    icon="selected"
                    :size="15"
                    color="var(--accent-text)"
                    class="ml-8 shrink-0"
                  />
                </Button>
                <Divider size="small" />
                <Button
                  type="text"
                  size="small"
                  icon="profiles"
                  class="justify-start text-muted"
                  @click="
                    () => {
                      close()
                      router.push('/profiles')
                    }
                  "
                >
                  {{ t('router.profiles') }}
                </Button>
              </div>
            </template>
          </Dropdown>

          <Switch
            v-model="kernelApiStore.config.tun.enable"
            size="small"
            border="square"
            @change="onTunSwitchChange"
          >
            {{ t('home.overview.tunMode') }}
          </Switch>

          <CustomAction :actions="appStore.customActions.core_state" />

          <div class="ml-auto flex items-center gap-4">
            <Button
              v-tips="'home.overview.settings'"
              :aria-label="t('home.overview.settings')"
              type="text"
              size="small"
              icon="settings"
              @click="handleShowSettings"
            />
            <Button
              v-tips="'home.overview.restart'"
              :aria-label="t('home.overview.restart')"
              :loading="kernelApiStore.restarting"
              :type="kernelApiStore.needRestart ? 'primary' : 'text'"
              size="small"
              icon="restart"
              @click="handleRestartKernel"
            >
              <span v-if="kernelApiStore.needRestart">{{ t('home.overview.restart') }}</span>
            </Button>
            <Button
              v-tips="'home.overview.stop'"
              :aria-label="t('home.overview.stop')"
              :loading="kernelApiStore.stopping"
              type="text"
              size="small"
              icon="stop"
              icon-color="var(--danger-color)"
              class="stop-btn"
              @click="handleStopKernel"
            />
          </div>
        </div>

        <nav
          class="console-tabs"
          role="tablist"
          :aria-label="t('home.overview.workspace')"
        >
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.key"
            :class="{ 'is-active': activeTab === tab.key }"
            class="console-tab"
            @click="setTab(tab.key)"
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
        <div v-show="activeTab === 'overview'" class="console-pane console-pane--scroll">
          <OverView
            @open-groups="setTab('groups')"
            @open-connections="setTab('connections')"
            @open-logs="setTab('logs')"
            @connections-count="activeConnectionsCount = $event"
          />
        </div>

        <div v-if="activeTab === 'groups'" class="console-pane console-pane--scroll pb-24">
          <GroupsController />
        </div>

        <div v-if="activeTab === 'connections'" class="console-pane console-pane--fill">
          <ConnectionsController />
        </div>

        <div v-if="activeTab === 'logs'" class="console-pane console-pane--fill flex flex-col gap-10">
          <div class="flex items-center justify-between gap-8 shrink-0">
            <Radio
              v-model="logSource"
              size="small"
              :options="[
                { label: 'common.apiLogs', value: 'api' },
                { label: 'common.coreLogs', value: 'core' },
              ]"
            />
          </div>
          <div class="flex-1 min-h-0">
            <LogsController v-if="logSource === 'api'" />
            <KernelLogs v-else inline />
          </div>
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

.console-bar {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
}

.profile-switcher-btn {
  max-width: 240px;
}

.profile-switcher-btn__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stop-btn:hover {
  background-color: var(--danger-soft);
}

.console-tabs {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  align-self: flex-start;
  max-width: 100%;
}

.console-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted-color);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.14s ease,
    color 0.14s ease;

  &:hover {
    color: var(--color);
    background: var(--btn-text-hover-bg);
  }

  &.is-active {
    color: var(--accent-text);
    background: var(--accent-soft);
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
  min-height: 360px;
}

@media (max-width: 700px) {
  .home-profile-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .home-profile-options :deep(.w-128) {
    width: 100%;
    overflow-wrap: anywhere;
  }

  .console-tabs {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .console-tab {
    justify-content: center;
  }
}
</style>
