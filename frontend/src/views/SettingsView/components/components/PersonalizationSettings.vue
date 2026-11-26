<script lang="ts" setup>
import { BrowserOpenURL } from '@/bridge'
import routes from '@/router/routes'
import { useAppSettingsStore, useAppStore } from '@/stores'
import { APP_LOCALES_URL } from '@/utils'

import AppearanceControls from '@/components/_common/AppearanceControls.vue'

const pages = routes.flatMap((route) => {
  if (route.meta?.hidden !== undefined || !route.meta?.name) return []
  return {
    label: route.meta.name,
    value: route.name as string,
  }
})

const appStore = useAppStore()
const appSettings = useAppSettingsStore()
</script>

<template>
  <div class="px-4 py-8 text-16 font-bold">{{ $t('settings.personalization') }}</div>

  <Card>
    <AppearanceControls />
    <Divider />
    <div class="settings-row">
      <div class="flex items-center">
        <div class="mr-4">{{ $t('settings.lang.name') }}</div>
        <Button type="text" size="small" icon="link" @click="BrowserOpenURL(APP_LOCALES_URL)" />
        <Button
          v-tips="'settings.lang.load'"
          :loading="appStore.localesLoading"
          type="text"
          size="small"
          icon="refresh"
          @click="appStore.loadLocales()"
        />
      </div>
      <Radio v-model="appSettings.app.lang" :options="appStore.locales" />
    </div>

    <div class="settings-row">
      <div>{{ $t('settings.pages.name') }}</div>
      <CheckBox v-model="appSettings.app.pages" :options="pages" />
    </div>
  </Card>
</template>
