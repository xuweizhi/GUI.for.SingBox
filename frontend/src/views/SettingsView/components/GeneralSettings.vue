<script setup lang="ts">
import { useAppSettingsStore } from '@/stores'

import PersonalizationSettings from './components/PersonalizationSettings.vue'

const appSettings = useAppSettingsStore()
</script>

<template>
  <div class="flex flex-col gap-8 pr-20 mb-8">
    <PersonalizationSettings />
    <div class="px-8 py-12 text-16 font-bold">{{ $t('settings.behavior') }}</div>
    <Card>
      <div class="settings-row">
        <div>{{ $t('settings.autoStartKernel') }}</div>
        <Switch v-model="appSettings.app.autoStartKernel" />
      </div>
    </Card>
  </div>
</template>
