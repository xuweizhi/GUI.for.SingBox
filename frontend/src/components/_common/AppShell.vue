<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { Theme } from '@/enums/app'
import {
  useAppSettingsStore,
  useKernelApiStore,
  useProfilesStore,
  useWebuiAuthStore,
} from '@/stores'
import { confirm } from '@/utils'

import { NavigationBar } from '@/components'

const SIDEBAR_STORAGE_KEY = 'gfs.webui.sidebar.collapsed'

const readCollapsedState = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const appSettings = useAppSettingsStore()
const authStore = useWebuiAuthStore()
const kernelApiStore = useKernelApiStore()
const profilesStore = useProfilesStore()

const mobileNavOpen = ref(false)
const sidebarCollapsed = ref(readCollapsedState())

watch(sidebarCollapsed, (collapsed) => {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // ignore storage errors in restricted environments
  }
})

watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false
  },
)

const isDarkTheme = computed(() => appSettings.themeMode === Theme.Dark)
const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')
const pageTitle = computed(() =>
  route.meta.name ? t(route.meta.name) : String(route.name || ''),
)
const isMac = computed(
  () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || ''),
)

const toggleTheme = (event: MouseEvent) => {
  document.documentElement.style.setProperty('--x', event.clientX + 'px')
  document.documentElement.style.setProperty('--y', event.clientY + 'px')
  appSettings.app.theme = isDarkTheme.value ? Theme.Light : Theme.Dark
}

const openCommandPalette = () => {
  window.dispatchEvent(new CustomEvent('open-command-palette'))
}

const goOverview = () => {
  if (route.path !== '/') {
    void router.push('/')
  }
}

const handleLogout = async () => {
  try {
    await confirm(t('auth.signOut'), t('common.confirmSignOut'), {
      type: 'text',
      okText: 'auth.signOut',
      danger: true,
    })
    await authStore.logout()
  } catch {
    // user canceled
  }
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && mobileNavOpen.value) {
    mobileNavOpen.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app-shell">
    <NavigationBar
      v-model:mobile-open="mobileNavOpen"
      v-model:collapsed="sidebarCollapsed"
    />

    <div class="app-main">
      <header class="app-topbar">
        <div class="app-topbar__inner">
          <div class="app-topbar__left">
            <button
              type="button"
              class="topbar-menu-btn"
              :aria-label="t('navigation.toggle')"
              :aria-expanded="mobileNavOpen"
              aria-controls="main-navigation"
              @click="mobileNavOpen = !mobileNavOpen"
            >
              <Icon icon="menu" :size="18" color="currentColor" />
            </button>
            <h1 class="topbar-title">{{ pageTitle }}</h1>
          </div>

          <div class="app-topbar__right">
            <button
              type="button"
              class="topbar-core-pill"
              :class="[
                kernelApiStore.running ? 'is-running' : 'is-stopped',
                { 'is-desktop-visible': sidebarCollapsed },
              ]"
              :title="
                (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped')) +
                (activeProfileName ? ' · ' + activeProfileName : '')
              "
              @click="goOverview"
            >
              <span class="topbar-core-pill__dot" aria-hidden="true"></span>
              <span class="topbar-core-pill__text">
                {{
                  activeProfileName ||
                  (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped'))
                }}
              </span>
            </button>

            <button
              type="button"
              class="topbar-cmd-btn"
              :aria-label="t('common.commandPalette')"
              :title="`${t('common.commandPalette')} (${isMac ? '⌘K' : 'Ctrl+K'})`"
              @click="openCommandPalette"
            >
              <Icon icon="command" :size="15" color="currentColor" />
              <span class="topbar-cmd-btn__label">{{ t('common.commandPalette') }}</span>
              <kbd class="topbar-cmd-btn__kbd">{{ isMac ? '⌘K' : 'Ctrl K' }}</kbd>
            </button>

            <button
              type="button"
              class="topbar-icon-btn"
              :aria-label="t('common.switchTheme')"
              :title="t('common.switchTheme')"
              @click="toggleTheme"
            >
              <Icon :icon="isDarkTheme ? 'sun' : 'moon'" :size="16" color="currentColor" />
            </button>

            <button
              type="button"
              class="topbar-logout-btn"
              :aria-label="t('auth.signOut')"
              :title="t('auth.logout')"
              @click="handleLogout"
            >
              <Icon icon="logout" :size="15" color="currentColor" />
              <span class="topbar-logout-btn__label">{{ t('auth.signOut') }}</span>
            </button>
          </div>
        </div>
      </header>

      <main :class="{ 'app-page--overview': route.name === 'Overview' }" class="app-page">
        <RouterView #="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style lang="less" scoped>
.app-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.app-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-topbar {
  flex-shrink: 0;
  height: 54px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
}

.app-topbar__inner {
  height: 100%;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.app-topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.3;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-topbar__right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.topbar-menu-btn,
.topbar-icon-btn,
.topbar-logout-btn,
.topbar-cmd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-color);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;

  &:hover {
    color: var(--color);
    background: var(--btn-text-hover-bg);
  }
}

.topbar-menu-btn {
  display: none;
  width: 36px;
  padding: 0;
  color: var(--color);
}

.topbar-icon-btn {
  width: 34px;
  padding: 0;
}

.topbar-cmd-btn {
  border-color: var(--border-color);
  background: var(--bg-color);
  padding: 0 8px 0 10px;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
    background: var(--bg-color);
  }
}

.topbar-cmd-btn__kbd {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.3;
  color: var(--muted-color);
}

.topbar-logout-btn:hover {
  color: var(--danger-color);
  background: var(--danger-soft);
}

.topbar-core-pill {
  display: none;
  align-items: center;
  gap: 6px;
  max-width: 170px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--muted-color);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease;

  &.is-desktop-visible {
    display: inline-flex;
  }

  &:hover {
    border-color: var(--accent-text);
    color: var(--color);
  }

  &.is-running .topbar-core-pill__dot {
    background: var(--success-color);
    box-shadow: 0 0 0 3px var(--success-soft);
  }

  &.is-stopped .topbar-core-pill__dot {
    background: var(--muted-color);
  }
}

.topbar-core-pill__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.topbar-core-pill__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  overflow-y: auto;
  padding: 18px 24px 20px;
}

@media (max-width: 960px) {
  .topbar-menu-btn {
    display: inline-flex;
  }

  .topbar-core-pill {
    display: inline-flex;
  }
}

@media (max-width: 760px) {
  .app-topbar__inner {
    padding: 0 16px;
  }

  .app-page {
    padding: 14px 16px 16px;
  }

  .topbar-title {
    font-size: 16px;
  }

  .topbar-cmd-btn__label,
  .topbar-cmd-btn__kbd,
  .topbar-logout-btn__label {
    display: none;
  }

  .topbar-cmd-btn,
  .topbar-logout-btn {
    width: 34px;
    padding: 0;
  }

  .topbar-core-pill {
    max-width: 124px;
  }
}
</style>
