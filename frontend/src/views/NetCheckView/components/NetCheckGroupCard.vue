<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { NetworkCheckResultGroup } from '@/views/NetCheckView/useNetworkCheck'

const props = defineProps<{
  group: NetworkCheckResultGroup
}>()

const { t, te } = useI18n()

const renderText = (value?: string) => {
  if (!value) return ''
  return te(value) ? t(value) : value
}

const renderGroupSummary = () => {
  const summary = props.group.summary
  if (!summary) return ''
  if (te(summary)) return t(summary)

  if (props.group.items.length === 0) return t('netCheck.summary.groupEmpty')
  if (props.group.status === 'failed') return t('netCheck.summary.groupAttention')
  if (props.group.status === 'running') return t('netCheck.summary.groupRunning')
  if (props.group.status === 'skipped') return t('netCheck.summary.groupSkipped')
  return t('netCheck.summary.groupReady')
}
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

    <div v-if="props.group.items.length === 0" class="text-12">
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
