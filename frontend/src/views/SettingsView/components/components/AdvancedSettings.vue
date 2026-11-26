<script lang="ts" setup>
import { useAppSettingsStore } from '@/stores'

const appSettings = useAppSettingsStore()

const normalizeRetentionDays = (value: number | string) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 14
  return Math.min(3650, Math.max(1, Math.trunc(num)))
}

const onRetentionChange = (value: number | string) => {
  appSettings.app.log.retentionDays = normalizeRetentionDays(value)
}
</script>

<template>
  <div class="px-4 py-8 text-16 font-bold">{{ $t('settings.advanced') }}</div>

  <Card>
    <div class="settings-row">
      <div>
        {{ $t('settings.logRetentionDays.name') }}
        <span class="font-normal text-12">{{ $t('settings.logRetentionDays.tips') }}</span>
      </div>
      <Input
        :model-value="appSettings.app.log.retentionDays"
        :min="1"
        :max="3650"
        type="number"
        @update:model-value="onRetentionChange"
        @submit="onRetentionChange"
      />
    </div>
  </Card>
</template>
