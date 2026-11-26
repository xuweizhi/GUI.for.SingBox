<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { FileExists } from '@/bridge'
import { CoreWorkingDirectory } from '@/constant/kernel'
import { Branch } from '@/enums/app'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import { getKernelFileName, message } from '@/utils'

defineProps<{ branch: Branch }>()
const { t } = useI18n()
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()
const switching = ref(false)

const handleUseBranch = async (branch: Branch) => {
  const previous = appSettings.app.kernel.branch
  if (
    switching.value ||
    branch === previous ||
    kernelApiStore.starting ||
    kernelApiStore.stopping ||
    kernelApiStore.restarting
  )
    return

  switching.value = true
  try {
    const targetBinary = `${CoreWorkingDirectory}/${getKernelFileName(branch === Branch.Alpha)}`
    const exists = await FileExists(targetBinary).catch(() => false)
    if (!exists) {
      message.warn('kernel.notFound')
      return
    }

    const wasRunning = kernelApiStore.running
    appSettings.app.kernel.branch = branch

    if (!wasRunning) return

    try {
      await kernelApiStore.restartCore()
    } catch (error: any) {
      appSettings.app.kernel.branch = previous
      message.error(error)
      if (!kernelApiStore.running) {
        await kernelApiStore.startCore().catch((restoreError) => message.error(restoreError))
      }
    }
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <Tag v-if="appSettings.app.kernel.branch === branch" size="small" color="primary">{{
    t('workspace.active')
  }}</Tag>
  <Button
    v-else
    size="small"
    :loading="switching"
    :disabled="
      switching || kernelApiStore.starting || kernelApiStore.stopping || kernelApiStore.restarting
    "
    @click="handleUseBranch(branch)"
    >{{ t('common.use') }}</Button
  >
</template>
