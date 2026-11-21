<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { DefaultFontFamily, FontPresetOptions, MaxCustomFontPresets } from '@/constant/app'
import { useAppSettingsStore } from '@/stores'
import {
  createCustomFontPresetId,
  matchedFontPresetKey,
  normalizeFontStylesheetUrl,
  suggestFontPresetLabel,
} from '@/utils/fontPresets'

interface Props {
  variant?: 'popover' | 'settings'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'popover',
})

const { t } = useI18n()
const appSettings = useAppSettingsStore()

const isSettings = computed(() => props.variant === 'settings')
const customPresets = computed(() => appSettings.app.customFontPresets ?? [])
const atLimit = computed(() => customPresets.value.length >= MaxCustomFontPresets)

const matchedFontPreset = computed(() =>
  matchedFontPresetKey(appSettings.app.fontFamily, customPresets.value),
)
const isCustomFont = ref(matchedFontPreset.value === 'custom')

watch(matchedFontPreset, (nextKey) => {
  isCustomFont.value = nextKey === 'custom'
})

const activeFontKey = computed(() => (isCustomFont.value ? 'custom' : matchedFontPreset.value))

const creatorOpen = ref(false)
const draftLabel = ref('')
const draftFamily = ref('')
const draftUrl = ref('')
const draftError = ref('')

const selectFontPreset = (value: string) => {
  isCustomFont.value = false
  appSettings.app.fontFamily = value
}

const selectCustomFont = () => {
  isCustomFont.value = true
}

const resetFontFamily = () => {
  isCustomFont.value = false
  appSettings.app.fontFamily = DefaultFontFamily
}

const openCreator = (seedFamily = '') => {
  draftError.value = ''
  draftFamily.value = seedFamily
  draftLabel.value = seedFamily ? suggestFontPresetLabel(seedFamily) : ''
  draftUrl.value = ''
  creatorOpen.value = true
}

const closeCreator = () => {
  creatorOpen.value = false
  draftError.value = ''
}

const toggleCreator = () => {
  if (creatorOpen.value) {
    closeCreator()
  } else {
    openCreator()
  }
}

const clearError = () => {
  if (draftError.value) draftError.value = ''
}

const submitPreset = () => {
  const label = draftLabel.value.trim().slice(0, 32)
  const fontFamily = draftFamily.value.trim().slice(0, 240)
  const rawUrl = draftUrl.value.trim()

  if (!label) {
    draftError.value = t('settings.font.errorEmptyName')
    return
  }
  if (!fontFamily) {
    draftError.value = t('settings.font.errorEmptyFamily')
    return
  }
  if (atLimit.value) {
    draftError.value = t('settings.font.errorLimit', [MaxCustomFontPresets])
    return
  }
  const duplicate =
    FontPresetOptions.some((opt) => opt.value === fontFamily) ||
    customPresets.value.some((opt) => opt.fontFamily === fontFamily)
  if (duplicate) {
    draftError.value = t('settings.font.errorDuplicate')
    return
  }
  const stylesheetUrl = rawUrl ? normalizeFontStylesheetUrl(rawUrl) : undefined
  if (rawUrl && !stylesheetUrl) {
    draftError.value = t('settings.font.errorInvalidUrl')
    return
  }

  const id = createCustomFontPresetId(customPresets.value)
  const nextPreset: App.CustomFontPreset = stylesheetUrl
    ? { id, label, fontFamily, stylesheetUrl }
    : { id, label, fontFamily }

  isCustomFont.value = false
  appSettings.app.customFontPresets = [...customPresets.value, nextPreset]
  appSettings.app.fontFamily = nextPreset.fontFamily
  draftLabel.value = ''
  draftFamily.value = ''
  draftUrl.value = ''
  draftError.value = ''
  creatorOpen.value = false
}

const removePreset = (preset: App.CustomFontPreset) => {
  appSettings.app.customFontPresets = customPresets.value.filter((item) => item.id !== preset.id)
  if (appSettings.app.fontFamily === preset.fontFamily) {
    isCustomFont.value = false
    appSettings.app.fontFamily = DefaultFontFamily
  }
}
</script>

<template>
  <div class="font-selector-stack">
    <div class="font-chip-grid" :class="{ 'is-settings': isSettings }">
      <button
        v-for="opt in FontPresetOptions"
        :key="opt.key"
        type="button"
        class="font-chip"
        :class="{ 'font-chip--rich': isSettings, 'is-active': activeFontKey === opt.key }"
        :style="isSettings ? undefined : { fontFamily: opt.value }"
        :aria-pressed="activeFontKey === opt.key"
        @click="selectFontPreset(opt.value)"
      >
        <span
          v-if="isSettings"
          class="font-chip__sample"
          :style="{ fontFamily: opt.value }"
          aria-hidden="true"
        >
          Aa
        </span>
        <span :style="isSettings ? { fontFamily: opt.value } : undefined">{{ t(opt.label) }}</span>
      </button>

      <span
        v-for="preset in customPresets"
        :key="preset.id"
        class="font-chip-group"
        :class="{
          'font-chip-group--rich': isSettings,
          'is-active': activeFontKey === `preset:${preset.id}`,
        }"
      >
        <button
          type="button"
          class="font-chip font-chip--grouped"
          :class="{
            'font-chip--rich': isSettings,
            'is-active': activeFontKey === `preset:${preset.id}`,
          }"
          :style="isSettings ? undefined : { fontFamily: preset.fontFamily }"
          :title="
            preset.stylesheetUrl
              ? `${preset.fontFamily} · ${t('settings.font.webFont')}`
              : preset.fontFamily
          "
          :aria-pressed="activeFontKey === `preset:${preset.id}`"
          @click="selectFontPreset(preset.fontFamily)"
        >
          <span
            v-if="isSettings"
            class="font-chip__sample"
            :style="{ fontFamily: preset.fontFamily }"
            aria-hidden="true"
          >
            Aa
          </span>
          <span :style="isSettings ? { fontFamily: preset.fontFamily } : undefined">
            {{ preset.label }}
          </span>
          <span v-if="preset.stylesheetUrl" class="font-chip__web-dot" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          class="font-chip-remove"
          :aria-label="t('settings.font.deletePreset', [preset.label])"
          :title="t('settings.font.deletePreset', [preset.label])"
          @click="removePreset(preset)"
        >
          ×
        </button>
      </span>

      <button
        type="button"
        class="font-chip"
        :class="{ 'font-chip--rich': isSettings, 'is-active': activeFontKey === 'custom' }"
        :aria-pressed="activeFontKey === 'custom'"
        @click="selectCustomFont"
      >
        <Icon v-if="isSettings" icon="edit" :size="13" color="currentColor" />
        <span>{{ t('settings.font.custom') }}</span>
      </button>

      <button
        type="button"
        class="font-chip font-chip--add"
        :class="{ 'font-chip--rich': isSettings, 'is-active': creatorOpen }"
        :aria-expanded="creatorOpen"
        :disabled="atLimit && !creatorOpen"
        :title="
          atLimit
            ? t('settings.font.presetLimitTip', [MaxCustomFontPresets])
            : t('settings.font.addPresetTip')
        "
        @click="toggleCreator"
      >
        <span>{{ t('settings.font.addPreset') }}</span>
      </button>
    </div>

    <div v-if="activeFontKey === 'custom'" class="font-custom-row" :class="{ 'is-wide': isSettings }">
      <Input
        v-model="appSettings.app.fontFamily"
        :placeholder="t('settings.font.customPlaceholder')"
        :label="t('settings.font.customInputAria')"
        :size="isSettings ? 'default' : 'small'"
        auto-size
        clearable
        class="font-custom-row__input"
      >
        <template #suffix>
          <Button
            :title="t('settings.resetFont')"
            :aria-label="t('settings.resetFont')"
            type="text"
            size="small"
            icon="reset"
            @click="resetFontFamily"
          />
        </template>
      </Input>
      <button
        v-if="!atLimit && appSettings.app.fontFamily.trim()"
        type="button"
        class="font-save-preset-btn"
        :class="{ 'is-settings': isSettings }"
        @click="openCreator(appSettings.app.fontFamily.trim())"
      >
        {{ t('settings.font.saveAsPreset') }}
      </button>
    </div>

    <form
      v-if="creatorOpen"
      class="font-preset-creator"
      :class="{ 'is-wide': isSettings }"
      @submit.prevent="submitPreset"
    >
      <div class="font-preset-creator__head">
        <strong>{{ t('settings.font.creatorTitle') }}</strong>
        <small>{{ t('settings.font.creatorDesc') }}</small>
      </div>

      <div class="font-preset-creator__fields">
        <label class="font-preset-field">
          <span>{{ t('settings.font.presetName') }}</span>
          <input
            v-model="draftLabel"
            type="text"
            class="font-creator-input"
            :aria-label="t('settings.font.presetNameAria')"
            maxlength="32"
            :placeholder="t('settings.font.presetNamePlaceholder')"
            @input="clearError"
          />
        </label>
        <label class="font-preset-field">
          <span>{{ t('settings.font.presetFamily') }}</span>
          <input
            v-model="draftFamily"
            type="text"
            class="font-creator-input"
            :aria-label="t('settings.font.presetFamilyAria')"
            maxlength="240"
            :placeholder="t('settings.font.presetFamilyPlaceholder')"
            @input="clearError"
          />
        </label>
        <label class="font-preset-field">
          <span>{{ t('settings.font.presetUrl') }}</span>
          <input
            v-model="draftUrl"
            type="text"
            class="font-creator-input"
            :aria-label="t('settings.font.presetUrlAria')"
            :placeholder="t('settings.font.presetUrlPlaceholder')"
            @input="clearError"
          />
        </label>
      </div>

      <div
        class="font-preset-preview"
        :style="{ fontFamily: draftFamily.trim() || appSettings.app.fontFamily }"
      >
        <span class="font-preset-preview__label">{{ t('settings.font.livePreview') }}</span>
        <p class="font-preset-preview__text">{{ t('settings.font.previewSample') }}</p>
      </div>

      <div v-if="draftError" class="font-preset-error" role="alert">
        {{ draftError }}
      </div>

      <div class="font-preset-creator__actions">
        <button type="button" class="font-creator-btn font-creator-btn--secondary" @click="closeCreator">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="font-creator-btn font-creator-btn--primary">
          {{ t('settings.font.saveAndApply') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style lang="less" scoped>
.font-selector-stack {
  display: grid;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.font-chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  &.is-settings {
    gap: 7px;
  }
}

.font-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  color: var(--color);
  font: inherit;
  font-size: calc(12px * var(--font-scale, 1));
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease,
    color 0.14s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
  }

  &.is-active {
    border-color: var(--accent-text);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.font-chip--rich {
  padding: 5px 10px;
  font-size: calc(12.5px * var(--font-scale, 1));

  &:hover:not(:disabled):not(.font-chip--grouped) {
    transform: translateY(-1px);
  }

  &.is-active:not(.font-chip--grouped) {
    box-shadow: var(--active-indicator-shadow);
  }
}

.font-chip--add {
  border-style: dashed;
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent-text) 45%, var(--border-color));

  &:hover:not(:disabled) {
    background: var(--accent-soft);
    border-color: var(--accent-text);
  }
}

.font-chip__sample {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1;
}

.font-chip__web-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-text);
  flex-shrink: 0;
  opacity: 0.85;
}

.font-chip-group {
  display: inline-flex;
  align-items: stretch;
  border-radius: var(--control-radius, 8px);
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-color) 65%, var(--surface-bg));
  overflow: hidden;
  transition:
    border-color 0.14s ease,
    box-shadow 0.14s ease,
    transform 0.12s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
  }

  &.font-chip-group--rich:hover {
    transform: translateY(-1px);
  }

  &.is-active {
    border-color: var(--accent-text);
    background: var(--accent-soft);
    box-shadow: var(--active-indicator-shadow);
  }

  .font-chip--grouped {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;

    &.is-active {
      background: transparent;
      box-shadow: none;
    }
  }
}

.font-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-left: 1px solid var(--border-color);
  padding: 0 7px;
  background: transparent;
  color: var(--muted-color);
  font: inherit;
  font-size: calc(14px * var(--font-scale, 1));
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    color 0.14s ease;

  &:hover {
    background: var(--danger-soft);
    color: var(--danger-color);
  }
}

.font-chip-group.is-active .font-chip-remove {
  border-left-color: color-mix(in srgb, var(--accent-text) 28%, transparent);
  color: var(--accent-text);

  &:hover {
    background: var(--danger-soft);
    color: var(--danger-color);
  }
}

.font-custom-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  &.is-wide {
    max-width: 560px;
  }
}

.font-custom-row__input {
  flex: 1;
  min-width: 0;
}

.font-save-preset-btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 9px;
  border-radius: var(--control-radius, 8px);
  border: 1px solid color-mix(in srgb, var(--accent-text) 35%, transparent);
  background: var(--accent-soft);
  color: var(--accent-text);
  font: inherit;
  font-size: calc(11.5px * var(--font-scale, 1));
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease;

  &:hover {
    border-color: var(--accent-text);
    background: color-mix(in srgb, var(--primary-color) 18%, var(--card-bg));
  }

  &.is-settings {
    height: 36px;
    padding: 0 12px;
    font-size: calc(12.5px * var(--font-scale, 1));
  }
}

.font-preset-creator {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--control-radius, 8px);
  background: color-mix(in srgb, var(--bg-color) 70%, var(--surface-bg));

  &.is-wide {
    max-width: 580px;
  }
}

.font-preset-creator__head {
  display: grid;
  gap: 2px;

  strong {
    font-size: calc(13px * var(--font-scale, 1));
    color: var(--color);
  }

  small {
    font-size: calc(11.5px * var(--font-scale, 1));
    color: var(--muted-color);
    line-height: 1.45;
  }
}

.font-preset-creator__fields {
  display: grid;
  gap: 8px;
}

.font-preset-field {
  display: grid;
  gap: 5px;
  font-size: calc(12px * var(--font-scale, 1));
  font-weight: 600;
  color: var(--color);
}

.font-creator-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--control-radius, 8px);
  background: var(--input-bg);
  color: var(--input-color);
  font: inherit;
  font-size: calc(12.5px * var(--font-scale, 1));
  font-weight: 400;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;

  &::placeholder {
    color: var(--muted-color);
    opacity: 0.78;
  }

  &:focus {
    outline: none;
    border-color: var(--accent-text);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
}

.font-preset-preview {
  display: grid;
  gap: 4px;
  padding: 9px 11px;
  border: 1px dashed var(--border-color);
  border-radius: max(4px, calc(var(--control-radius, 8px) - 2px));
  background: var(--surface-bg);
}

.font-preset-preview__label {
  font-family: var(--app-font-family, inherit);
  font-size: calc(11px * var(--font-scale, 1));
  font-weight: 600;
  color: var(--muted-color);
}

.font-preset-preview__text {
  margin: 0;
  font-size: calc(13.5px * var(--font-scale, 1));
  color: var(--color);
  overflow-wrap: anywhere;
}

.font-preset-error {
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--danger-color) 42%, transparent);
  border-radius: max(4px, calc(var(--control-radius, 8px) - 2px));
  background: var(--danger-soft);
  color: var(--danger-color);
  font-size: calc(12px * var(--font-scale, 1));
  font-weight: 600;
}

.font-preset-creator__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.font-creator-btn {
  padding: 6px 12px;
  border-radius: var(--control-radius, 8px);
  font: inherit;
  font-size: calc(12.5px * var(--font-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}

.font-creator-btn--secondary {
  color: var(--btn-normal-color);
  background: var(--btn-normal-bg);
  border: 1px solid var(--btn-normal-border-color);

  &:hover {
    color: var(--btn-normal-hover-color);
    background: var(--btn-normal-hover-bg);
    border-color: var(--btn-normal-hover-border-color);
  }
}

.font-creator-btn--primary {
  color: var(--btn-primary-color);
  background-color: var(--btn-primary-bg);
  background-image: var(--btn-primary-bg-image);
  border: 1px solid transparent;
  box-shadow: var(--btn-primary-shadow);

  &:hover {
    background-color: var(--btn-primary-hover-bg);
    box-shadow: var(--btn-primary-hover-shadow);
  }
}
</style>
