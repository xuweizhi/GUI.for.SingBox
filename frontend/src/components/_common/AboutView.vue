<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import logo from '@/assets/logo'
import { BrowserOpenURL } from '@/bridge'
import { useAppStore, useEnvStore } from '@/stores'
import {
  APP_TITLE,
  APP_VERSION,
  PROJECT_URL,
  TG_GROUP,
  TG_CHANNEL,
  message,
  restartApp,
} from '@/utils'

const { t } = useI18n()
const envStore = useEnvStore()
const appStore = useAppStore()
const restarting = ref(false)

const handleRestartApp = async () => {
  if (restarting.value) return
  restarting.value = true
  try {
    await restartApp()
  } catch (error: any) {
    message.error(error)
  } finally {
    restarting.value = false
  }
}

if (Date.now() - appStore.lastCheckTime > 60_000) {
  appStore.checkForUpdates()
}
</script>

<template>
  <div class="flex flex-col items-center py-20 gap-10">
    <img :src="logo" alt="" class="w-96" draggable="false" />
    <div class="text-18 font-bold">{{ APP_TITLE }}</div>
    <div class="flex flex-wrap items-center justify-center gap-8">
      <Button
        v-if="appStore.restartable"
        :loading="restarting"
        icon="restartApp"
        size="small"
        type="primary"
        @click="handleRestartApp"
      >
        {{ t('about.restart') }}
      </Button>
      <template v-else>
        <Button
          v-tips="'plugins.checkForUpdates'"
          :loading="appStore.checkForUpdatesLoading"
          icon="refresh"
          type="normal"
          size="small"
          @click="appStore.checkForUpdates(true)"
        >
          Bridge: {{ envStore.env.appVersion }} · UI: {{ APP_VERSION }}
        </Button>
        <Button
          v-if="appStore.updatable"
          :loading="appStore.downloading"
          type="primary"
          size="small"
          @click="appStore.downloadApp"
        >
          {{ t('about.new') }}: {{ appStore.remoteVersion }}
        </Button>
      </template>
    </div>
    <div class="flex flex-wrap items-center justify-center gap-8 mt-6">
      <Button type="text" size="small" icon="github" @click="BrowserOpenURL(PROJECT_URL)">
        GitHub
      </Button>
      <Button type="text" size="small" icon="telegram" @click="BrowserOpenURL(TG_GROUP)">
        Telegram Group
      </Button>
      <Button type="text" size="small" icon="telegram" @click="BrowserOpenURL(TG_CHANNEL)">
        Telegram Channel
      </Button>
    </div>
  </div>
</template>
