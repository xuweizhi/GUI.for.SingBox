<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { delayColor } from '@/views/HomeView/nodeController'

import type { NodeListItem } from '@/views/HomeView/nodeController'
const props = defineProps<{
  query?: string
  node: Omit<NodeListItem, 'originalIndex'>
  selected: boolean
  disabled?: boolean
  compact?: boolean
  favorite?: boolean | null
  testing: boolean
  phase?: string
}>()
const emit = defineEmits<{ select: []; test: []; favorite: [] }>()
const { t } = useI18n()
const nameParts = computed(() => {
  const label = props.node.displayName ? t(props.node.displayName) : props.node.name
  const query = props.query?.trim() || ''
  const start = query ? label.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1
  return start < 0
    ? [label]
    : [
        label.slice(0, start),
        label.slice(start, start + query.length),
        label.slice(start + query.length),
      ]
})
</script>
<template>
  <article
    class="node-card surface-card"
    :class="{ 'is-selected': selected, 'is-compact': compact }"
    :data-node="node.name"
    :aria-label="node.name"
    role="group"
    @click="!disabled && emit('select')"
    @keydown.enter.self.prevent="!disabled && emit('select')"
    @keydown.space.self.prevent="!disabled && emit('select')"
  >
    <div class="node-card__main">
      <button
        type="button"
        class="node-name"
        :title="node.name"
        :aria-pressed="selected"
        :disabled="disabled"
        @click.stop="emit('select')"
      >
        {{ nameParts[0] }}<mark v-if="nameParts[1]">{{ nameParts[1] }}</mark
        >{{ nameParts[2] }}
      </button>
      <div v-if="node.displayName" class="text-12 text-muted line-clamp-1">
        {{ node.name }}
        <span v-if="node.proxy?.now">
          · {{ t('home.nodes.currentAutoNode') }}: {{ node.proxy.now }}</span
        >
      </div>
    </div>
    <div class="node-card__meta flex items-center text-12 gap-4">
      <span class="text-muted">{{ node.proxy?.type || t('home.nodes.unknownType') }}</span>
      <Tag v-if="node.proxy?.udp" size="small" color="default">UDP</Tag>
      <button
        v-if="favorite != null"
        type="button"
        class="favorite-button ml-auto"
        :data-favorite="node.name"
        :aria-pressed="favorite"
        :aria-label="
          t(favorite ? 'home.nodes.removeFavorite' : 'home.nodes.addFavorite', [node.name])
        "
        :title="t(favorite ? 'home.nodes.removeFavorite' : 'home.nodes.addFavorite', [node.name])"
        @click.stop="emit('favorite')"
      >
        {{ favorite ? '★' : '☆' }}
      </button>
      <Button
        v-tips.fast="node.error?.message"
        :data-delay="node.name"
        :data-test="`proxy-delay-${node.name}`"
        :loading="testing"
        :aria-description="node.error?.message"
        type="text"
        size="small"
        :aria-label="t('workspace.testDelay') + ' · ' + node.name"
        @click.stop="emit('test')"
      >
        <span v-if="phase === 'queued'" class="text-muted">
          {{ t('home.nodes.queued') }}
        </span>
        <span v-else-if="phase === 'retry-queued'" class="text-muted">
          {{ t('home.nodes.retryQueued') }}
        </span>
        <span
          v-else-if="node.delayStatus === 'success'"
          class="delay-success font-bold"
          :style="{ color: delayColor(node.delay) }"
        >
          {{ node.delay }} ms<span v-if="(node.attempts ?? 1) > 1" class="font-normal">
            · {{ node.attempts }} {{ t('home.nodes.attempts') }}</span
          >
        </span>
        <span v-else-if="node.delayStatus === 'failed'" class="delay-failed">
          {{ t(`home.nodes.delayError.${node.error?.category ?? 'unknown'}`) }}
          <template v-if="node.error">
            · {{ node.error.attempts }}/{{ node.error.maxAttempts }}</template
          >
        </span>
        <span v-else class="text-muted">{{ t('home.nodes.untested') }}</span>
      </Button>
    </div>
  </article>
</template>
<style scoped>
.node-card {
  min-width: 0;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.node-card.is-selected {
  border-color: var(--accent-text);
  box-shadow: inset 3px 0 var(--accent-text);
}
.node-card__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.node-card__meta {
  flex-shrink: 0;
}
.node-card.is-compact {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 8px;

  .node-card__main {
    flex: 1;
    overflow: hidden;
  }

  .node-name {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-line-clamp: unset;
  }

  .node-card__meta {
    margin-left: auto;
  }
}
.node-name {
  cursor: pointer;
  font: inherit;
  color: inherit;
  font-weight: 600;
  text-align: start;
  background: transparent;
  border: 0;
  padding: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.favorite-button {
  cursor: pointer;
  background: transparent;
  color: var(--muted-color);
  border: 0;
  font-size: 16px;
}
.favorite-button[aria-pressed='true'] {
  color: var(--warning-color);
}
.delay-failed {
  color: var(--danger-color);
}
</style>
