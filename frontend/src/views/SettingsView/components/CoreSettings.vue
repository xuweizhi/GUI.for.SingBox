<script setup lang="ts">
import { useAppSettingsStore } from '@/stores'
import { modal } from '@/utils'

import NetworkSettings from './components/NetworkSettings.vue'
const settings = useAppSettingsStore()
import BranchDetail from './components/BranchDetail.vue'
import CoreConfiguration from './components/CoreConfig.vue'

const handleCoreConfiguraion = async (isAlpha: boolean) => {
  const m = modal({ title: 'settings.kernel.config.name', size: 'lg' })
  m.setContent(CoreConfiguration, { isAlpha }).open()
}
</script>

<template>
  <div class="flex flex-col gap-8 pr-20 mb-8">
    <h2 class="text-16">{{ $t('settings.kernel.version') }}</h2>
    <section class="branch-grid">
      <BranchDetail :is-alpha="false" @config="handleCoreConfiguraion(false)" />
      <BranchDetail :is-alpha="true" @config="handleCoreConfiguraion(true)" />
    </section>
    <Card>
      <div class="settings-row">
        <div>{{ $t('settings.realMemoryUsage') }}</div>
        <Switch v-model="settings.app.kernel.realMemoryUsage" />
      </div>
      <div class="settings-row">
        <div>
          {{ $t('settings.autoRestartKernel.name') }}
          <span class="font-normal text-12">{{ $t('settings.autoRestartKernel.tips') }}</span>
        </div>
        <Switch v-model="settings.app.autoRestartKernel" />
      </div>
    </Card>
    <NetworkSettings />
  </div>
</template>

<style scoped>
.branch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 12px;
}
</style>
