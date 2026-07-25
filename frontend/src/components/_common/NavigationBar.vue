<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import rawRoutes from '@/router/routes'
import { useAppSettingsStore, useWebuiAuthStore } from '@/stores'
import { isWebui } from '@/utils/env'

const { t } = useI18n()
const appSettings = useAppSettingsStore()
const authStore = useWebuiAuthStore()

const routes = computed(() =>
  rawRoutes.filter(
    (r) =>
      r.meta?.hidden === false ||
      (!r.meta?.hidden && appSettings.app.pages.includes(r.name! as string)),
  ),
)

const handleLogout = async () => {
  await authStore.logout()
}
</script>

<template>
  <div class="main-nav flex items-center justify-center">
    <div
      v-for="r in routes"
      :key="r.path"
      :class="['main-nav__item', `main-nav__item--${String(r.name).toLowerCase()}`]"
    >
      <RouterLink v-slot="{ navigate, isActive }" :to="r.path" custom>
        <Button
          :class="{ 'is-active': isActive }"
          class="main-nav__button"
          :type="isActive ? 'link' : 'text'"
          :icon="r.meta && r.meta.icon"
          @click="navigate"
        >
          {{ r.meta?.name ? t(r.meta.name) : r.name }}
        </Button>
      </RouterLink>
    </div>
    <Button v-if="isWebui" type="text" icon="grant" @click="handleLogout">
      {{ t('auth.logout') }}
    </Button>
  </div>
</template>
