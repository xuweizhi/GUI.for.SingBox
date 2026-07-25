<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { NavigationBar, TitleBar } from '@/components'
import { useEnvStore } from '@/stores'

const route = useRoute()
const envStore = useEnvStore()
const showTitleBar = computed(() => envStore.env.runtimeMode !== 'webui')
</script>

<template>
  <TitleBar v-if="showTitleBar" />
  <div class="app-content flex-1 overflow-y-auto flex flex-col p-8">
    <NavigationBar />
    <div
      :class="{ 'app-page--overview': route.name === 'Overview' }"
      class="app-page flex flex-col overflow-y-auto mt-8 px-8 h-full"
    >
      <RouterView #="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </div>
  </div>
</template>
