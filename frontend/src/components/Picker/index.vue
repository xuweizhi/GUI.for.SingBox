<script setup lang="ts" generic="ValueType = any, PickerType extends 'single' | 'multi' = 'single'">
import { computed, onMounted, onUnmounted, ref, toRaw, type Ref } from 'vue'

import useI18n from '@/lang'

export type PickerItem<T> = {
  label: string
  value: T
  description?: string
  background?: string
  onSelect?: (args: {
    value: PickerItem<T>['value']
    option: PickerItem<T>
    options: PickerItem<T>[]
    selected: PickerItem<T>['value'][]
  }) => void
}

interface Props<T, K> {
  type: K
  title: string
  options?: PickerItem<T>[]
  initialValue?: T[]
}

const props = withDefaults(defineProps<Props<ValueType, PickerType>>(), {
  options: () => [],
  initialValue: () => [],
})

const emit = defineEmits<{
  confirm: [val: PickerType extends 'single' ? ValueType : ValueType[]]
  cancel: []
  finish: []
}>()

const selected = ref(
  new Set(
    props.initialValue.filter((v) => props.options.find((o) => o.value === v)).map((v) => toRaw(v)),
  ),
) as Ref<Set<ValueType>>

const query = ref('')
const { t } = useI18n.global

const filteredOptions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(
    (o) =>
      t(o.label).toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q),
  )
})

const handleConfirm = () => {
  const res: any = Array.from(selected.value).map((v) => toRaw(v))
  if (props.type === 'single') {
    emit('confirm', res[0])
  } else {
    emit('confirm', res)
  }
  emit('finish')
}

const handleCancel = () => {
  emit('cancel')
  emit('finish')
}

const isSelected = (option: ValueType) => selected.value.has(option)

const handleSelect = (option: PickerItem<ValueType>) => {
  if (isSelected(option.value)) {
    selected.value.delete(option.value)
  } else {
    if (props.type === 'single') selected.value.clear()
    selected.value.add(option.value)
    option.onSelect?.({
      value: option.value,
      option,
      options: props.options,
      selected: Array.from(selected.value).map((v) => toRaw(v)),
    })
  }
}

const handleSelectAll = () => {
  if (filteredOptions.value.some((v) => !selected.value.has(v.value))) {
    filteredOptions.value.forEach((v) => selected.value.add(v.value))
  } else {
    filteredOptions.value.forEach((v) => selected.value.delete(v.value))
  }
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    e.preventDefault()
    handleCancel()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div
    class="gui-overlay-mask fixed inset-0 flex items-center justify-center p-16 backdrop-blur-sm"
    @click.self="handleCancel"
  >
    <Transition name="dialog-pop" appear>
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="t(title)"
        class="gui-picker flex flex-col rounded-12"
      >
        <div class="gui-picker__header font-bold text-16 px-16 py-12">{{ t(title) }}</div>

        <div v-if="options.length > 8" class="px-16 pt-12">
          <Input
            v-model="query"
            size="small"
            clearable
            :placeholder="t('common.search')"
            class="w-full"
          />
        </div>

        <div class="flex-1 overflow-auto px-16 py-12 flex flex-col gap-6">
          <Empty v-if="filteredOptions.length === 0" :icon-size="42" />
          <div
            v-for="(o, i) in filteredOptions"
            :key="i"
            role="option"
            tabindex="0"
            :aria-selected="isSelected(o.value)"
            :style="{ background: o.background }"
            :class="{ 'is-selected': isSelected(o.value) }"
            class="item py-8 px-12 break-all rounded-8 cursor-pointer"
            @click="handleSelect(o)"
            @keydown.enter.prevent="handleSelect(o)"
            @keydown.space.prevent="handleSelect(o)"
          >
            <div class="flex items-center justify-between gap-8 leading-relaxed">
              <div class="font-bold">{{ t(o.label) }}</div>
              <Icon
                v-show="isSelected(o.value)"
                :size="18"
                icon="selected"
                color="var(--accent-text)"
                class="shrink-0"
              />
            </div>
            <div v-if="o.description" class="text-12 leading-relaxed text-muted mt-2">
              {{ o.description }}
            </div>
          </div>
        </div>

        <div class="gui-picker__footer flex items-center gap-8 px-16 py-12">
          <Button v-if="type === 'multi'" type="text" size="small" @click="handleSelectAll">
            {{ t('common.selectAll') }}
          </Button>
          <span class="text-12 text-muted mr-auto">
            {{ selected.size }} / {{ options.length }}
          </span>
          <Button size="small" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button size="small" type="primary" @click="handleConfirm">
            {{ t('common.confirm') }}
          </Button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="less" scoped>
.gui-overlay-mask {
  z-index: 99999;
  background: var(--modal-mask-bg);
}

.gui-picker {
  width: min(520px, 100%);
  max-height: min(76dvh, 640px);
  background: var(--modal-bg);
  color: var(--color);
  border: 1px solid var(--border-color);
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.24);
  overflow: hidden;

  .item {
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    transition:
      border-color 0.14s ease,
      background-color 0.14s ease;

    &:hover {
      border-color: color-mix(in srgb, var(--accent-text) 50%, var(--border-color));
      background: var(--card-hover-bg);
    }

    &.is-selected {
      border-color: var(--accent-text);
      background: var(--accent-soft);
    }
  }
}

.gui-picker__header {
  border-bottom: 1px solid var(--border-color);
}

.gui-picker__footer {
  border-top: 1px solid var(--border-color);
}

.dialog-pop-enter-active,
.dialog-pop-leave-active {
  transition:
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.16s ease;
}

.dialog-pop-enter-from,
.dialog-pop-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
