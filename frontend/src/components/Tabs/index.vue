<script setup lang="ts">
import { computed, useSlots, type Component } from 'vue'
import { useI18n } from 'vue-i18n'

type TabItemType = {
  key: string
  tab: string
  component?: Component
}

interface Props {
  activeKey: string
  items: readonly TabItemType[]
  tabPosition?: 'left' | 'top'
  tabWidth?: string
  contentWidth?: string
}

const props = withDefaults(defineProps<Props>(), {
  tabPosition: 'left',
  tabWidth: '20%',
  contentWidth: '80%',
})

const emits = defineEmits(['update:activeKey'])

const { t } = useI18n()
const slots = useSlots()

const isTop = computed(() => props.tabPosition === 'top')

const handleChange = (key: string) => emits('update:activeKey', key)

const handleTabKeydown = (event: KeyboardEvent, index: number) => {
  const count = props.items.length
  if (!count) return
  const prevKey = isTop.value ? 'ArrowLeft' : 'ArrowUp'
  const nextKey = isTop.value ? 'ArrowRight' : 'ArrowDown'
  let nextIndex = -1
  if (event.key === nextKey) nextIndex = (index + 1) % count
  else if (event.key === prevKey) nextIndex = (index - 1 + count) % count
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = count - 1
  if (nextIndex === -1) return
  event.preventDefault()
  const target = props.items[nextIndex]
  if (!target) return
  handleChange(target.key)
  const tablist = (event.currentTarget as HTMLElement | null)?.closest('[role="tablist"]')
  const buttons = tablist?.querySelectorAll<HTMLElement>('[role="tab"]')
  buttons?.[nextIndex]?.focus()
}

const isActive = ({ key }: TabItemType) => key === props.activeKey

// NOTE:
// - component tabs are cached via KeepAlive
// - slot tabs are rendered as functional components and NOT cached
const currentComponent = computed(() => {
  const comp = props.items.find((i) => i.key === props.activeKey)?.component
  return comp ?? slots[props.activeKey]
})
</script>

<template>
  <div :class="{ 'flex-col is-top': isTop, 'is-left': !isTop }" class="gui-tabs flex">
    <div
      :class="{
        'gui-tabs-rail--top mb-12 items-center gap-8': isTop,
        'gui-tabs-rail--left flex-col gap-4': !isTop,
      }"
      :style="{ width: isTop ? 'auto' : tabWidth }"
      class="gui-tabs-rail flex shrink-0"
    >
      <div
        role="tablist"
        :aria-orientation="isTop ? 'horizontal' : 'vertical'"
        :class="{ 'gui-tabs-tab--top': isTop, 'gui-tabs-tab--left flex-col': !isTop }"
        class="gui-tabs-tab flex gap-4"
      >
        <Button
          v-for="(tab, index) in items"
          :key="tab.key"
          role="tab"
          :aria-selected="isActive(tab)"
          :type="isActive(tab) ? 'link' : 'text'"
          :class="{ 'is-active': isActive(tab) }"
          class="gui-tabs-item"
          @click="handleChange(tab.key)"
          @keydown="handleTabKeydown($event, index)"
        >
          {{ t(tab.tab) }}
        </Button>
      </div>
      <div v-if="$slots.extra" class="gui-tabs-extra flex flex-col gap-4">
        <slot name="extra"></slot>
      </div>
    </div>

    <div
      role="tabpanel"
      class="gui-tabs-content flex flex-col overflow-y-auto"
      :style="{ width: isTop ? 'auto' : contentWidth }"
    >
      <KeepAlive>
        <component :is="currentComponent" />
      </KeepAlive>
    </div>
  </div>
</template>

<style lang="less" scoped>
.gui-tabs-tab--top {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 6px;
}

.gui-tabs-item {
  position: relative;
  &.is-active {
    background: var(--accent-soft);
    font-weight: 600;
  }
}

.gui-tabs-tab--left .gui-tabs-item {
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  &.is-active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 999px;
    background: var(--accent-text);
  }
}

.gui-tabs-tab--top .gui-tabs-item.is-active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -6px;
  height: 2px;
  border-radius: 999px;
  background: var(--accent-text);
}

@media (max-width: 640px) {
  .gui-tabs.is-left {
    flex-direction: column;
    gap: 12px;

    > .gui-tabs-rail {
      width: 100% !important;
      flex-direction: row;
      align-items: center;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }

      .gui-tabs-tab {
        flex-direction: row;
        flex-wrap: nowrap;
      }

      .gui-tabs-extra {
        flex-direction: row;
        flex-shrink: 0;
      }

      .gui-button,
      :slotted(.gui-button) {
        flex: 0 0 auto;
        width: auto;
        white-space: nowrap;
      }
    }

    > .gui-tabs-content {
      width: 100% !important;
    }

    .gui-tabs-tab--left .gui-tabs-item {
      width: auto;
    }

    .gui-tabs-tab--left .gui-tabs-item.is-active::before {
      display: none;
    }
  }
}
</style>
