<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { onRuntimeEvent } from '@/bridge/browser/shared/webui'

import { useAppBootstrap, useAppLifecycle } from '@/hooks'
import { useWebuiAuthStore } from '@/stores'

import { SplashView, AppShell, GlobalOverlays } from '@/components'

const route = useRoute()
const authStore = useWebuiAuthStore()
const { loading, percent, hasError, initialized, initialize } = useAppBootstrap()

useAppLifecycle()

watch(
  () => authStore.status,
  (status, _, onCleanup) => {
    if (status === 'authenticated') {
      onCleanup(onRuntimeEvent('configurationRestored', () => window.location.reload()))
    }
  },
  { immediate: true },
)

const startBootstrap = async () => {
  if (initialized.value || loading.value) return

  authStore.bootstrapped = await initialize()
}

onMounted(() => {
  authStore.hydrate()
})

watch(
  [() => route.fullPath, () => authStore.status],
  async () => {
    if (route.meta.public || authStore.status !== 'authenticated') return

    await startBootstrap()
  },
  { immediate: true },
)
</script>

<template>
  <SplashView v-if="loading">
    <div class="rotation">
      <Progress
        :percent="percent"
        :status="hasError ? 'danger' : 'primary'"
        :radius="10"
        type="circle"
      />
    </div>
  </SplashView>
  <RouterView v-else-if="authStore.status !== 'authenticated'" />
  <SplashView v-else-if="!initialized">
    <div class="flex flex-col items-center gap-12">
      <div>{{ $t('common.bootstrapFailed') }}</div>
      <Button @click="startBootstrap">{{ $t('common.retry') }}</Button>
    </div>
  </SplashView>
  <AppShell v-else />
  <GlobalOverlays :loading="loading" />
</template>
