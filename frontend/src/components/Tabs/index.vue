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
      role="tablist"
      :aria-orientation="isTop ? 'horizontal' : 'vertical'"
      :class="{ 'gui-tabs-tab--top mb-12': isTop, 'gui-tabs-tab--left flex-col': !isTop }"
      :style="{ width: isTop ? 'auto' : tabWidth }"
      class="gui-tabs-tab flex gap-4"
    >
      <Button
        v-for="tab in items"
        :key="tab.key"
        role="tab"
        :aria-selected="isActive(tab)"
        :type="isActive(tab) ? 'link' : 'text'"
        :class="{ 'is-active': isActive(tab) }"
        class="gui-tabs-item"
        @click="handleChange(tab.key)"
      >
        {{ t(tab.tab) }}
      </Button>
      <slot name="extra"></slot>
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
  overflow-x: auto;
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
  bottom: -7px;
  height: 2px;
  border-radius: 999px;
  background: var(--accent-text);
}

@media (max-width: 640px) {
  .gui-tabs.is-left {
    flex-direction: column;
    gap: 12px;

    > .gui-tabs-tab {
      width: 100% !important;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }

      > .gui-button,
      > :slotted(.gui-button) {
        flex: 0 0 auto;
        white-space: nowrap;
      }
    }

    > .gui-tabs-content {
      width: 100% !important;
    }

    .gui-tabs-tab--left .gui-tabs-item.is-active::before {
      display: none;
    }
  }
}
</style>
