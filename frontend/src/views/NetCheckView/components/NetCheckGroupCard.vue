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

const showEmptyBody = computed(() => !props.running && props.group.items.length === 0)
</script>

<template>
  <div class="group-card flex flex-col gap-8 rounded-8 p-12" :data-group="props.group.id">
    <div class="flex flex-col gap-4">
      <div class="font-bold">
        {{ renderText(props.group.title) }}
      </div>
      <div v-if="props.group.summary" class="text-12">
        {{ renderGroupSummary() }}
      </div>
    </div>

    <div v-if="showEmptyBody" class="text-12">
      {{ t('netCheck.results.empty') }}
    </div>

    <div v-else class="flex flex-col gap-8">
      <div
        v-for="item in props.group.items"
        :key="item.id"
        class="group-item rounded-8 p-8"
        :data-result="item.id"
      >
        <div class="font-bold">
          {{ renderText(item.title) }}
        </div>
        <div class="text-12 mt-4">
          {{ renderText(item.summary) }}
        </div>
        <div v-if="item.detail" class="text-12 mt-4">
          {{ renderText(item.detail) }}
        </div>
        <div v-if="item.durationMs !== undefined" class="text-12 mt-4">
          {{ t('netCheck.results.duration', [item.durationMs]) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.group-card,
.group-item {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--card-bg, #fff);
}
</style>
