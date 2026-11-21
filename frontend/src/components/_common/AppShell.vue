<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import logo from '@/assets/logo'
import { NavLayout, Theme } from '@/enums/app'
import rawRoutes from '@/router/routes'
import {
  useAppSettingsStore,
  useKernelApiStore,
  useProfilesStore,
  useWebuiAuthStore,
} from '@/stores'
import { confirm } from '@/utils'

import AppearancePopover from './AppearancePopover.vue'
import NavigationBar from './NavigationBar.vue'

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
const isTopnav = computed(() => appSettings.app.navLayout === NavLayout.Topnav)
const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')
const pageTitle = computed(() =>
  route.meta.name ? t(route.meta.name) : String(route.name || ''),
)
const isMac = computed(
  () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || ''),
)

const visibleRoutes = computed(() =>
  rawRoutes.filter(
    (r) =>
      r.meta?.hidden === false ||
      (!r.meta?.hidden && appSettings.app.pages.includes(r.name! as string)),
  ),
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
  <div class="app-shell" :class="{ 'is-topnav': isTopnav }">
    <NavigationBar
      v-model:mobile-open="mobileNavOpen"
      v-model:collapsed="sidebarCollapsed"
      :topnav="isTopnav"
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

            <RouterLink v-if="isTopnav" to="/" class="topbar-brand">
              <img :src="logo" alt="" width="24" height="24" class="shrink-0" />
              <span class="topbar-brand__name">GUI.for.SingBox</span>
            </RouterLink>

            <h1 class="topbar-title" :class="{ 'is-mobile-only': isTopnav }">{{ pageTitle }}</h1>
          </div>

          <nav
            v-if="isTopnav"
            class="topbar-nav"
            :aria-label="t('navigation.main')"
          >
            <RouterLink
              v-for="r in visibleRoutes"
              :key="r.path"
              :to="r.path"
              class="topbar-nav__link"
              active-class="is-active"
            >
              <Icon
                v-if="r.meta?.icon"
                :icon="r.meta.icon"
                :size="15"
                color="currentColor"
                class="shrink-0"
              />
              <span>{{ r.meta?.name ? t(r.meta.name) : r.name }}</span>
            </RouterLink>
          </nav>

          <div class="app-topbar__right">
            <button
              type="button"
              class="topbar-core-pill"
              :class="[
                kernelApiStore.running ? 'is-running' : 'is-stopped',
                { 'is-desktop-visible': sidebarCollapsed || isTopnav },
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

            <AppearancePopover />

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
  height: var(--topbar-height, 54px);
  background: var(--surface-chrome-bg, var(--card-bg));
  border-bottom: 1px solid var(--surface-border, var(--border-color));
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  z-index: 30;
}

.app-topbar__inner {
  height: 100%;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  padding: 0 var(--page-pad-x, 24px);
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
  flex-shrink: 0;
}

.topbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: calc(14px * var(--font-scale, 1));
  font-weight: 700;
  color: var(--color);
  white-space: nowrap;
}

.topbar-title {
  margin: 0;
  font-size: calc(18px * var(--font-scale, 1));
  line-height: 1.3;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.is-mobile-only {
    display: none;
  }
}

.topbar-nav {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px;

  &::-webkit-scrollbar {
    display: none;
  }
}

.topbar-nav__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 11px;
  border-radius: var(--control-radius, 8px);
  font-size: calc(13px * var(--font-scale, 1));
  font-weight: 500;
  color: var(--muted-color);
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
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
  border-radius: var(--control-radius, 8px);
  background: transparent;
  color: var(--muted-color);
  font: inherit;
  font-size: calc(13px * var(--font-scale, 1));
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
  border-color: var(--surface-border, var(--border-color));
  background: color-mix(in srgb, var(--bg-color) 75%, var(--surface-bg));
  padding: 0 8px 0 10px;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
    background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  }
}

.app-shell.is-topnav {
  .topbar-cmd-btn__label,
  .topbar-logout-btn__label {
    display: none;
  }

  .topbar-logout-btn {
    width: 34px;
    padding: 0;
  }
}

.topbar-cmd-btn__kbd {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--border-color);
  background: var(--surface-bg, var(--card-bg));
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
  border: 1px solid var(--surface-border, var(--border-color));
  background: color-mix(in srgb, var(--bg-color) 75%, var(--surface-bg));
  color: var(--muted-color);
  font: inherit;
  font-size: calc(12px * var(--font-scale, 1));
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
  padding: var(--page-pad-y, 18px) var(--page-pad-x, 24px) 20px;
}

@media (max-width: 1180px) {
  .topbar-brand__name {
    display: none;
  }
}

@media (max-width: 960px) {
  .topbar-menu-btn {
    display: inline-flex;
  }

  .topbar-core-pill {
    display: inline-flex;
  }

  .topbar-brand,
  .topbar-nav {
    display: none;
  }

  .topbar-title.is-mobile-only {
    display: block;
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
