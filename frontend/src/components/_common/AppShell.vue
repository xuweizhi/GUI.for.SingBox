<script setup lang="ts">
import { computed } from 'vue'

import { NavigationBar, TitleBar } from '@/components'
import { useEnvStore } from '@/stores'

const envStore = useEnvStore()
const showTitleBar = computed(() => envStore.env.runtimeMode !== 'webui')
</script>

<template>
  <TitleBar v-if="showTitleBar" />
  <div class="flex-1 overflow-y-auto flex flex-col p-8">
    <NavigationBar />
    <div class="flex flex-col overflow-y-auto mt-8 px-8 h-full">
      <RouterView #="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </div>
  </div>
</template>
