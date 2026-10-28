<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import logo from '@/assets/logo'
import rawRoutes from '@/router/routes'
import { useAppSettingsStore, useWebuiAuthStore } from '@/stores'

const { t } = useI18n()
const route = useRoute()
const appSettings = useAppSettingsStore()
const authStore = useWebuiAuthStore()
const expanded = ref(false)
const toggle = ref<HTMLButtonElement>()

const routes = computed(() =>
  rawRoutes.filter(
    (r) =>
      r.meta?.hidden === false ||
      (!r.meta?.hidden && appSettings.app.pages.includes(r.name! as string)),
  ),
)

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
</script>

<template>
  <header class="app-header" @keydown.esc="closeMenu">
    <div class="app-header__inner">
      <div class="app-brand">
        <img :src="logo" alt="" width="28" height="28" />
        <span>GUI.for.SingBox</span>
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
          <Icon v-if="r.meta?.icon" :icon="r.meta.icon" />
          <span>{{ r.meta?.name ? t(r.meta.name) : r.name }}</span>
        </RouterLink>
        <button
          type="button"
          class="main-nav__logout"
          :title="t('auth.logout')"
          @click="authStore.logout()"
        >
          <Icon icon="grant" />
          <span>{{ t('auth.signOut') }}</span>
        </button>
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
  padding: 12px 24px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 24px;
}
.app-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}
.main-nav {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.main-nav__button,
.main-nav__logout,
.nav-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  color: var(--color);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    background: var(--btn-text-hover-bg);
  }
  &.is-active {
    color: var(--accent-text);
    background: var(--accent-soft);
    font-weight: 600;
  }
}
.main-nav__logout {
  margin-left: auto;
  color: var(--muted-color);
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
  }
  .nav-toggle {
    display: inline-flex;
    min-height: 44px;
  }
  .main-nav {
    display: none;
    flex-basis: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .main-nav.is-expanded {
    display: grid;
  }
  .main-nav__button,
  .main-nav__logout {
    justify-content: flex-start;
    min-height: 44px;
    white-space: normal;
  }
  .main-nav__logout {
    margin-left: 0;
  }
}
</style>
