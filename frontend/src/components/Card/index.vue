<script setup lang="ts">
import { computed, useSlots } from 'vue'

import vTips from '@/directives/tips'

interface Props {
  title?: string
  subtitle?: string
  selected?: boolean
  disabled?: boolean
}

const props = defineProps<Props>()

const slots = useSlots()

const hasTitle = computed(() => {
  return slots.extra || slots['title-prefix'] || slots['title-suffix'] || props.title
})
</script>

<template>
  <div :class="{ 'is-selected': selected }" class="gui-card rounded-8 relative flex flex-col">
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
      <div class="card-header_extra flex items-center ml-auto shrink-0">
        <slot name="extra"></slot>
      </div>
    </div>
    <div v-if="subtitle" class="card-header_subtitle mx-8">
      {{ $t(subtitle) }}
    </div>
    <div class="gui-card__body flex-1" :class="{ 'has-title': hasTitle }">
      <slot></slot>
    </div>
    <Icon
      v-if="selected"
      :size="24"
      icon="selected"
      color="var(--primary-color)"
      class="gui-card__state--selected absolute right-8 bottom-4"
    />
    <Icon
      v-if="disabled"
      :size="32"
      icon="disabled"
      color="var(--primary-color)"
      class="absolute right-8 bottom-4"
    />
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
    box-shadow 0.2s,
    background 0.2s;
  &:hover {
    box-shadow: 0 3px 12px rgba(20, 40, 70, 0.05);
    background-color: var(--card-hover-bg);
  }
  &:active {
    background-color: var(--card-active-bg);
  }
  &-header {
    &_title {
      color: var(--card-color);
    }
  }
  &.is-selected {
    border-color: var(--accent-text);
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
</style>
