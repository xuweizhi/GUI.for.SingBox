<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import logo from '@/assets/logo'
import { NavLayout } from '@/enums/app'
import rawRoutes from '@/router/routes'
import {
  useAppSettingsStore,
  useAppStore,
  useKernelApiStore,
  useProfilesStore,
  useWebuiAuthStore,
} from '@/stores'
import { confirm } from '@/utils'

import AppearancePopover from './AppearancePopover.vue'
import CoreControls from './CoreControls.vue'
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

const appSettings = useAppSettingsStore()
const appStore = useAppStore()
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

const isTopnav = computed(() => appSettings.app.navLayout === NavLayout.Topnav)
const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')
const homeTab = computed(() =>
  route.path === '/' ? String(route.query.tab || '') : '',
)
const pageTitle = computed(() => {
  const tabTitles: Record<string, string> = {
    groups: 'home.overview.tabGroups',
    connections: 'home.overview.tabConnections',
    logs: 'home.overview.tabLogs',
  }
  if (tabTitles[homeTab.value]) return t(tabTitles[homeTab.value]!)
  return route.meta.name ? t(route.meta.name) : String(route.name || '')
})
const isFluid = computed(() => route.meta.fluid === true)
const overflowActive = computed(() => {
  const overflow = visibleRoutes.value.slice(visibleCount.value)
  return overflow.some((r) => r.path === activePath.value)
})
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

const activePath = computed(() => {
  if (route.path.startsWith('/profiles/')) return '/profiles'
  if (route.path === '/' && ['groups', 'connections', 'logs'].includes(String(route.query.tab)))
    return '/' + route.query.tab
  return route.path
})
const nav = ref<HTMLElement>()
const measurements = ref<HTMLElement>()
const visibleCount = ref(Infinity)
const measureNav = () => {
  if (!nav.value?.clientWidth || !measurements.value) return
  const widths = Array.from(
    measurements.value.children,
    (el) => el.getBoundingClientRect().width + 4,
  )
  const more = widths.pop() || 0
  const width = nav.value.clientWidth - 4
  if (widths.reduce((a, b) => a + b, 0) <= width) {
    visibleCount.value = widths.length
    return
  }
  let used = more
  visibleCount.value = widths.findIndex((w) => (used += w) > width)
}
watch(
  [nav, measurements],
  ([container, labels], _, cleanup) => {
    if (!container || !labels || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureNav)
    observer.observe(container)
    observer.observe(labels)
    cleanup(() => observer.disconnect())
  },
  { flush: 'post' },
)
const openCommandPalette = () => {
  window.dispatchEvent(new CustomEvent('open-command-palette'))
}

const handleLogout = async () => {
  try {
    await confirm('auth.signOut', 'common.confirmSignOut', {
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
  if (
    event.key === 'Escape' &&
    mobileNavOpen.value &&
    !event.defaultPrevented &&
    !event.isComposing &&
    appStore.modalStack.length === 0
  ) {
    event.preventDefault()
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
        <div class="app-topbar__inner" :class="{ 'is-fluid': isFluid }">
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

          <nav v-if="isTopnav" ref="nav" class="topbar-nav" :aria-label="t('navigation.main')">
            <RouterLink
              v-for="r in visibleRoutes.slice(0, visibleCount)"
              :key="r.path"
              :to="r.path"
              class="topbar-nav__link"
              active-class=""
              :class="{ 'is-active': activePath === r.path }"
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
            <div ref="measurements" class="nav-measure" aria-hidden="true">
              <span v-for="r in visibleRoutes" :key="r.path" class="nav-width"
                ><Icon v-if="r.meta?.icon" :icon="r.meta.icon" :size="15" />{{
                  r.meta?.name && t(r.meta.name)
                }}</span
              >
              <span class="nav-width">{{ t('common.more') }} ▾</span>
            </div>
            <Dropdown v-if="visibleRoutes.length > visibleCount" align="end">
              <Button
                type="text"
                size="small"
                class="topbar-more"
                :class="{ 'is-active': overflowActive }"
                >{{ t('common.more') }} ▾</Button
              >
              <template #overlay="{ close }"
                ><div class="flex flex-col p-4">
                  <RouterLink
                    v-for="r in visibleRoutes.slice(visibleCount)"
                    :key="r.path"
                    :to="r.path"
                    class="topbar-nav__link"
                    :class="{ 'is-active': activePath === r.path }"
                    @click="close"
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
                </div></template
              >
            </Dropdown>
          </nav>

          <div class="app-topbar__right">
            <Dropdown align="end">
              <button
                type="button"
                class="topbar-core-pill"
                :class="kernelApiStore.running ? 'is-running' : 'is-stopped'"
                :title="
                  (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped')) +
                  (activeProfileName ? ' · ' + activeProfileName : '')
                "
              >
                <span class="topbar-core-pill__dot" aria-hidden="true"></span>
                <span class="topbar-core-pill__text">
                  {{
                    activeProfileName ||
                    (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped'))
                  }}
                </span>
              </button>

              <template #overlay="{ show, close }"
                ><CoreControls v-if="show" @close="close"
              /></template>
            </Dropdown>
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

      <main
        :class="{
          'app-page--fill': route.meta.layout === 'fill',
          'app-page--fluid': isFluid,
        }"
        class="app-page"
      >
        <RouterView #="{ Component }">
          <KeepAlive exclude="ProfileForm">
            <component
              :is="Component"
              :key="route.name === 'EditProfile' ? route.path : route.name"
            />
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
  height: var(--topbar-height, 48px);
  background: var(--surface-chrome-bg, var(--card-bg));
  border-bottom: 1px solid var(--surface-border, var(--border-color));
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  z-index: var(--z-chrome, 30);
}

.app-topbar__inner {
  height: 100%;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--page-pad-x, 24px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  &.is-fluid {
    max-width: none;
  }
}

.app-topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 1;
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
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  scrollbar-width: none;
  padding: 2px;

  &::-webkit-scrollbar {
    display: none;
  }
}

.topbar-nav__link,
.nav-width {
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
  font-size: calc(11px * var(--font-scale, 1));
  line-height: 1.3;
  color: var(--muted-color);
}

.topbar-logout-btn:hover {
  color: var(--danger-color);
  background: var(--danger-soft);
}

.topbar-core-pill {
  display: inline-flex;
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
  max-width: 1440px;
  margin: 0 auto;
  overflow-y: auto;
  padding: var(--page-pad-y, 18px) var(--page-pad-x, 24px) 20px;
}

.nav-measure {
  position: absolute;
  display: flex;
  visibility: hidden;
  pointer-events: none;
  width: max-content;
}
.app-page--fluid {
  max-width: none;
}
.app-page--fill,
.app-page:has(.grid-list-header),
.app-page:has(.settings-tabs) {
  overflow: hidden;
}
.topbar-more.is-active {
  color: var(--accent-text);
  background: var(--accent-soft);
}
@media (max-width: 1024px) {
  .topbar-brand__name {
    display: none;
  }

  .topbar-menu-btn {
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

@media (max-width: 640px) {
  .app-topbar__inner {
    padding: 0 16px;
  }

  .app-page {
    padding: 14px 16px 16px;
  }

  .topbar-title {
    font-size: calc(16px * var(--font-scale, 1));
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
