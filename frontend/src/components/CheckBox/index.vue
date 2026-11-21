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
  <div role="group" :class="[size]" class="gui-checkbox inline-flex text-12">
    <button
      v-for="o in props.options"
      :key="o.value"
      type="button"
      role="checkbox"
      :aria-checked="isActive(o.value)"
      :aria-pressed="isActive(o.value)"
      :class="{ active: isActive(o.value) }"
      class="gui-checkbox-button cursor-pointer inline-flex items-center gap-6 px-10 py-6 transition duration-200"
      @click="handleSelect(o.value)"
    >
      <span class="gui-checkbox-box" aria-hidden="true">
        <Icon v-if="isActive(o.value)" icon="selected" :size="12" color="var(--btn-primary-color)" />
      </span>
      <span>{{ t(o.label) }}</span>
    </button>
  </div>
</template>

<style lang="less" scoped>
.gui-checkbox {
  max-width: 100%;
  flex-wrap: wrap;
  gap: 6px;

  &-button {
    color: var(--color);
    background-color: var(--card-bg);
    flex-shrink: 0;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    white-space: nowrap;
    font-weight: 500;
    &:hover {
      border-color: color-mix(in srgb, var(--accent-text) 55%, var(--border-color));
      color: var(--accent-text);
    }
  }

  &-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 4px;
    border: 1.5px solid var(--border-color);
    background: var(--input-bg);
    flex-shrink: 0;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease;
  }

  .active {
    color: var(--accent-text);
    background-color: var(--accent-soft);
    border-color: var(--accent-text);
    .gui-checkbox-box {
      background-color: var(--primary-color);
      border-color: var(--primary-color);
    }
  }
}

.small {
  .gui-checkbox-button {
    font-size: 12px;
    padding: 4px 8px;
  }
}
</style>
