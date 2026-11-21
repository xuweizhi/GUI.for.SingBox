<script setup lang="ts">
import { type IconName } from '@/components/Icon/icons'

interface Props {
  type?: 'primary' | 'normal' | 'danger' | 'link' | 'text'
  size?: 'default' | 'small' | 'large'
  iconSize?: number
  iconColor?: string
  icon?: IconName
  loading?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  type: 'normal',
  size: 'default',
  iconSize: undefined,
  iconColor: undefined,
  icon: undefined,
  loading: false,
  disabled: false,
})

const handleKeydown = (event: KeyboardEvent) => {
  if (props.disabled || props.loading) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).click()
}
</script>

<template>
  <div
    role="button"
    :tabindex="disabled || loading ? -1 : 0"
    :aria-disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="[
      type,
      size,
      {
        'is-disabled': disabled,
        'is-loading': loading,
        'pointer-events-none': disabled || loading,
      },
    ]"
    class="gui-button inline-flex items-center justify-center text-center align-middle rounded-6 text-14 text-nowrap cursor-pointer px-12 py-6 duration-200"
    @keydown="handleKeydown"
  >
    <Icon
      v-if="loading"
      color="currentColor"
      :size="size === 'small' ? 14 : 16"
      icon="loading"
      :class="$slots.default ? 'mr-4' : ''"
      class="rotation shrink-0"
    />
    <Icon
      v-else-if="icon"
      :icon="icon"
      :size="iconSize"
      :color="iconColor || 'currentColor'"
      :class="$slots.default ? 'mr-4' : ''"
      class="shrink-0"
    />
    <slot></slot>
  </div>
</template>

<style lang="less" scoped>
.gui-button {
  line-height: 1.4;
  font-weight: 500;
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease,
    opacity 0.16s ease;
}

.is-disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.is-loading {
  opacity: 0.78;
}

.normal {
  color: var(--btn-normal-color);
  background-color: var(--btn-normal-bg);
  border: 1px solid var(--btn-normal-border-color);
  &:hover {
    color: var(--btn-normal-hover-color);
    background-color: var(--btn-normal-hover-bg);
    border-color: var(--btn-normal-hover-border-color);
  }
  &:active {
    color: var(--btn-normal-active-color);
    border-color: var(--btn-normal-active-border-color);
  }
}

.primary {
  color: var(--btn-primary-color);
  background-color: var(--btn-primary-bg);
  border: 1px solid transparent;
  &:hover {
    background-color: var(--btn-primary-hover-bg);
  }
  &:active {
    background-color: var(--btn-primary-active-bg);
  }
}

.danger {
  color: var(--btn-danger-color);
  background-color: var(--btn-danger-bg);
  border: 1px solid transparent;
  &:hover {
    background-color: var(--btn-danger-hover-bg);
  }
  &:active {
    background-color: var(--btn-danger-active-bg);
  }
}

.link {
  color: var(--btn-link-color);
  background-color: var(--btn-link-bg);
  border: 1px solid transparent;
  &:hover {
    color: var(--btn-link-hover-color);
  }
  &:active {
    color: var(--btn-link-active-color);
  }
}

.text {
  color: var(--btn-text-color);
  background-color: var(--btn-text-bg);
  border: 1px solid transparent;
  &:hover {
    color: var(--btn-text-hover-color);
    background-color: var(--btn-text-hover-bg);
  }
  &:active {
    color: var(--btn-text-active-color);
    background-color: var(--btn-text-active-bg);
  }
}

.small {
  padding: 4px 8px;
  font-size: 12px;
}
.large {
  padding: 8px 16px;
  font-size: 16px;
}
</style>
