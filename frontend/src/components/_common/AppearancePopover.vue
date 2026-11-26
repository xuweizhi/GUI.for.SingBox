<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { UiStyleOptions } from '@/constant/app'
import { useAppSettingsStore } from '@/stores'

import Dropdown from '@/components/Dropdown/index.vue'

import AppearanceControls from './AppearanceControls.vue'

const { t } = useI18n()
const appSettings = useAppSettingsStore()

const dropdown = useTemplateRef('dropdown')
watch(
  () => [
    appSettings.app.navLayout,
    appSettings.app.uiDensity,
    appSettings.app.fontSize,
    appSettings.app.fontFamily,
    appSettings.app.uiStyle,
  ],
  () => dropdown.value?.updatePosition?.(),
  { flush: 'post' },
)

const currentStyleLabel = computed(
  () =>
    UiStyleOptions.find((o) => o.value === appSettings.app.uiStyle)?.label ||
    'settings.appearance.styles.modern.name',
)
</script>

<template>
  <Dropdown ref="dropdown" align="end" :trigger="['click']">
    <template #default="{ show }">
      <button
        type="button"
        class="appearance-trigger"
        :class="{ 'is-open': show }"
        :aria-label="t('settings.appearance.quickSwitch')"
        :title="t('settings.appearance.quickSwitch')"
      >
        <Icon icon="palette" :size="16" color="currentColor" />
        <span class="appearance-trigger__dot" aria-hidden="true"></span>
      </button>
    </template>

    <template #overlay="{ close }">
      <div
        class="appearance-panel"
        role="dialog"
        :aria-label="t('settings.appearance.quickSwitch')"
      >
        <div class="appearance-panel__header">
          <div class="appearance-panel__title">
            <Icon icon="palette" :size="15" color="var(--accent-text)" />
            <span>{{ t('settings.appearance.quickSwitch') }}</span>
          </div>
          <span class="appearance-panel__badge">{{ t(currentStyleLabel) }}</span>
        </div>

        <AppearanceControls quick />
        <RouterLink to="/settings?tab=general" class="appearance-panel__more text-13" @click="close"
          >{{ t('workspace.moreAppearance') }} →</RouterLink
        >
      </div>
    </template>
  </Dropdown>
</template>

<style lang="less" scoped>
.appearance-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--control-radius, 8px);
  background: transparent;
  color: var(--muted-color);
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;

  &:hover,
  &.is-open {
    color: var(--accent-text);
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent-text) 28%, transparent);
  }
}

.appearance-trigger__dot {
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--primary-color);
  box-shadow: 0 0 0 1.5px var(--surface-chrome-bg, var(--card-bg));
}

.appearance-panel {
  width: 318px;
  max-width: calc(100vw - 24px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--color);
}

.appearance-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
}

.appearance-panel__title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: calc(13.5px * var(--font-scale, 1));
  font-weight: 700;
}

.appearance-panel__badge {
  font-size: calc(11px * var(--font-scale, 1));
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.appearance-panel__more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  color: var(--accent-text);
  font-weight: 600;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}
</style>
