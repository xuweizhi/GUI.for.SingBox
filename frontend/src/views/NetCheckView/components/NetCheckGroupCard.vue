<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const effectiveStatus = computed(() =>
  props.running && props.group.items.length === 0 ? 'running' : props.group.status,
)
const showEmptyBody = computed(() => !props.running && props.group.items.length === 0)
const collapsible = computed(() => props.group.id === 'rulesets')
const expanded = ref(!collapsible.value || props.group.status === 'failed')
const hasFailures = computed(() => props.group.items.some((item) => item.status === 'failed'))
const failureOnly = ref(false)
const visibleItems = computed(() =>
  collapsible.value && failureOnly.value
    ? props.group.items.filter((item) => item.status === 'failed')
    : props.group.items,
)
const toggleExpanded = () => {
  if (collapsible.value) expanded.value = !expanded.value
}
const toggleFailureOnly = () => {
  failureOnly.value = !failureOnly.value
  expanded.value = true
}
watch(
  () => props.running,
  (running, wasRunning) => {
    if (!collapsible.value || !wasRunning || running) return
    expanded.value = props.group.status === 'failed'
    failureOnly.value = props.group.status === 'failed'
  },
)
watch(
  () => props.group.status,
  (status) => {
    if (!collapsible.value) return
    if (status === 'failed') expanded.value = true
  },
)
</script>

<template>
  <section
    class="group-card flex flex-col gap-10"
    :class="`group-card--${effectiveStatus}`"
    :data-group="props.group.id"
  >
    <div class="group-card__header flex flex-wrap items-center justify-between gap-8">
      <component
        :is="collapsible ? 'button' : 'div'"
        :type="collapsible ? 'button' : undefined"
        :aria-expanded="collapsible ? expanded : undefined"
        class="group-card__toggle flex items-center gap-8 min-w-0"
        :class="{ 'is-collapsible': collapsible }"
        @click="toggleExpanded"
      >
        <Icon
          v-if="collapsible"
          icon="arrowRight"
          :size="14"
          color="currentColor"
          class="group-card__chevron shrink-0"
          :class="{ 'is-expanded': expanded }"
        />
        <span class="font-bold text-14">{{ renderText(props.group.title) }}</span>
        <span class="status-badge" :class="`status-badge--${effectiveStatus}`">
          {{ statusLabel(effectiveStatus) }}
        </span>
      </component>
      <div class="flex items-center gap-8 shrink-0">
        <div v-if="props.group.summary" class="text-12 text-muted">
          {{ renderGroupSummary() }}
        </div>
        <template v-if="collapsible && hasFailures">
          <Button size="small" type="text" @click="toggleFailureOnly">
            {{
              t(failureOnly ? 'netCheck.actions.showAll' : 'netCheck.actions.failuresOnly')
            }}
          </Button>
        </template>
      </div>
    </div>

    <div v-if="showEmptyBody" class="text-12 text-muted">
      {{ t('netCheck.results.empty') }}
    </div>

    <div
      v-else-if="!collapsible || expanded"
      class="flex flex-col gap-8"
    >
      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="group-item rounded-8 p-10"
        :class="`group-item--${item.status}`"
        :data-result="item.id"
      >
        <div class="flex flex-wrap items-center justify-between gap-8">
          <div class="flex items-center gap-6">
            <span
              class="status-dot"
              :class="`status-dot--${item.status}`"
              aria-hidden="true"
            ></span>
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
        <div class="group-item__summary text-12 mt-6">
          {{ renderText(item.summary) }}
        </div>
        <div v-if="item.detail" class="text-12 text-muted mt-4 font-mono break-all">
          {{ renderText(item.detail) }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="less">
.group-card {
  border: 0;
  background: transparent;
  padding: 4px 0;
}
.group-card__header {
  width: 100%;
  min-width: 0;
}
.group-card__toggle {
  padding: 2px 4px;
  margin: -2px -4px;
  border: 0;
  border-radius: var(--control-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
}
.group-card__toggle.is-collapsible {
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
}
.group-item__summary {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.group-card__chevron {
  transition: transform 0.16s ease;
}
.group-card__chevron.is-expanded {
  transform: rotate(90deg);
}

.group-item {
  border: 1px solid var(--surface-border, var(--border-color, #e5e7eb));
  border-left-width: 3px;
  background: var(--surface-bg, var(--card-bg, #fff));

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
  font-size: calc(11px * var(--font-scale, 1));
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
    border: 1px solid var(--surface-border);
  }
}
</style>
