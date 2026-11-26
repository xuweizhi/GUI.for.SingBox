<script setup lang="ts">
import { computed, useAttrs, useSlots } from 'vue'

import vTips from '@/directives/tips'

interface Props {
  title?: string
  subtitle?: string
  selected?: boolean
  disabled?: boolean
  flush?: boolean
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
    :tabindex="attrs.onClick && !disabled ? 0 : undefined"
    :role="attrs.onClick && !attrs.role ? 'button' : undefined"
    :aria-disabled="disabled || undefined"
    :class="{
      'is-selected': selected,
      'is-flush': flush,
      'is-disabled': disabled,
      'is-interactive': isInteractive && !disabled,
    }"
    class="gui-card relative flex flex-col"
    @click.capture="disabled && attrs.onClick && $event.stopImmediatePropagation()"
    @keydown.enter.self="
      attrs.onClick && !disabled && ($event.currentTarget as HTMLElement).click()
    "
    @keydown.space.self="
      attrs.onClick &&
      !disabled &&
      ($event.preventDefault(), ($event.currentTarget as HTMLElement).click())
    "
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
    <div v-if="subtitle" class="card-header_subtitle pb-4 text-12 text-muted">
      {{ $t(subtitle) }}
    </div>
    <div class="gui-card__body flex-1" :class="{ 'has-title': hasTitle }">
      <slot></slot>
    </div>
  </div>
</template>

<style lang="less" scoped>
.gui-card {
  min-width: 0;
  border: 1px solid var(--surface-border, var(--border-color));
  border-radius: var(--card-radius, 12px);
  color: var(--card-color);
  background-color: var(--surface-bg, var(--card-bg));
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease,
    transform 0.18s ease;

  &.is-interactive {
    cursor: pointer;
    &:hover {
      box-shadow: var(--card-hover-shadow);
      border-color: color-mix(in srgb, var(--accent-text) 52%, var(--surface-border));
      background-color: var(--surface-hover-bg, var(--card-hover-bg));
      transform: translateY(var(--card-hover-lift, 0px));
    }
    &:active {
      background-color: var(--surface-active-bg, var(--card-active-bg));
      transform: translateY(0);
    }
  }

  &-header {
    &_title {
      color: var(--card-color);
    }
  }

  &.is-selected {
    border-color: var(--accent-text);
    box-shadow: var(--card-selected-shadow);
  }

  &.is-disabled {
    opacity: 0.72;
  }
}
.gui-card__header {
  padding: var(--card-pad-y, 14px) var(--card-pad-x, 16px) 10px;
  gap: 6px;
}
.card-header_subtitle {
  padding-left: var(--card-pad-x, 16px);
  padding-right: var(--card-pad-x, 16px);
}
.gui-card__title {
  min-width: 0;
}
.gui-card__body {
  min-width: 0;
  padding: 0 var(--card-pad-x, 16px);
}
.gui-card__body.has-title {
  padding-bottom: var(--card-pad-y, 14px);
}
.gui-card__body:not(.has-title) {
  padding-block: var(--card-pad-y);
}
.is-flush > .gui-card__body {
  padding: 0;
}
.is-selected::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inset-block: 8px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent-text);
  pointer-events: none;
}
</style>
