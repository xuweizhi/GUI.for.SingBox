<script setup lang="ts">
import { computed, useAttrs, useSlots } from 'vue'

import vTips from '@/directives/tips'

interface Props {
  title?: string
  subtitle?: string
  selected?: boolean
  disabled?: boolean
  interactive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  subtitle: undefined,
  selected: false,
  disabled: false,
  interactive: false,
})

const slots = useSlots()
const attrs = useAttrs()

const hasTitle = computed(() => {
  return slots.extra || slots['title-prefix'] || slots['title-suffix'] || props.title
})

const isInteractive = computed(() => {
  if (props.interactive) return true
  const className = typeof attrs.class === 'string' ? attrs.class : ''
  return (
    Boolean(attrs.onClick || attrs.onDblclick) ||
    attrs.role === 'button' ||
    className.includes('cursor-pointer')
  )
})
</script>

<template>
  <div
    :class="{
      'is-selected': selected,
      'is-disabled': disabled,
      'is-interactive': isInteractive,
    }"
    class="gui-card rounded-8 relative flex flex-col"
  >
    <div v-if="hasTitle" class="gui-card__header card-header flex items-center break-all">
      <slot name="title-prefix"></slot>
      <div
        v-if="title"
        v-tips="title"
        class="gui-card__title card-header_title line-clamp-1 text-16 font-bold"
      >
        {{ title }}
      </div>
      <slot name="title-suffix"></slot>
      <div class="card-header_extra flex items-center ml-auto shrink-0 gap-4">
        <Tag v-if="disabled" size="small" color="default">{{ $t('common.disabled') }}</Tag>
        <slot name="extra"></slot>
      </div>
    </div>
    <div v-if="subtitle" class="card-header_subtitle px-16 pb-4 text-12 text-muted">
      {{ $t(subtitle) }}
    </div>
    <div class="gui-card__body flex-1" :class="{ 'has-title': hasTitle }">
      <slot></slot>
    </div>
    <span
      v-if="selected"
      class="gui-card__state--selected"
      aria-hidden="true"
    >
      <Icon :size="14" icon="selected" color="var(--btn-primary-color)" />
    </span>
  </div>
</template>

<style lang="less" scoped>
.gui-card {
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  color: var(--card-color);
  background-color: var(--card-bg);
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease;

  &.is-interactive {
    cursor: pointer;
    &:hover {
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
      border-color: color-mix(in srgb, var(--accent-text) 45%, var(--border-color));
      background-color: var(--card-hover-bg);
    }
    &:active {
      background-color: var(--card-active-bg);
    }
  }

  &-header {
    &_title {
      color: var(--card-color);
    }
  }

  &.is-selected {
    border-color: var(--accent-text);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-text) 28%, transparent);
  }

  &.is-disabled {
    opacity: 0.72;
  }
}
.gui-card__header {
  padding: 14px 16px 10px;
  gap: 6px;
}
.gui-card__title {
  min-width: 0;
}
.gui-card__body {
  min-width: 0;
  padding: 0 16px;
}
.gui-card__body.has-title {
  padding-bottom: 16px;
}
.gui-card__state--selected {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--primary-color);
  pointer-events: none;
}
</style>
