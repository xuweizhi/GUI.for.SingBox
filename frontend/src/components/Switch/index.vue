<script setup lang="ts">
import { nextTick } from 'vue'

import i18n from '@/lang'

interface Props {
  size?: 'default' | 'small'
  border?: 'default' | 'square'
  label?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'default',
  border: 'default',
  label: '',
  disabled: false,
})

const model = defineModel<boolean>({ default: false })

const emits = defineEmits<{
  (e: 'change', val: boolean): void
}>()

const { t } = i18n.global

const toggle = () => {
  if (props.disabled) return
  model.value = !model.value
  nextTick(() => emits('change', model.value))
}
</script>

<template>
  <div
    v-tips.slow="label"
    role="switch"
    :tabindex="disabled ? -1 : 0"
    :aria-checked="model"
    :aria-disabled="disabled"
    :class="[
      size,
      border,
      model ? 'on' : 'off',
      border === 'square' ? 'rounded-4' : 'rounded-full',
      { 'cursor-not-allowed is-disabled': disabled },
    ]"
    class="gui-switch relative cursor-pointer h-24 inline-flex items-center text-12 duration-200"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <div
      :class="[border === 'square' ? 'rounded-4' : 'rounded-full']"
      class="dot absolute h-18 w-18 duration-200"
    ></div>

    <div v-if="$slots.default || label" class="slot line-clamp-1 break-all">
      <span v-if="label">{{ t(label) }}</span>
      <slot v-if="$slots.default"></slot>
    </div>
  </div>
</template>

<style lang="less" scoped>
.gui-switch {
  min-width: 50px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    opacity 0.2s ease;
  &.is-disabled {
    opacity: 0.55;
  }
}

.small {
  height: 20px;
  .dot {
    width: 12px;
    height: 12px;
  }
}

.square {
  .dot {
    width: 4px;
  }
}

.on {
  color: #fff;
  background-color: var(--switch-on-bg);
  border: 1px solid transparent;
  &:hover {
    background-color: var(--switch-on-hover-bg);
  }
  .dot {
    left: calc(100% - 22px);
    background-color: var(--switch-on-dot-bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .slot {
    margin-right: 26px;
    margin-left: 10px;
  }

  &.small {
    .dot {
      left: calc(100% - 16px);
    }
    .slot {
      margin-right: 20px;
      margin-left: 8px;
    }
  }

  &.square {
    .dot {
      left: calc(100% - 8px);
    }
    .slot {
      margin-right: 12px;
      margin-left: 8px;
    }
  }
}

.off {
  color: var(--card-color);
  background-color: var(--switch-off-bg);
  border: 1px solid var(--border-color);
  &:hover {
    background-color: var(--switch-off-hover-bg);
  }
  .dot {
    left: 3px;
    background-color: var(--switch-off-dot-bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
  }

  .slot {
    margin-left: 26px;
    margin-right: 10px;
  }

  &.small {
    .dot {
      left: 3px;
    }
    .slot {
      margin-left: 20px;
      margin-right: 8px;
    }
  }

  &.square {
    .slot {
      margin-left: 12px;
      margin-right: 8px;
    }
  }
}
</style>
