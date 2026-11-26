<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { delayColor } from '@/utils/nodeDelay'

import type { NodeListItem } from '@/utils/nodeDelay'
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
    :class="{ 'is-selected': selected, 'is-compact': compact, 'is-disabled': disabled }"
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
      <span class="node-card__type text-muted">{{ node.proxy?.type || t('home.nodes.unknownType') }}</span>
      <Tag v-if="node.proxy?.udp" size="small" color="default">UDP</Tag>
      <div class="node-card__actions flex items-center gap-2 ml-auto min-w-0">
        <button
          v-if="favorite != null"
          type="button"
          class="favorite-button shrink-0"
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
          class="node-delay-btn"
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
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;
}
.node-card:not(.is-disabled):hover {
  border-color: color-mix(in srgb, var(--accent-text) 48%, var(--surface-border));
}
.node-card.is-disabled {
  cursor: default;
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
  min-width: 0;
  flex-wrap: wrap;
}
.node-card__type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.node-delay-btn {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-card.is-compact {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 8px;

  .node-card__main {
    flex: 1 1 120px;
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
    flex-shrink: 1;
    max-width: 100%;
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
.node-name:disabled {
  cursor: default;
  opacity: 0.78;
}
.favorite-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: var(--muted-color);
  border: 0;
  font-size: 16px;
  transition: background-color 0.14s ease;
}
.favorite-button:hover {
  background: var(--btn-text-hover-bg);
}
.favorite-button[aria-pressed='true'] {
  color: var(--warning-color);
}
.delay-failed {
  color: var(--danger-color);
}
</style>
