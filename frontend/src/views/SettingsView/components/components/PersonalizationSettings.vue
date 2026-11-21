<script lang="ts" setup>
import { BrowserOpenURL } from '@/bridge'
import FontPresetSelector from '@/components/_common/FontPresetSelector.vue'
import {
  ColorOptions,
  Colors,
  DefaultFontSize,
  FontSizeOptions,
  MaxFontSize,
  MinFontSize,
  NavLayoutOptions,
  ThemeOptions,
  UiDensityOptions,
  UiStyleOptions,
} from '@/constant/app'
import { Color, NavLayout } from '@/enums/app'
import routes from '@/router/routes'
import { useAppSettingsStore, useAppStore } from '@/stores'
import { APP_LOCALES_URL } from '@/utils'

const pages = routes.flatMap((route) => {
  if (route.meta?.hidden !== undefined || !route.meta?.name) return []
  return {
    label: route.meta.name,
    value: route.name as string,
  }
})

const appStore = useAppStore()
const appSettings = useAppSettingsStore()

const adjustFontSize = (delta: number) => {
  const next = Math.min(MaxFontSize, Math.max(MinFontSize, appSettings.app.fontSize + delta))
  appSettings.app.fontSize = next
}

const resetFontSize = () => {
  appSettings.app.fontSize = DefaultFontSize
}

const onThemeClick = (e: MouseEvent) => {
  document.documentElement.style.setProperty('--x', e.clientX + 'px')
  document.documentElement.style.setProperty('--y', e.clientY + 'px')
}

const swatchBackground = (color: App.Color) => {
  if (color === Color.Custom) {
    return 'conic-gradient(#f43f5e, #f59e0b, #10b981, #06b6d4, #6366f1, #ec4899, #f43f5e)'
  }
  const palette = Colors[color]
  return `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`
}
</script>

<template>
  <div class="px-8 py-12 text-16 font-bold">{{ $t('settings.personalization') }}</div>

  <Card>
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('settings.appearance.style') }}</div>
      <div class="style-cards">
        <button
          v-for="opt in UiStyleOptions"
          :key="opt.value"
          type="button"
          class="style-card"
          :class="{ 'is-active': appSettings.app.uiStyle === opt.value }"
          :aria-pressed="appSettings.app.uiStyle === opt.value"
          @click="appSettings.app.uiStyle = opt.value"
        >
          <span class="style-preview" :class="`style-preview--${opt.value}`" aria-hidden="true">
            <span class="style-preview__sidebar"></span>
            <span class="style-preview__content">
              <span class="style-preview__topbar"></span>
              <span class="style-preview__grid">
                <span class="style-preview__tile is-accent"></span>
                <span class="style-preview__tile"></span>
              </span>
            </span>
          </span>
          <span class="style-card__header">
            <span class="style-card__name">{{ $t(opt.label) }}</span>
            <span v-if="appSettings.app.uiStyle === opt.value" class="style-card__check">
              <Icon icon="selected" :size="12" color="#ffffff" />
            </span>
          </span>
          <span class="style-card__desc">{{ $t(opt.desc) }}</span>
        </button>
      </div>
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.appearance.layout') }}</div>
      <div class="layout-picker">
        <button
          v-for="opt in NavLayoutOptions"
          :key="opt.value"
          type="button"
          class="layout-card"
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
          <span class="layout-card__label">{{ $t(opt.label) }}</span>
        </button>
      </div>
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.theme.name') }}</div>
      <Radio v-model="appSettings.app.theme" :options="ThemeOptions" @click="onThemeClick" />
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.appearance.density') }}</div>
      <Radio v-model="appSettings.app.uiDensity" :options="UiDensityOptions" />
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.color.name') }}</div>
      <div class="color-picker-block">
        <div class="color-chips">
          <button
            v-for="opt in ColorOptions"
            :key="opt.value"
            type="button"
            class="color-chip"
            :class="{ 'is-active': appSettings.app.color === opt.value }"
            :aria-pressed="appSettings.app.color === opt.value"
            @click="appSettings.app.color = opt.value"
          >
            <span
              class="color-chip__dot"
              :style="{ background: swatchBackground(opt.value) }"
              aria-hidden="true"
            ></span>
            <span>{{ $t(opt.label) }}</span>
          </button>
        </div>
        <div v-if="appSettings.app.color === Color.Custom" class="flex items-center gap-8 mt-8">
          <ColorPicker v-model="appSettings.app.primaryColor">
            <template #suffix>
              <div class="text-12">{{ $t('settings.color.primary') }}</div>
            </template>
          </ColorPicker>
          <ColorPicker v-model="appSettings.app.secondaryColor">
            <template #suffix>
              <div class="text-12">{{ $t('settings.color.secondary') }}</div>
            </template>
          </ColorPicker>
        </div>
      </div>
    </div>

    <div class="settings-row">
      <div class="flex items-center">
        <div class="mr-4">{{ $t('settings.lang.name') }}</div>
        <Button type="text" size="small" icon="link" @click="BrowserOpenURL(APP_LOCALES_URL)" />
        <Button
          v-tips="'settings.lang.load'"
          :loading="appStore.localesLoading"
          type="text"
          size="small"
          icon="refresh"
          @click="appStore.loadLocales()"
        />
      </div>
      <Radio v-model="appSettings.app.lang" :options="appStore.locales" />
    </div>

    <div class="settings-row settings-row--font">
      <div>{{ $t('settings.fontFamily') }}</div>
      <FontPresetSelector variant="settings" />
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.fontSize.name') }}</div>
      <div class="font-size-block">
        <div class="font-size-presets">
          <button
            v-for="opt in FontSizeOptions"
            :key="opt.value"
            type="button"
            class="font-chip"
            :class="{ 'is-active': appSettings.app.fontSize === opt.value }"
            :aria-pressed="appSettings.app.fontSize === opt.value"
            @click="appSettings.app.fontSize = opt.value"
          >
            <span>{{ $t(opt.label) }}</span>
            <span class="font-size-px">{{ opt.value }}px</span>
          </button>
        </div>
        <div class="font-size-stepper">
          <button
            type="button"
            class="stepper-btn"
            :disabled="appSettings.app.fontSize <= MinFontSize"
            :aria-label="$t('settings.fontSize.decrease')"
            @click="adjustFontSize(-1)"
          >
            A-
          </button>
          <span class="stepper-value font-mono">{{ appSettings.app.fontSize }}px</span>
          <button
            type="button"
            class="stepper-btn"
            :disabled="appSettings.app.fontSize >= MaxFontSize"
            :aria-label="$t('settings.fontSize.increase')"
            @click="adjustFontSize(1)"
          >
            A+
          </button>
          <Button
            v-if="appSettings.app.fontSize !== DefaultFontSize"
            v-tips="'settings.fontSize.reset'"
            type="text"
            size="small"
            icon="reset"
            @click="resetFontSize"
          />
        </div>
      </div>
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.pages.name') }}</div>
      <CheckBox v-model="appSettings.app.pages" :options="pages" />
    </div>
  </Card>
</template>

<style lang="less" scoped>
.settings-section {
  padding: var(--row-pad-y, 14px) 0;
  border-bottom: 1px solid var(--border-color);
}

.settings-section__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.style-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.style-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px;
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
    box-shadow: var(--active-indicator-shadow);
  }
}

.style-preview {
  display: flex;
  gap: 5px;
  height: 54px;
  padding: 6px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  overflow: hidden;
}

.style-preview__sidebar {
  width: 18px;
  border-radius: 3px;
  flex-shrink: 0;
}

.style-preview__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.style-preview__topbar {
  height: 8px;
  border-radius: 3px;
}

.style-preview__grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.style-preview__tile {
  border-radius: 4px;
}

.style-preview--modern {
  background: radial-gradient(circle at 12% 10%, rgba(59, 130, 246, 0.24), #eef3fc 66%);
  .style-preview__sidebar,
  .style-preview__topbar,
  .style-preview__tile {
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
  }
  .style-preview__tile.is-accent {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  }
}

.style-preview--glass {
  background: linear-gradient(135deg, #93c5fd 0%, #c4b5fd 52%, #67e8f9 100%);
  .style-preview__sidebar,
  .style-preview__topbar,
  .style-preview__tile {
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.74);
    border-radius: 5px;
  }
  .style-preview__tile.is-accent {
    background: color-mix(in srgb, var(--primary-color) 72%, rgba(255, 255, 255, 0.45));
  }
}

.style-preview--minimal {
  background: #f6f7f9;
  .style-preview__sidebar,
  .style-preview__topbar,
  .style-preview__tile {
    background: #ffffff;
    border: 1px solid #d5dbe5;
    border-radius: 2px;
  }
  .style-preview__tile.is-accent {
    background: #1e293b;
    border-color: #1e293b;
  }
}

.style-preview--cyber {
  background-color: #0b1120;
  background-image: radial-gradient(circle at 1px 1px, rgba(56, 189, 248, 0.36) 1px, transparent 0);
  background-size: 7px 7px;
  border-color: color-mix(in srgb, var(--primary-color) 52%, #1e293b);
  .style-preview__sidebar,
  .style-preview__topbar,
  .style-preview__tile {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid color-mix(in srgb, var(--primary-color) 48%, transparent);
    border-radius: 2px;
  }
  .style-preview__tile.is-accent {
    background: color-mix(in srgb, var(--primary-color) 42%, #0f172a);
    box-shadow: 0 0 10px color-mix(in srgb, var(--primary-color) 75%, transparent);
  }
}

.style-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.style-card__name {
  font-size: 13px;
  font-weight: 650;
}

.style-card__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--primary-color);
  flex-shrink: 0;
}

.style-card__desc {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--muted-color);
}

.layout-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.layout-card {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  color: var(--color);
  font: inherit;
  font-size: 13px;
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
    box-shadow: var(--active-indicator-shadow);
    font-weight: 600;
  }
}

.layout-wire {
  display: flex;
  width: 30px;
  height: 20px;
  padding: 2px;
  gap: 2px;
  border-radius: 4px;
  border: 1px solid currentColor;
  opacity: 0.85;
  flex-shrink: 0;

  &--sidebar {
    flex-direction: row;
    .layout-wire__nav {
      width: 7px;
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
      height: 5px;
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

.color-picker-block {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.color-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.color-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 7px;
  border-radius: 999px;
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
    transform 0.12s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
    transform: translateY(-1px);
  }

  &.is-active {
    border-color: var(--accent-text);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
}

.color-chip__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.settings-row--font {
  align-items: start;

  > :first-child {
    padding-top: 6px;
  }
}

.font-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
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
    color 0.14s ease,
    transform 0.12s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
    transform: translateY(-1px);
  }

  &.is-active {
    border-color: var(--accent-text);
    background: var(--accent-soft);
    color: var(--accent-text);
    box-shadow: var(--active-indicator-shadow);
    font-weight: 600;
  }
}

.font-size-block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.font-size-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.font-size-px {
  font-size: 11px;
  opacity: 0.72;
}

.font-size-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 70%, var(--surface-bg));
}

.stepper-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 26px;
  padding: 0 7px;
  border: 0;
  border-radius: max(3px, calc(var(--control-radius, 8px) - 3px));
  background: transparent;
  color: var(--color);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    color 0.14s ease;

  &:hover:not(:disabled) {
    background: var(--btn-text-hover-bg);
    color: var(--accent-text);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.stepper-value {
  min-width: 42px;
  text-align: center;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent-text);
}

@media (max-width: 900px) {
  .style-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .settings-row--font > :first-child {
    padding-top: 0;
  }
}

@media (max-width: 520px) {
  .style-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
