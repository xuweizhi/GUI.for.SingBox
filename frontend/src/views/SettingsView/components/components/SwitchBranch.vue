<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { Branch } from '@/enums/app'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import { message } from '@/utils'

defineProps<{ branch: Branch }>()
const { t } = useI18n()
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()

const handleUseBranch = async (branch: Branch) => {
  const previous = appSettings.app.kernel.branch
  if (
    branch === previous ||
    kernelApiStore.starting ||
    kernelApiStore.stopping ||
    kernelApiStore.restarting
  )
    return
  appSettings.app.kernel.branch = branch

  if (!kernelApiStore.running) return

  try {
    await kernelApiStore.restartCore()
  } catch (error: any) {
    appSettings.app.kernel.branch = previous
    message.error(error)
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
    :disabled="kernelApiStore.starting || kernelApiStore.stopping || kernelApiStore.restarting"
    @click="handleUseBranch(branch)"
    >{{ t('common.use') }}</Button
  >
</template>
