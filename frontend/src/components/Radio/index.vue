<script setup lang="ts">
import { useI18n } from 'vue-i18n'

interface Props {
  options?: readonly { readonly label: string; readonly value: string | number | boolean }[]
  size?: 'default' | 'small'
}

const model = defineModel<string | number | boolean>()

withDefaults(defineProps<Props>(), {
  options: () => [],
  size: 'default',
})

const emits = defineEmits(['change'])

const { t } = useI18n()

const handleSelect = (val: string | number | boolean) => {
  const oldValue = model.value
  if (oldValue === val) {
    return
  }
  model.value = val
  emits('change', val, oldValue)
}
</script>

<template>
  <div role="radiogroup" :class="[size]" class="gui-radio inline-flex text-12">
    <button
      v-for="o in options"
      :key="o.value.toString()"
      v-tips.slow="o.label"
      type="button"
      role="radio"
      :aria-checked="o.value === model"
      :aria-pressed="o.value === model"
      :class="{ active: o.value === model }"
      class="gui-radio-button cursor-pointer px-12 py-6 duration-200"
      @click="handleSelect(o.value)"
    >
      {{ t(o.label) }}
    </button>
  </div>
</template>

<style lang="less" scoped>
.gui-radio {
  max-width: 100%;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border-radius: var(--control-radius, 8px);
  background: color-mix(in srgb, var(--bg-color) 76%, var(--surface-bg));
  border: 1px solid var(--surface-border, var(--border-color));
  &-button {
    color: var(--radio-normal-color);
    background-color: var(--radio-normal-bg);
    flex-shrink: 0;
    border: 0;
    border-radius: max(3px, calc(var(--control-radius, 8px) - 3px));
    white-space: nowrap;
    font-weight: 500;
    transition:
      color 0.16s ease,
      background-color 0.16s ease,
      box-shadow 0.18s ease;
    &:hover {
      color: var(--radio-normal-hover-color);
    }
  }
  .active {
    color: var(--radio-primary-color);
    background-color: var(--radio-primary-bg);
    background-image: var(--btn-primary-bg-image);
    box-shadow: var(--active-indicator-shadow);
    &:hover {
      color: var(--radio-primary-color);
      background-color: var(--radio-primary-hover-bg);
    }
    &:active {
      background-color: var(--radio-primary-active-bg);
    }
  }
}

.small {
  .gui-radio-button {
    font-size: 12px;
    padding: 4px 8px;
  }
}
</style>
