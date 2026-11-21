<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import logo from '@/assets/logo'
import { Theme } from '@/enums/app'
import rawRoutes from '@/router/routes'
import {
  useAppSettingsStore,
  useKernelApiStore,
  useProfilesStore,
  useWebuiAuthStore,
} from '@/stores'
import { confirm } from '@/utils'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const appSettings = useAppSettingsStore()
const authStore = useWebuiAuthStore()
const kernelApiStore = useKernelApiStore()
const profilesStore = useProfilesStore()
const expanded = ref(false)
const toggle = ref<HTMLButtonElement>()

const routes = computed(() =>
  rawRoutes.filter(
    (r) =>
      r.meta?.hidden === false ||
      (!r.meta?.hidden && appSettings.app.pages.includes(r.name! as string)),
  ),
)

const isDarkTheme = computed(() => appSettings.themeMode === Theme.Dark)

const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')

watch(
  () => route.fullPath,
  () => {
    expanded.value = false
  },
)

const closeMenu = () => {
  if (!expanded.value) return
  expanded.value = false
  toggle.value?.focus()
}

const toggleTheme = (event: MouseEvent) => {
  document.documentElement.style.setProperty('--x', event.clientX + 'px')
  document.documentElement.style.setProperty('--y', event.clientY + 'px')
  appSettings.app.theme = isDarkTheme.value ? Theme.Light : Theme.Dark
}

const openCommandPalette = () => {
  window.dispatchEvent(new CustomEvent('open-command-palette'))
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

const goOverview = () => {
  closeMenu()
  if (route.path !== '/') {
    void router.push('/')
  }
}
</script>

<template>
  <header class="app-header" @keydown.esc="closeMenu">
    <div class="app-header__inner">
      <div class="app-brand">
        <RouterLink to="/" class="app-brand__link" @click="closeMenu">
          <img :src="logo" alt="" width="26" height="26" />
          <span>GUI.for.SingBox</span>
        </RouterLink>
        <button
          type="button"
          class="core-pill"
          :class="kernelApiStore.running ? 'is-running' : 'is-stopped'"
          :title="
            (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped')) +
            (activeProfileName ? ' · ' + activeProfileName : '')
          "
          @click="goOverview"
        >
          <span class="core-pill__dot" aria-hidden="true"></span>
          <span class="core-pill__text">
            {{
              activeProfileName ||
              (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped'))
            }}
          </span>
        </button>
      </div>

      <button
        ref="toggle"
        type="button"
        class="nav-toggle"
        :aria-label="t('navigation.toggle')"
        :aria-expanded="expanded"
        aria-controls="main-navigation"
        @click="expanded = !expanded"
      >
        <span>{{ t('navigation.menu') }}</span>
        <Icon :icon="expanded ? 'close' : 'arrowDown'" />
      </button>

      <nav
        id="main-navigation"
        :class="{ 'is-expanded': expanded }"
        class="main-nav"
        :aria-label="t('navigation.main')"
      >
        <RouterLink
          v-for="r in routes"
          :key="r.path"
          :to="r.path"
          class="main-nav__button"
          active-class="is-active"
          @click="closeMenu"
        >
          <Icon v-if="r.meta?.icon" :icon="r.meta.icon" :size="15" color="currentColor" />
          <span>{{ r.meta?.name ? t(r.meta.name) : r.name }}</span>
        </RouterLink>

        <div class="main-nav__utilities">
          <button
            type="button"
            class="main-nav__icon-btn"
            :aria-label="t('common.commandPalette')"
            :title="`${t('common.commandPalette')} (Ctrl/⌘ + K)`"
            @click="openCommandPalette"
          >
            <Icon icon="command" :size="15" color="currentColor" />
          </button>
          <button
            type="button"
            class="main-nav__icon-btn"
            :aria-label="t('common.switchTheme')"
            :title="t('common.switchTheme')"
            @click="toggleTheme"
          >
            <Icon :icon="isDarkTheme ? 'sun' : 'moon'" :size="15" color="currentColor" />
          </button>
          <button
            type="button"
            class="main-nav__logout"
            :title="t('auth.logout')"
            @click="handleLogout"
          >
            <Icon icon="logout" :size="15" color="currentColor" />
            <span>{{ t('auth.signOut') }}</span>
          </button>
        </div>
      </nav>
    </div>
  </header>
</template>

<style lang="less" scoped>
.app-header {
  flex-shrink: 0;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
}
.app-header__inner {
  max-width: 1360px;
  margin: 0 auto;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.app-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}
.app-brand__link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--color);
}
.core-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 150px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--muted-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.16s ease;
  &:hover {
    border-color: var(--accent-text);
    color: var(--color);
  }
  &.is-running .core-pill__dot {
    background: var(--success-color);
    box-shadow: 0 0 0 3px var(--success-soft);
  }
  &.is-stopped .core-pill__dot {
    background: var(--muted-color);
  }
}
.core-pill__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
.core-pill__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main-nav {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}
.main-nav__utilities {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.main-nav__button,
.main-nav__logout,
.main-nav__icon-btn,
.nav-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  color: var(--color);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.14s ease,
    color 0.14s ease;
  &:hover {
    background: var(--btn-text-hover-bg);
  }
  &.is-active {
    color: var(--accent-text);
    background: var(--accent-soft);
    font-weight: 600;
  }
}
.main-nav__icon-btn,
.main-nav__logout {
  color: var(--muted-color);
  &:hover {
    color: var(--color);
  }
}
.main-nav__logout:hover {
  color: var(--danger-color);
  background: var(--danger-soft);
}
.nav-toggle {
  display: none;
}
@media (max-width: 760px) {
  .app-header__inner {
    padding: 10px 16px;
    gap: 10px;
  }
  .app-brand {
    flex: 1;
    min-width: 0;
  }
  .core-pill {
    max-width: 110px;
  }
  .nav-toggle {
    display: inline-flex;
    min-height: 40px;
  }
  .main-nav {
    display: none;
    flex-basis: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }
  .main-nav.is-expanded {
    display: grid;
  }
  .main-nav__button {
    justify-content: flex-start;
    min-height: 42px;
    white-space: normal;
  }
  .main-nav__utilities {
    grid-column: 1 / -1;
    margin-left: 0;
    padding-top: 6px;
    border-top: 1px solid var(--border-color);
    justify-content: flex-end;
  }
}
</style>
