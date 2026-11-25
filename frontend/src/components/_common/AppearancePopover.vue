<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  ColorOptions,
  Colors,
  FontSizeOptions,
  MaxFontSize,
  MinFontSize,
  NavLayoutOptions,
  ThemeOptions,
  UiDensityOptions,
  UiStyleOptions,
} from '@/constant/app'
import { Color, NavLayout } from '@/enums/app'
import { useAppSettingsStore } from '@/stores'

import Dropdown from '@/components/Dropdown/index.vue'

import FontPresetSelector from './FontPresetSelector.vue'

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

const adjustFontSize = (delta: number) => {
  appSettings.app.fontSize = Math.min(
    MaxFontSize,
    Math.max(MinFontSize, appSettings.app.fontSize + delta),
  )
}

const swatchBackground = (color: App.Color) => {
  if (color === Color.Custom) {
    return 'conic-gradient(#f43f5e, #f59e0b, #10b981, #06b6d4, #6366f1, #ec4899, #f43f5e)'
  }
  const palette = Colors[color]
  return `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`
}

const onThemeClick = (e: MouseEvent) => {
  document.documentElement.style.setProperty('--x', e.clientX + 'px')
  document.documentElement.style.setProperty('--y', e.clientY + 'px')
}
</script>

<template>
  <Dropdown ref="dropdown" :trigger="['click']">
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

    <template #overlay>
      <div class="appearance-panel" role="dialog" :aria-label="t('settings.appearance.quickSwitch')">
        <div class="appearance-panel__header">
          <div class="appearance-panel__title">
            <Icon icon="palette" :size="15" color="var(--accent-text)" />
            <span>{{ t('settings.appearance.quickSwitch') }}</span>
          </div>
          <span class="appearance-panel__badge">{{ t(currentStyleLabel) }}</span>
        </div>

        <div class="appearance-section">
          <div class="appearance-section__label">{{ t('settings.appearance.style') }}</div>
          <div class="style-grid">
            <button
              v-for="opt in UiStyleOptions"
              :key="opt.value"
              type="button"
              class="style-option"
              :class="{ 'is-active': appSettings.app.uiStyle === opt.value }"
              :aria-pressed="appSettings.app.uiStyle === opt.value"
              @click="appSettings.app.uiStyle = opt.value"
            >
              <span class="style-thumb" :class="`style-thumb--${opt.value}`" aria-hidden="true">
                <span class="style-thumb__sidebar"></span>
                <span class="style-thumb__main">
                  <span class="style-thumb__bar"></span>
                  <span class="style-thumb__cards">
                    <span class="style-thumb__card is-accent"></span>
                    <span class="style-thumb__card"></span>
                  </span>
                </span>
              </span>
              <span class="style-option__meta">
                <span class="style-option__name">{{ t(opt.label) }}</span>
                <Icon
                  v-if="appSettings.app.uiStyle === opt.value"
                  icon="selected"
                  :size="13"
                  color="var(--accent-text)"
                />
              </span>
            </button>
          </div>
        </div>

        <div class="appearance-section">
          <div class="appearance-section__label">{{ t('settings.color.name') }}</div>
          <div class="swatch-row">
            <button
              v-for="opt in ColorOptions"
              :key="opt.value"
              type="button"
              class="swatch-btn"
              :class="{ 'is-active': appSettings.app.color === opt.value }"
              :style="{ background: swatchBackground(opt.value) }"
              :title="t(opt.label)"
              :aria-label="t(opt.label)"
              :aria-pressed="appSettings.app.color === opt.value"
              @click="appSettings.app.color = opt.value"
            >
              <Icon
                v-if="appSettings.app.color === opt.value"
                icon="selected"
                :size="13"
                color="#ffffff"
              />
            </button>
          </div>
          <div v-if="appSettings.app.color === Color.Custom" class="custom-color-row">
            <ColorPicker v-model="appSettings.app.primaryColor">
              <template #suffix>
                <span class="text-12">{{ t('settings.color.primary') }}</span>
              </template>
            </ColorPicker>
            <ColorPicker v-model="appSettings.app.secondaryColor">
              <template #suffix>
                <span class="text-12">{{ t('settings.color.secondary') }}</span>
              </template>
            </ColorPicker>
          </div>
        </div>

        <div class="appearance-section">
          <div class="appearance-section__label">{{ t('settings.appearance.layout') }}</div>
          <div class="layout-grid">
            <button
              v-for="opt in NavLayoutOptions"
              :key="opt.value"
              type="button"
              class="layout-option"
              :class="{ 'is-active': appSettings.app.navLayout === opt.value }"
              :aria-pressed="appSettings.app.navLayout === opt.value"
              @click="appSettings.app.navLayout = opt.value"
            >
              <span
                class="layout-wire"
                :class="opt.value === NavLayout.Sidebar ? 'layout-wire--sidebar' : 'layout-wire--topnav'"
                aria-hidden="true"
              >
                <span class="layout-wire__nav"></span>
                <span class="layout-wire__body"></span>
              </span>
              <span>{{ t(opt.label) }}</span>
            </button>
          </div>
        </div>

        <div class="appearance-section">
          <div class="appearance-section__label">{{ t('settings.fontFamily') }}</div>
          <FontPresetSelector variant="popover" />
        </div>

        <div class="appearance-section">
          <div class="appearance-section__head">
            <span class="appearance-section__label">{{ t('settings.fontSize.name') }}</span>
            <span class="appearance-section__value font-mono">{{ appSettings.app.fontSize }}px</span>
          </div>
          <div class="font-size-bar">
            <button
              type="button"
              class="size-step-btn"
              :disabled="appSettings.app.fontSize <= MinFontSize"
              :aria-label="t('settings.fontSize.decrease')"
              @click="adjustFontSize(-1)"
            >
              A-
            </button>
            <div class="size-preset-row">
              <button
                v-for="opt in FontSizeOptions"
                :key="opt.value"
                type="button"
                class="size-preset-btn"
                :class="{ 'is-active': appSettings.app.fontSize === opt.value }"
                :aria-pressed="appSettings.app.fontSize === opt.value"
                @click="appSettings.app.fontSize = opt.value"
              >
                {{ t(opt.label) }}
              </button>
            </div>
            <button
              type="button"
              class="size-step-btn"
              :disabled="appSettings.app.fontSize >= MaxFontSize"
              :aria-label="t('settings.fontSize.increase')"
              @click="adjustFontSize(1)"
            >
              A+
            </button>
          </div>
        </div>

        <div class="appearance-row">
          <div class="appearance-section">
            <div class="appearance-section__label">{{ t('settings.theme.name') }}</div>
            <Radio
              v-model="appSettings.app.theme"
              :options="ThemeOptions"
              size="small"
              @click="onThemeClick"
            />
          </div>

          <div class="appearance-section">
            <div class="appearance-section__label">{{ t('settings.appearance.density') }}</div>
            <Radio
              v-model="appSettings.app.uiDensity"
              :options="UiDensityOptions"
              size="small"
            />
          </div>
        </div>
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
  font-size: 13.5px;
  font-weight: 700;
}

.appearance-panel__badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.appearance-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.appearance-section__label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted-color);
  letter-spacing: 0.02em;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.style-option {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  color: var(--color);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.14s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
    transform: translateY(-1px);
  }

  &.is-active {
    border-color: var(--accent-text);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-text) 30%, transparent);
  }
}

.style-option__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 2px;
}

.style-option__name {
  font-size: 12px;
  font-weight: 600;
}

.style-thumb {
  display: flex;
  gap: 4px;
  height: 44px;
  padding: 5px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.24);
}

.style-thumb__sidebar {
  width: 14px;
  border-radius: 3px;
  flex-shrink: 0;
}

.style-thumb__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.style-thumb__bar {
  height: 7px;
  border-radius: 3px;
}

.style-thumb__cards {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.style-thumb__card {
  border-radius: 4px;
}

.style-thumb--modern {
  background: radial-gradient(circle at 10% 10%, rgba(59, 130, 246, 0.24), #eef3fc 65%);
  .style-thumb__sidebar,
  .style-thumb__bar,
  .style-thumb__card {
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
  }
  .style-thumb__card.is-accent {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  }
}

.style-thumb--glass {
  background: linear-gradient(135deg, #93c5fd 0%, #c4b5fd 52%, #67e8f9 100%);
  .style-thumb__sidebar,
  .style-thumb__bar,
  .style-thumb__card {
    background: rgba(255, 255, 255, 0.58);
    border: 1px solid rgba(255, 255, 255, 0.72);
    border-radius: 5px;
  }
  .style-thumb__card.is-accent {
    background: color-mix(in srgb, var(--primary-color) 70%, rgba(255, 255, 255, 0.5));
  }
}

.style-thumb--minimal {
  background: #f6f7f9;
  .style-thumb__sidebar,
  .style-thumb__bar,
  .style-thumb__card {
    background: #ffffff;
    border: 1px solid #d5dbe5;
    border-radius: 2px;
  }
  .style-thumb__card.is-accent {
    background: #1e293b;
    border-color: #1e293b;
  }
}

.style-thumb--cyber {
  background-color: #0b1120;
  background-image: radial-gradient(circle at 1px 1px, rgba(56, 189, 248, 0.36) 1px, transparent 0);
  background-size: 7px 7px;
  border-color: color-mix(in srgb, var(--primary-color) 50%, #1e293b);
  .style-thumb__sidebar,
  .style-thumb__bar,
  .style-thumb__card {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid color-mix(in srgb, var(--primary-color) 48%, transparent);
    border-radius: 2px;
  }
  .style-thumb__card.is-accent {
    background: color-mix(in srgb, var(--primary-color) 42%, #0f172a);
    box-shadow: 0 0 8px color-mix(in srgb, var(--primary-color) 75%, transparent);
  }
}

.swatch-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition:
    transform 0.14s ease,
    box-shadow 0.16s ease;

  &:hover {
    transform: scale(1.1);
  }

  &.is-active {
    box-shadow:
      0 0 0 2px var(--surface-elevated-bg, var(--card-bg)),
      0 0 0 4px var(--primary-color);
  }
}

.custom-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.layout-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.layout-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  color: var(--color);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease,
    color 0.14s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
  }

  &.is-active {
    border-color: var(--accent-text);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
}

.layout-wire {
  display: flex;
  width: 26px;
  height: 18px;
  padding: 2px;
  gap: 2px;
  border-radius: 4px;
  border: 1px solid currentColor;
  opacity: 0.8;
  flex-shrink: 0;

  &--sidebar {
    flex-direction: row;
    .layout-wire__nav {
      width: 6px;
      height: 100%;
    }
    .layout-wire__body {
      flex: 1;
      height: 100%;
    }
  }

  &--topnav {
    flex-direction: column;
    .layout-wire__nav {
      width: 100%;
      height: 4px;
    }
    .layout-wire__body {
      width: 100%;
      flex: 1;
    }
  }
}

.layout-wire__nav {
  border-radius: 1.5px;
  background: currentColor;
}

.layout-wire__body {
  border-radius: 1.5px;
  background: color-mix(in srgb, currentColor 24%, transparent);
}

.appearance-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.appearance-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.appearance-section__value {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent-text);
}

.font-size-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.size-preset-row {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.size-step-btn,
.size-preset-btn {
  height: 28px;
  padding: 0 6px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  color: var(--color);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease,
    color 0.14s ease;

  &:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
    color: var(--accent-text);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.size-step-btn {
  min-width: 30px;
  font-weight: 650;
  flex-shrink: 0;
}

.size-preset-btn.is-active {
  border-color: var(--accent-text);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}
</style>
