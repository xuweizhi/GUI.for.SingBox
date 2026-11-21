<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { Branch } from '@/enums/app'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import { message } from '@/utils'

const { t } = useI18n()
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()

const handleUseBranch = async (branch: Branch) => {
  appSettings.app.kernel.branch = branch

  if (!kernelApiStore.running) return

  try {
    await kernelApiStore.restartCore()
  } catch (error: any) {
    message.error(error)
  }
}
</script>

<template>
  <div class="font-bold text-16 px-8 py-12">{{ t('settings.kernel.version') }}</div>
  <div class="switch-branch-grid">
    <Card
      :selected="appSettings.app.kernel.branch === Branch.Main"
      title="Stable"
      interactive
      @click="handleUseBranch(Branch.Main)"
    >
      <div class="py-4 text-12 text-muted">
        {{ t('settings.kernel.stable') }}
      </div>
    </Card>
    <Card
      :selected="appSettings.app.kernel.branch === Branch.Alpha"
      title="Alpha"
      interactive
      @click="handleUseBranch(Branch.Alpha)"
    >
      <div class="py-4 text-12 text-muted">
        {{ t('settings.kernel.alpha') }}
      </div>
    </Card>
  </div>
</template>

<style scoped>
.switch-branch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 600px) {
  .switch-branch-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
