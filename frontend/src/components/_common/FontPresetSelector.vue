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
let editingFont = false
const fontFamily = computed({
  get: () => appSettings.app.fontFamily,
  set: (value: string) => {
    editingFont = true
    appSettings.app.fontFamily = value
    editingFont = false
  },
})
watch(
  matchedFontPreset,
  (key) => {
    if (!editingFont) isCustomFont.value = key === 'custom'
  },
  { flush: 'sync' },
)

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
const options = computed(() => [
  ...FontPresetOptions.map(({ key, label }) => ({ label, value: key })),
  ...customPresets.value.map((preset) => ({ label: preset.label, value: 'preset:' + preset.id })),
  { label: 'settings.font.custom', value: 'custom' },
])
const selectFont = (key: string) => {
  if (key === 'custom') return selectCustomFont()
  const family =
    FontPresetOptions.find((option) => option.key === key)?.value ??
    customPresets.value.find((preset) => 'preset:' + preset.id === key)?.fontFamily
  if (family) selectFontPreset(family)
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex flex-wrap gap-6 items-center">
      <Select
        class="font-select flex-1"
        auto-size
        :model-value="activeFontKey"
        :options="options"
        @change="selectFont"
      />
      <Button
        class="font-add"
        size="small"
        :disabled="atLimit && !creatorOpen"
        :aria-expanded="creatorOpen"
        :title="
          atLimit
            ? t('settings.font.presetLimitTip', [MaxCustomFontPresets])
            : t('settings.font.addPresetTip')
        "
        @click="toggleCreator"
        >{{ t('settings.font.addPreset') }}</Button
      >
    </div>
    <div v-if="activeFontKey === 'custom'" class="flex flex-wrap gap-6">
      <Input
        v-model="fontFamily"
        class="flex-1"
        :label="t('settings.font.customInputAria')"
        :placeholder="t('settings.font.customPlaceholder')"
        clearable
      >
        <template #suffix
          ><Button
            type="text"
            size="small"
            icon="reset"
            :aria-label="t('settings.resetFont')"
            @click="resetFontFamily"
        /></template>
      </Input>
      <Button
        v-if="!atLimit && fontFamily.trim()"
        class="font-save-preset-btn"
        size="small"
        @click="openCreator(fontFamily.trim())"
        >{{ t('settings.font.saveAsPreset') }}</Button
      >
    </div>
    <div
      v-if="customPresets.length"
      class="font-preset-list flex flex-col gap-4"
      :class="{ 'is-compact': !isSettings }"
    >
      <div
        v-for="preset in customPresets"
        :key="preset.id"
        class="flex gap-6 items-center text-12 text-secondary"
      >
        <button
          type="button"
          class="font-preset-item__btn"
          :class="{ 'is-active': activeFontKey === 'preset:' + preset.id }"
          :style="{ fontFamily: preset.fontFamily }"
          @click="selectFontPreset(preset.fontFamily)"
        >
          {{ preset.label }}
        </button>
        <span v-if="preset.stylesheetUrl" class="text-muted">{{ t('settings.font.webFont') }}</span>
        <Button
          type="text"
          size="small"
          icon="delete"
          class="font-remove ml-auto"
          :aria-label="t('settings.font.deletePreset', [preset.label])"
          @click="removePreset(preset)"
        />
      </div>
    </div>
    <form
      v-if="creatorOpen"
      class="font-preset-creator surface-inset p-10 flex flex-col gap-8"
      @submit.prevent="submitPreset"
    >
      <strong>{{ t('settings.font.creatorTitle') }}</strong>
      <label class="flex flex-col gap-4"
        >{{ t('settings.font.presetName') }}
        <Input
          v-model="draftLabel"
          class="font-creator-input w-full"
          :label="t('settings.font.presetNameAria')"
          :placeholder="t('settings.font.presetNamePlaceholder')"
          @update:model-value="clearError"
          @keydown.enter.prevent="submitPreset"
        />
      </label>
      <label class="flex flex-col gap-4"
        >{{ t('settings.font.presetFamily') }}
        <Input
          v-model="draftFamily"
          class="font-creator-input w-full"
          :label="t('settings.font.presetFamilyAria')"
          :placeholder="t('settings.font.presetFamilyPlaceholder')"
          @update:model-value="clearError"
          @keydown.enter.prevent="submitPreset"
        />
      </label>
      <label class="flex flex-col gap-4"
        >{{ t('settings.font.presetUrl') }}
        <Input
          v-model="draftUrl"
          class="font-creator-input w-full"
          :label="t('settings.font.presetUrlAria')"
          :placeholder="t('settings.font.presetUrlPlaceholder')"
          @update:model-value="clearError"
          @keydown.enter.prevent="submitPreset"
        />
      </label>
      <div class="font-preset-preview" :style="{ fontFamily: draftFamily.trim() || fontFamily }">
        {{ t('settings.font.previewSample') }}
      </div>
      <div v-if="draftError" class="font-preset-error" role="alert">{{ draftError }}</div>
      <div class="flex gap-6">
        <Button class="font-cancel" @click="closeCreator">{{ t('common.cancel') }}</Button>
        <Button type="primary" class="font-submit" @click="submitPreset">
          {{ t('settings.font.saveAndApply') }}
        </Button>
      </div>
    </form>
    <span
      v-if="isSettings && !creatorOpen"
      :style="{ fontFamily }"
      class="text-secondary text-13"
      >{{ t('settings.font.previewSample') }}</span
    >
  </div>
</template>
<style scoped>
.font-preset-error {
  color: var(--danger-color);
}
.font-preset-item__btn {
  padding: 2px 6px;
  border: 0;
  border-radius: var(--control-radius, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.font-preset-item__btn:hover,
.font-preset-item__btn.is-active {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.font-preset-list.is-compact {
  max-height: 120px;
  overflow-y: auto;
}
.font-select {
  min-width: 8em;
}
</style>
