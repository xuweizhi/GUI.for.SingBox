<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { NetworkCheckResultGroup } from '@/views/NetCheckView/useNetworkCheck'

const props = withDefaults(
  defineProps<{
    group: NetworkCheckResultGroup
    running?: boolean
  }>(),
  {
    running: false,
  },
)

const { t, te } = useI18n()

const renderText = (value?: string) => {
  if (!value) return ''
  return te(value) ? t(value) : value
}

const countSummaryKeyMap = {
  success: 'netCheck.summary.groupCountSuccess',
  failed: 'netCheck.summary.groupCountFailed',
  skipped: 'netCheck.summary.groupCountSkipped',
  running: 'netCheck.summary.groupCountRunning',
} as const

const renderCountSummary = (summary: string) => {
  if (summary === '0 items') {
    return t('netCheck.summary.groupEmpty')
  }

  const parts = summary
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return summary

  const localized = parts.map((part) => {
    const match = part.match(/^(\d+)\s+(success|failed|skipped|running)$/)
    if (!match) return

    const [, count, status] = match
    return t(countSummaryKeyMap[status as keyof typeof countSummaryKeyMap], [count])
  })

  return localized.every(Boolean) ? localized.join(' · ') : summary
}

const renderGroupSummary = () => {
  const summary = props.group.summary
  if (!summary) return ''
  if (te(summary)) return t(summary)
  if (props.running && props.group.items.length === 0) return t('netCheck.summary.groupRunning')
  return renderCountSummary(summary)
}

const statusLabel = (status: string) => {
  const key = `netCheck.status.${status}`
  return te(key) ? t(key) : status
}

const showEmptyBody = computed(() => !props.running && props.group.items.length === 0)
</script>

<template>
  <div
    class="group-card flex flex-col gap-10 rounded-10 p-12"
    :class="`group-card--${props.group.status}`"
    :data-group="props.group.id"
  >
    <div class="flex flex-wrap items-center justify-between gap-8">
      <div class="flex items-center gap-8">
        <span class="font-bold text-14">{{ renderText(props.group.title) }}</span>
        <span class="status-badge" :class="`status-badge--${props.group.status}`">
          {{ statusLabel(props.group.status) }}
        </span>
      </div>
      <div v-if="props.group.summary" class="text-12 text-muted">
        {{ renderGroupSummary() }}
      </div>
    </div>

    <div v-if="showEmptyBody" class="text-12 text-muted">
      {{ t('netCheck.results.empty') }}
    </div>

    <div v-else class="flex flex-col gap-8">
      <div
        v-for="item in props.group.items"
        :key="item.id"
        class="group-item rounded-8 p-10"
        :class="`group-item--${item.status}`"
        :data-result="item.id"
      >
        <div class="flex flex-wrap items-center justify-between gap-8">
          <div class="flex items-center gap-6">
            <span class="status-dot" :class="`status-dot--${item.status}`" aria-hidden="true"></span>
            <span class="font-bold text-13">{{ renderText(item.title) }}</span>
          </div>
          <div class="flex items-center gap-8">
            <span v-if="item.durationMs !== undefined" class="text-12 text-muted font-mono">
              {{ t('netCheck.results.duration', [item.durationMs]) }}
            </span>
            <span class="status-badge" :class="`status-badge--${item.status}`">
              {{ statusLabel(item.status) }}
            </span>
          </div>
        </div>
        <div class="text-12 mt-6">
          {{ renderText(item.summary) }}
        </div>
        <div v-if="item.detail" class="text-12 text-muted mt-4 font-mono break-all">
          {{ renderText(item.detail) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.group-card {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--bg-color);
}

.group-item {
  border: 1px solid var(--border-color, #e5e7eb);
  border-left-width: 3px;
  background: var(--card-bg, #fff);

  &--success {
    border-left-color: var(--success-color);
  }
  &--failed {
    border-left-color: var(--danger-color);
  }
  &--running {
    border-left-color: var(--warning-color);
  }
  &--skipped {
    border-left-color: var(--muted-color);
  }
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;

  &--success {
    background: var(--success-color);
  }
  &--failed {
    background: var(--danger-color);
  }
  &--running {
    background: var(--warning-color);
  }
  &--skipped {
    background: var(--muted-color);
  }
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;

  &--success {
    color: var(--success-color);
    background: var(--success-soft);
  }
  &--failed {
    color: var(--danger-color);
    background: var(--danger-soft);
  }
  &--running {
    color: var(--warning-color);
    background: var(--warning-soft);
  }
  &--skipped {
    color: var(--muted-color);
    background: var(--bg-color);
    border: 1px solid var(--border-color);
  }
}
</style>
