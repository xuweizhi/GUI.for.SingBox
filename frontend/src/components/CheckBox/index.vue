<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  modelValue?: string[]
  options?: { label: string; value: string }[]
  size?: 'default' | 'small'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  options: () => [],
  size: 'default',
})

const emit = defineEmits(['change', 'update:modelValue'])

const model = ref<string[]>([...props.modelValue])
const { t } = useI18n()

let internalUpdate = false

watch(
  () => props.modelValue,
  (newVal) => {
    if (!internalUpdate) {
      model.value = [...newVal]
    }
    internalUpdate = false
  },
  {
    deep: true,
  },
)

const isActive = (val: string) => model.value.includes(val)

const handleSelect = (val: string) => {
  const idx = model.value.findIndex((v) => v === val)
  if (idx !== -1) {
    model.value.splice(idx, 1)
  } else {
    model.value.push(val)
  }
  internalUpdate = true
  emit('update:modelValue', [...model.value])
  emit('change', [...model.value])
}
</script>

<template>
  <div :class="[size]" class="gui-checkbox inline-flex rounded-8 text-12">
    <button
      v-for="o in props.options"
      :key="o.value"
      type="button"
      :aria-pressed="isActive(o.value)"
      :class="{ active: isActive(o.value) }"
      class="gui-checkbox-button cursor-pointer px-12 py-6 transition duration-200"
      @click="handleSelect(o.value)"
    >
      {{ t(o.label) }}
    </button>
  </div>
</template>

<style lang="less" scoped>
.gui-checkbox {
  max-width: 100%;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  &-button {
    color: var(--radio-normal-color);
    background-color: var(--radio-normal-bg);
    flex-shrink: 0;
    border: 0;
    border-radius: 5px;
    white-space: nowrap;
    &:nth-child(1) {
      border-left: none;
    }
    &:hover {
      color: var(--radio-normal-hover-color);
    }
  }
  .active {
    color: var(--radio-primary-color);
    background-color: var(--radio-primary-bg);
    &:hover {
      background-color: var(--radio-primary-hover-bg);
    }
    &:active {
      background-color: var(--radio-primary-active-bg);
    }
  }
}

.small {
  .gui-checkbox-button {
    font-size: 10px;
    padding: 4px 8px;
  }
}
</style>
