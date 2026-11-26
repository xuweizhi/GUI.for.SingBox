<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import logo from '@/assets/logo'
import rawRoutes from '@/router/routes'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore } from '@/stores'

import CoreControls from './CoreControls.vue'

const props = withDefaults(defineProps<{ topnav?: boolean }>(), {
  topnav: false,
})

const mobileOpen = defineModel<boolean>('mobileOpen', { default: false })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const { t } = useI18n()
const route = useRoute()

const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()
const profilesStore = useProfilesStore()

const visibleRoutes = computed(() =>
  rawRoutes.filter(
    (r) =>
      r.meta?.hidden === false ||
      (!r.meta?.hidden && appSettings.app.pages.includes(r.name! as string)),
  ),
)

const groupOrder = ['control', 'config', 'system'] as const

const groupedRoutes = computed(() =>
  groupOrder
    .map((group) => ({
      key: group,
      label: `navigation.groups.${group}`,
      items: visibleRoutes.value.filter((r) => (r.meta?.group || 'system') === group),
    }))
    .filter((section) => section.items.length > 0),
)

const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')

const closeMobile = () => {
  mobileOpen.value = false
}

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <Transition name="drawer-backdrop">
    <div v-if="mobileOpen" class="sidebar-backdrop" aria-hidden="true" @click="closeMobile" />
  </Transition>

  <aside
    id="main-navigation"
    class="app-sidebar"
    :class="{
      'is-collapsed': collapsed,
      'is-mobile-open': mobileOpen,
      'is-topnav-mode': props.topnav,
    }"
    :aria-label="t('navigation.main')"
  >
    <div class="sidebar-header">
      <RouterLink
        to="/"
        class="sidebar-brand"
        :title="collapsed ? 'GUI.for.SingBox' : undefined"
        @click="closeMobile"
      >
        <img :src="logo" alt="" width="26" height="26" class="shrink-0" />
        <span class="sidebar-brand__name">GUI.for.SingBox</span>
      </RouterLink>

      <button
        type="button"
        class="sidebar-collapse-btn"
        :aria-label="collapsed ? t('navigation.expand') : t('navigation.collapse')"
        :title="collapsed ? t('navigation.expand') : t('navigation.collapse')"
        @click="toggleCollapsed"
      >
        <Icon icon="sidebar" :size="16" color="currentColor" />
      </button>

      <button
        type="button"
        class="sidebar-close-btn"
        :aria-label="t('common.close')"
        @click="closeMobile"
      >
        <Icon icon="close" :size="16" color="currentColor" />
      </button>
    </div>

    <nav class="sidebar-nav">
      <div
        v-for="(section, sIdx) in groupedRoutes"
        :key="section.key"
        class="sidebar-group"
        :class="{ 'has-divider': sIdx > 0 }"
      >
        <div class="sidebar-group__label">{{ t(section.label) }}</div>
        <RouterLink
          v-for="r in section.items"
          :key="r.path"
          v-tips.fast="collapsed && r.meta?.name ? r.meta.name : ''"
          :to="r.path"
          class="sidebar-link"
          active-class=""
          :class="{
            'is-active':
              route.path === '/'
                ? r.path ===
                  (['groups', 'connections', 'logs'].includes(String(route.query.tab))
                    ? '/' + route.query.tab
                    : '/')
                : route.path === r.path ||
                  (r.path === '/profiles' && route.path.startsWith('/profiles/')),
          }"
          @click="closeMobile"
        >
          <Icon
            v-if="r.meta?.icon"
            :icon="r.meta.icon"
            :size="17"
            color="currentColor"
            class="sidebar-link__icon shrink-0"
          />
          <span class="sidebar-link__text">
            {{ r.meta?.name ? t(r.meta.name) : r.name }}
          </span>
        </RouterLink>
      </div>
    </nav>

    <Dropdown class="sidebar-footer" placement="top" align="start">
      <button
        type="button"
        class="sidebar-core-card"
        :class="kernelApiStore.running ? 'is-running' : 'is-stopped'"
        :title="
          (kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped')) +
          (activeProfileName ? ' · ' + activeProfileName : '')
        "
      >
        <span class="sidebar-core-card__dot" aria-hidden="true"></span>
        <span class="sidebar-core-card__info">
          <span class="sidebar-core-card__state">
            {{ kernelApiStore.running ? t('common.coreRunning') : t('common.coreStopped') }}
          </span>
          <span v-if="activeProfileName" class="sidebar-core-card__profile">
            {{ activeProfileName }}
          </span>
        </span>
      </button>
      <template #overlay="{ show, close }"
        ><CoreControls v-if="show" @close="close"
      /></template>
    </Dropdown>
  </aside>
</template>

<style lang="less" scoped>
.sidebar-backdrop {
  display: none;
}

.app-sidebar {
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-chrome-bg, var(--card-bg));
  border-right: 1px solid var(--surface-border, var(--border-color));
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 40;
  overflow: hidden;

  &.is-topnav-mode {
    display: none;
  }

  &.is-collapsed {
    width: 64px;

    .sidebar-header {
      flex-direction: column;
      justify-content: center;
      padding: 2px 8px;
      gap: 2px;
    }

    .sidebar-brand {
      justify-content: center;

      img {
        width: 18px;
        height: 18px;
      }
    }

    .sidebar-brand__name,
    .sidebar-group__label,
    .sidebar-link__text,
    .sidebar-core-card__info {
      display: none;
    }

    .sidebar-collapse-btn {
      position: static;
      width: 20px;
      height: 20px;
    }

    .sidebar-group.has-divider::before {
      content: '';
      display: block;
      height: 1px;
      margin: 6px 10px 8px;
      background: var(--border-color);
    }

    .sidebar-link {
      justify-content: center;
      padding: 0;
      width: 40px;
      height: 40px;
      margin: 0 auto;

      &.is-active::before {
        display: none;
      }
    }

    .sidebar-core-card {
      justify-content: center;
      padding: 10px 0;
    }
  }
}

.sidebar-header {
  height: var(--topbar-height, 54px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--surface-border, var(--border-color));
}

.sidebar-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  font-size: calc(14px * var(--font-scale, 1));
  font-weight: 700;
  color: var(--color);
  white-space: nowrap;
}

.sidebar-brand__name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-collapse-btn,
.sidebar-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted-color);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.14s ease,
    color 0.14s ease;

  &:hover {
    background: var(--btn-text-hover-bg);
    color: var(--color);
  }
}

.app-sidebar.is-collapsed .sidebar-brand {
  display: inline-flex;
}

.sidebar-close-btn {
  display: none;
}

.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-group__label {
  padding: 0 10px 6px;
  font-size: calc(11px * var(--font-scale, 1));
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted-color);
  opacity: 0.85;
  white-space: nowrap;
}

.sidebar-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 6px 10px;
  border-radius: var(--control-radius, 8px);
  font-size: calc(13.5px * var(--font-scale, 1));
  font-weight: 500;
  color: var(--color);
  white-space: nowrap;
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.18s ease;

  &:hover {
    background: var(--btn-text-hover-bg);
  }

  &.is-active {
    background: var(--accent-soft);
    color: var(--accent-text);
    box-shadow: var(--active-indicator-shadow);
    font-weight: 600;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 3px;
      border-radius: 999px;
      background: var(--accent-text);
    }
  }
}

.sidebar-link__text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-footer {
  flex-shrink: 0;
  padding: 10px;
  border-top: 1px solid var(--border-color);
}

.sidebar-core-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--color);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 50%, var(--border-color));
  }

  &.is-running .sidebar-core-card__dot {
    background: var(--success-color);
    box-shadow: 0 0 0 3px var(--success-soft);
  }

  &.is-stopped .sidebar-core-card__dot {
    background: var(--muted-color);
  }
}

.sidebar-core-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.sidebar-core-card__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.sidebar-core-card__state {
  font-size: calc(12px * var(--font-scale, 1));
  font-weight: 600;
  color: var(--color);
}

.sidebar-core-card__profile {
  font-size: calc(11.5px * var(--font-scale, 1));
  color: var(--muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

@media (max-width: 1024px) {
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 900;
    background: var(--modal-mask-bg);
    backdrop-filter: blur(2px);
  }

  .app-sidebar,
  .app-sidebar.is-collapsed,
  .app-sidebar.is-topnav-mode {
    display: flex;
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(272px, 82vw);
    z-index: 910;
    transform: translateX(-100%);
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 16px 48px rgba(15, 23, 42, 0.24);

    &.is-mobile-open {
      transform: translateX(0);
    }

    .sidebar-header {
      justify-content: space-between;
      padding: 0 12px 0 16px;
    }

    .sidebar-brand {
      display: inline-flex;
      justify-content: flex-start;
    }

    .sidebar-brand__name,
    .sidebar-group__label,
    .sidebar-link__text,
    .sidebar-core-card__info {
      display: initial;
    }

    .sidebar-core-card__info {
      display: flex;
    }

    .sidebar-collapse-btn {
      display: none;
    }

    .sidebar-close-btn {
      display: inline-flex;
    }

    .sidebar-group.has-divider::before {
      display: none;
    }

    .sidebar-link {
      justify-content: flex-start;
      width: auto;
      height: 42px;
      padding: 0 12px;
      margin: 0;

      &.is-active::before {
        display: block;
      }
    }

    .sidebar-core-card {
      justify-content: flex-start;
      padding: 10px 12px;
    }
  }
}

.drawer-backdrop-enter-active,
.drawer-backdrop-leave-active {
  transition: opacity 0.18s ease;
}

.drawer-backdrop-enter-from,
.drawer-backdrop-leave-to {
  opacity: 0;
}
</style>
