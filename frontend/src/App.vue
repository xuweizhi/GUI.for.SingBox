<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useAppBootstrap, useAppLifecycle } from '@/hooks'
import { useWebuiAuthStore } from '@/stores'
import { isWebui } from '@/utils/env'

import { SplashView, AppShell, GlobalOverlays } from '@/components'

const route = useRoute()
const authStore = useWebuiAuthStore()
const { loading, percent, hasError, initialized, initialize } = useAppBootstrap()

useAppLifecycle()

const readyForShell = computed(() => !isWebui || authStore.status === 'authenticated')

const startBootstrap = async () => {
  if (initialized.value || loading.value) return

  await initialize()
  if (isWebui) {
    authStore.bootstrapped = true
  }
}

onMounted(() => {
  authStore.hydrate()
})

watch(
  [() => route.fullPath, () => authStore.status],
  async () => {
    if (!isWebui) {
      await startBootstrap()
      return
    }

    if (route.meta.public || authStore.status !== 'authenticated') return

    await startBootstrap()
  },
  { immediate: true },
)
</script>

<template>
  <SplashView v-if="loading">
    <Progress
      :percent="percent"
      :status="hasError ? 'danger' : 'primary'"
      :radius="10"
      type="circle"
    />
  </SplashView>
  <RouterView v-else-if="isWebui && !readyForShell" />
  <AppShell v-else />
  <GlobalOverlays :loading="loading" />
</template>
