<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { deepClone } from '@/utils'

interface Props {
  modelValue?: string | string[]
  options?: { label: string; value: string }[]
  multiple?: boolean
  border?: boolean
  size?: 'default' | 'small'
  placeholder?: string
  autoSize?: boolean
  clearable?: boolean
  searchable?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  options: () => [],
  multiple: false,
  border: true,
  size: 'default',
  placeholder: '',
  autoSize: false,
  clearable: false,
  searchable: undefined,
  disabled: false,
})

const emit = defineEmits(['change', 'update:modelValue'])

const model = ref(props.multiple ? deepClone(props.modelValue || []) : props.modelValue)
const searchQuery = ref('')
const highlightedIndex = ref(-1)
const listboxRef = useTemplateRef<HTMLElement>('listboxRef')

const scrollHighlightedIntoView = () => {
  nextTick(() => {
    if (highlightedIndex.value < 0) return
    const items = listboxRef.value?.querySelectorAll<HTMLElement>('[role="option"]')
    items?.[highlightedIndex.value]?.scrollIntoView({ block: 'nearest' })
  })
}

const { t } = useI18n()

const innerClearable = computed(
  () =>
    !props.disabled &&
    props.clearable &&
    (props.multiple ? (model.value as string[]).length !== 0 : Boolean(model.value)),
)

const shouldShowSearch = computed(() =>
  props.searchable !== undefined ? props.searchable : props.options.length > 12,
)

const filteredOptions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(
    (o) => t(o.label).toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  )
})

const optionsValueLabelMapping = computed(() =>
  props.options.reduce((p, c) => {
    p[c.value] = c.label ?? c.value
    return p
  }, {} as Recordable),
)

const displayLabel = computed(() => {
  if (props.multiple) {
    const selected = model.value as string[]
    if (selected.length === 0) {
      return t(props.placeholder || 'common.none')
    }
    return selected.map((item) => t(optionsValueLabelMapping.value[item] ?? item)).join('、')
  }
  const label = props.options.find((v) => v.value === model.value)?.label ?? (model.value as string)
  return t(label || props.placeholder || 'common.none')
})

const isPlaceholder = computed(() => {
  if (props.multiple) return (model.value as string[]).length === 0
  return !model.value && model.value !== ''
    ? true
    : !props.options.some((v) => v.value === model.value) && !model.value
})

watch(
  () => props.modelValue,
  (val) => {
    model.value = props.multiple ? deepClone(val || []) : val
  },
  { deep: true },
)

const isSelected = (val: string) => {
  if (props.multiple) {
    return (model.value as string[]).includes(val)
  }
  return model.value === val
}

const handleSelect = (value: string) => {
  const oldModel = JSON.stringify(model.value)
  if (props.multiple) {
    if (!Array.isArray(model.value)) {
      model.value = []
    }
    const idx = model.value?.indexOf(value) ?? -1
    if (idx === -1) {
      ;(model.value as string[]).push(value)
    } else {
      ;(model.value as string[]).splice(idx, 1)
    }
    if (oldModel !== JSON.stringify(model.value)) {
      emit('update:modelValue', [...model.value])
      emit('change', [...model.value])
    }
  } else if (value !== model.value) {
    model.value = value
    emit('update:modelValue', model.value)
    emit('change', model.value)
  }
}

const handleClear = () => {
  if (props.multiple) {
    model.value = []
    emit('update:modelValue', [])
    emit('change', [])
  } else {
    model.value = ''
    emit('update:modelValue', '')
    emit('change', '')
  }
}

watch(filteredOptions, () => {
  highlightedIndex.value = -1
})

const onDropdownVisibilityChange = (visible: boolean) => {
  if (!visible) {
    searchQuery.value = ''
    highlightedIndex.value = -1
  }
}

const handleTriggerKeydown = (
  event: KeyboardEvent,
  controls: { toggle: () => void; close: () => void; open: () => void; show: boolean },
) => {
  if (props.disabled) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    if (controls.show && highlightedIndex.value >= 0 && filteredOptions.value[highlightedIndex.value]) {
      handleSelect(filteredOptions.value[highlightedIndex.value]!.value)
      if (!props.multiple) controls.close()
    } else {
      controls.toggle()
    }
    return
  }
  if (event.key === 'Escape' && controls.show) {
    event.preventDefault()
    event.stopPropagation()
    controls.close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!controls.show) {
      controls.open()
      highlightedIndex.value = 0
    } else if (filteredOptions.value.length) {
      highlightedIndex.value = (highlightedIndex.value + 1) % filteredOptions.value.length
    }
    scrollHighlightedIntoView()
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!controls.show) {
      controls.open()
      highlightedIndex.value = Math.max(0, filteredOptions.value.length - 1)
    } else if (filteredOptions.value.length) {
      highlightedIndex.value =
        (highlightedIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length
    }
    scrollHighlightedIntoView()
  }
}

const handleSearchKeydown = (event: KeyboardEvent, close: () => void) => {
  if (event.key === 'ArrowDown' && filteredOptions.value.length) {
    event.preventDefault()
    highlightedIndex.value = (highlightedIndex.value + 1) % filteredOptions.value.length
    scrollHighlightedIntoView()
    return
  }
  if (event.key === 'ArrowUp' && filteredOptions.value.length) {
    event.preventDefault()
    highlightedIndex.value =
      (highlightedIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length
    scrollHighlightedIntoView()
    return
  }
  if (event.key === 'Enter' && !event.isComposing && filteredOptions.value.length) {
    event.preventDefault()
    const target = filteredOptions.value[highlightedIndex.value >= 0 ? highlightedIndex.value : 0]
    if (target) {
      handleSelect(target.value)
      if (!props.multiple) close()
    }
  }
}
</script>

<template>
  <Dropdown
    :trigger="disabled ? [] : ['click']"
    :class="{ 'w-full': autoSize }"
    @update:show="onDropdownVisibilityChange"
  >
    <template #default="{ toggle, close, open, show }">
      <div
        role="combobox"
        :tabindex="disabled ? -1 : 0"
        aria-haspopup="listbox"
        :aria-expanded="show"
        :aria-disabled="disabled"
        :aria-label="displayLabel"
        :class="{
          border,
          [size]: true,
          'auto-size': autoSize,
          'is-open': show,
          'is-disabled': disabled,
          'min-h-30': size === 'small',
          'min-h-36': size === 'default',
        }"
        class="gui-select cursor-pointer inline-flex items-center min-w-128 px-8 gap-4"
        @keydown="handleTriggerKeydown($event, { toggle, close, open, show })"
      >
        <span class="line-clamp-1 break-all flex-1" :class="{ 'text-muted': isPlaceholder }">
          {{ displayLabel }}
        </span>
        <Button
          :icon="innerClearable ? 'close' : 'arrowDown'"
          :icon-size="14"
          :aria-label="innerClearable ? t('common.clear') : t('common.select')"
          tabindex="-1"
          type="text"
          size="small"
          class="ml-auto shrink-0"
          style="margin-right: -4px"
          @click.stop="
            () => {
              if (disabled) return
              if (innerClearable) {
                handleClear()
                close()
              } else {
                toggle()
              }
            }
          "
        />
      </div>
    </template>

    <template #overlay="{ close }">
      <div
        ref="listboxRef"
        role="listbox"
        :aria-multiselectable="multiple || undefined"
        class="gui-select__listbox flex flex-col gap-2 min-w-128 p-6"
      >
        <div v-if="shouldShowSearch" class="pb-4">
          <Input
            v-model="searchQuery"
            size="small"
            auto-size
            clearable
            :placeholder="t('common.search')"
            class="w-full"
            @keydown="handleSearchKeydown($event, close)"
          />
        </div>
        <slot v-if="filteredOptions.length === 0" name="empty">
          <Empty :icon-size="42" />
        </slot>
        <button
          v-for="(o, idx) in filteredOptions"
          :key="o.value"
          type="button"
          role="option"
          :aria-selected="isSelected(o.value)"
          :class="{
            'is-selected': isSelected(o.value),
            'is-highlighted': idx === highlightedIndex,
          }"
          class="gui-select__option"
          @mouseenter="highlightedIndex = idx"
          @click="
            () => {
              handleSelect(o.value)
              !props.multiple && close()
            }
          "
        >
          <span class="gui-select__option-check" aria-hidden="true">
            <Icon v-if="isSelected(o.value)" icon="selected" :size="15" color="currentColor" />
          </span>
          <span class="gui-select__option-label">{{ t(o.label) }}</span>
        </button>
      </div>
    </template>
  </Dropdown>
</template>

<style lang="less" scoped>
.gui-select {
  background: var(--select-bg);
  color: var(--input-color);
  border-radius: var(--control-radius, 8px);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.auto-size {
  width: 100%;
}

.border {
  border: 1px solid var(--border-color);
  &:hover:not(.is-disabled) {
    border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
  }
  &.is-open,
  &:focus-visible {
    border-color: var(--accent-text);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
}

.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.small {
  font-size: calc(12px * var(--font-scale, 1));
}

.gui-select__listbox {
  max-height: 280px;
  overflow-y: auto;
}

.gui-select__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color);
  font: inherit;
  font-size: calc(13px * var(--font-scale, 1));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;

  &:hover,
  &.is-highlighted {
    background: var(--btn-text-hover-bg);
  }

  &.is-selected {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
}

.gui-select__option-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.gui-select__option-label {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
</style>
