<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import { ClipboardGetText } from '@/bridge'
import useI18n from '@/lang'
import { debounce, message } from '@/utils'

export interface Props {
  modelModifiers?: { lazy?: boolean }
  modelValue?: string | number | undefined
  autoSize?: boolean
  placeholder?: string
  type?: 'number' | 'text' | 'code' | 'password'
  lang?: 'yaml' | 'json' | 'javascript'
  size?: 'default' | 'small'
  editable?: boolean
  submitOnEnter?: boolean
  clearable?: boolean
  allowPaste?: boolean
  autofocus?: boolean
  min?: number
  max?: number
  maxWidth?: boolean
  disabled?: boolean
  border?: boolean
  delay?: number
  autocomplete?: string
  inputId?: string
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelModifiers: undefined,
  autocomplete: 'off',
  modelValue: '',
  autoSize: false,
  placeholder: undefined,
  type: 'text',
  lang: 'javascript',
  size: 'default',
  editable: false,
  autofocus: false,
  allowPaste: false,
  min: undefined,
  max: undefined,
  maxWidth: true,
  clearable: false,
  disabled: false,
  border: true,
  delay: 0,
  inputId: undefined,
  label: undefined,
})

const emits = defineEmits(['change', 'update:modelValue', 'submit'])

const showEdit = ref(false)
const showPassword = ref(false)
const draftValue = ref(props.modelValue === undefined ? '' : String(props.modelValue))
const isFocused = ref(false)
const inputRef = useTemplateRef('inputRef')
const innerClearable = computed(
  () => props.clearable && props.type !== 'code' && draftValue.value !== '' && !props.disabled,
)
const innerAllowPaste = computed(() => props.allowPaste && props.type !== 'code' && !props.disabled)
const canTogglePassword = computed(() => props.type === 'password' && !props.disabled)
const effectiveInputType = computed(() =>
  props.type === 'password' && showPassword.value ? 'text' : props.type,
)

const { t } = useI18n.global

watch(
  () => props.modelValue,
  (val) => {
    if (props.type !== 'number' || !isFocused.value) {
      draftValue.value = val === undefined || val === null ? '' : String(val)
    }
  },
)

const clampNumber = (val: string | number) => {
  const trimmed = String(val).trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '.') {
    return props.min !== undefined ? props.min : 0
  }
  let num = Number(trimmed)
  if (Number.isNaN(num)) {
    num = props.min !== undefined ? props.min : 0
  }
  const { min, max } = props
  if (min !== undefined && num < min) num = min
  if (max !== undefined && num > max) num = max
  return num
}

const emitInput = (rawVal: string) => {
  if (props.type === 'number') {
    const trimmed = rawVal.trim()
    if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) return
    const value = clampNumber(parsed)
    emits('update:modelValue', value)
    emits('change', value)
    return
  }
  emits('update:modelValue', rawVal)
  emits('change', rawVal)
}
const delayedInput = debounce(emitInput, props.delay)
let editRevision = 0
const cancelPending = () => {
  editRevision++
  delayedInput.cancel()
}
onUnmounted(cancelPending)

const onInput = (e: any) => {
  editRevision++
  const rawVal = String(e.target.value ?? '')
  draftValue.value = rawVal
  if (props.modelModifiers?.lazy) return
  if (props.delay) void delayedInput(rawVal)
  else emitInput(rawVal)
}

const handleClear = () => {
  cancelPending()
  if (props.type === 'number') {
    draftValue.value = ''
    const val = props.min !== undefined ? props.min : 0
    emits('update:modelValue', val)
    emits('change', val)
  } else {
    draftValue.value = ''
    emits('update:modelValue', '')
    emits('change', '')
  }
  !props.editable && nextTick(() => inputRef.value?.focus())
}

const handlePaste = async () => {
  const revision = ++editRevision
  let text: string
  try {
    text = await ClipboardGetText()
  } catch {
    if (revision !== editRevision) return
    inputRef.value?.focus()
    inputRef.value?.select()
    message.info('common.pasteManually')
    return
  }
  if (revision !== editRevision) return
  delayedInput.cancel()
  const val = props.type === 'number' ? clampNumber(text) : text
  draftValue.value = String(val)
  emits('update:modelValue', val)
  emits('change', val)
}

const showInput = () => {
  if (props.disabled) return
  if (props.type === 'number') {
    draftValue.value = props.modelValue === undefined ? '' : String(props.modelValue)
  }
  showEdit.value = true
  nextTick(() => inputRef.value?.focus())
}

const onFocus = () => {
  isFocused.value = true
}

const onSubmit = (e: any) => {
  isFocused.value = false
  cancelPending()
  if (props.type === 'number') {
    const clamped = clampNumber(e.target.value)
    draftValue.value = String(clamped)
    e.target.value = clamped
    emits('update:modelValue', clamped)
    emits('change', clamped)
    emits('submit', clamped)
  } else {
    const val = e.target.value
    if ((props.modelModifiers?.lazy || props.delay) && val !== props.modelValue) emitInput(val)
    emits('submit', val)
  }
  props.editable && (showEdit.value = false)
}

const onKeydownEnter = () => {
  if (props.editable || props.submitOnEnter) {
    nextTick(() => inputRef.value?.blur())
  }
}

onMounted(() => props.autofocus && !props.editable && inputRef.value?.focus())

defineExpose({
  focus: () => inputRef.value?.focus(),
})
</script>

<template>
  <div
    v-bind="$attrs"
    :class="{
      border: border && type !== 'code' && (!editable || showEdit),
      'auto-size': autoSize,
      'bg-color': !editable || showEdit,
      'is-editable': editable && !showEdit,
      'no-max-width': !maxWidth,
      [size]: true,
      disabled,
    }"
    :style="{
      minHeight: type === 'code' ? '' : size === 'small' ? '30px' : '36px',
    }"
    class="gui-input inline-flex items-center px-8"
  >
    <div v-if="$slots.prefix" class="flex items-center shrink-0 mr-4">
      <slot name="prefix" v-bind="{ showInput }"></slot>
    </div>
    <div
      v-if="editable && !showEdit"
      role="button"
      :tabindex="disabled ? -1 : 0"
      class="gui-input__editable w-full flex items-center gap-4 overflow-hidden"
      :class="{ 'italic text-muted pr-4': !modelValue }"
      @click="showInput"
      @keydown.enter.prevent="showInput"
      @keydown.space.prevent="showInput"
    >
      <span class="overflow-hidden whitespace-nowrap text-ellipsis flex-1 min-w-0">
        <slot name="editable" v-bind="{ value: modelValue }">
          {{ modelValue || t(placeholder || 'common.none') }}
        </slot>
      </span>
      <Icon
        v-if="!disabled && !$slots.editable"
        icon="edit"
        :size="12"
        color="var(--muted-color)"
        class="gui-input__edit-icon shrink-0"
      />
    </div>
    <template v-else>
      <CodeEditor
        v-if="type === 'code'"
        :model-value="String(modelValue ?? '')"
        :lang="lang"
        :editable="!disabled"
        :placeholder="placeholder"
        :toolbar="false"
        plain
        class="code w-full overflow-y-auto"
        @update:model-value="(value: string) => onInput({ target: { value } })"
      />
      <input
        v-else
        :id="inputId"
        ref="inputRef"
        :aria-label="label"
        :value="draftValue"
        :placeholder="placeholder"
        :type="effectiveInputType"
        :disabled="disabled"
        :autocomplete="autocomplete || 'off'"
        class="flex-1 inline-block py-6 outline-none border-0 bg-transparent w-0"
        @focus="onFocus"
        @input="onInput"
        @blur="onSubmit"
        @keydown.enter="onKeydownEnter"
        @keydown.esc.stop.prevent="inputRef?.blur"
      />
      <Button
        v-if="canTogglePassword"
        :icon="showPassword ? 'eyeOff' : 'preview'"
        :icon-size="14"
        :aria-label="showPassword ? t('common.hidePassword') : t('common.showPassword')"
        type="text"
        size="small"
        @mousedown.prevent
        @click="showPassword = !showPassword"
      />
      <Button
        v-if="innerClearable"
        icon="clear2"
        :aria-label="t('common.clear')"
        type="text"
        size="small"
        @mousedown.prevent
        @click="handleClear"
      />
      <Button
        v-if="innerAllowPaste"
        icon="paste"
        :aria-label="t('common.paste')"
        type="text"
        size="small"
        @mousedown.prevent
        @click="handlePaste"
      />
    </template>
    <div v-if="$slots.suffix" class="flex items-center shrink-0 ml-4">
      <slot name="suffix" v-bind="{ showInput }"></slot>
    </div>
  </div>
</template>

<style lang="less" scoped>
.gui-input {
  min-width: min(220px, 100%);
  max-width: 100%;
  border: 1px solid transparent;
  border-radius: var(--control-radius, 8px);
  cursor: text;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
  input {
    color: var(--input-color);
    &::placeholder {
      color: var(--muted-color);
      opacity: 0.78;
    }
  }
  .code {
    max-height: 300px;
  }
}

.bg-color {
  background: var(--input-bg);
}

.is-editable {
  min-width: 0;
  cursor: pointer;
  border-bottom: 1px dashed var(--border-color);
  border-radius: 4px;
  padding-left: 6px;
  padding-right: 6px;
  &:hover {
    background: var(--btn-text-hover-bg);
    border-bottom-color: var(--accent-text);
    .gui-input__edit-icon {
      opacity: 1;
    }
  }
}

.gui-input__edit-icon {
  opacity: 0.45;
  transition: opacity 0.16s ease;
}

.is-editable:not(.no-max-width) {
  max-width: 240px;
}

.auto-size {
  min-width: 0 !important;
}

.disabled {
  opacity: 0.56;
  cursor: not-allowed;
  input {
    cursor: not-allowed;
  }
}

.border {
  border: 1px solid var(--border-color);
  &:focus-within {
    border-color: var(--accent-text);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
}

@media (max-width: 640px) {
  .gui-input:not(.auto-size) {
    min-width: 0;
    width: 100%;
  }
  .gui-input input {
    font-size: 16px;
  }
}

.small {
  input {
    font-size: calc(12px * var(--font-scale, 1));
  }
}
</style>
