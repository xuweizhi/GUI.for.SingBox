<script setup lang="ts">
import { useRoute } from 'vue-router'

import { NavigationBar } from '@/components'

const route = useRoute()
</script>

<template>
  <div class="app-content">
    <NavigationBar />
    <header class="page-heading">
      <h1>{{ route.meta.name ? $t(route.meta.name) : route.name }}</h1>
    </header>
    <div :class="{ 'app-page--overview': route.name === 'Overview' }" class="app-page">
      <RouterView #="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </div>
  </div>
</template>

<style scoped>
.app-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.page-heading,
.app-page {
  width: 100%;
  max-width: 1328px;
  margin: 0 auto;
  padding: 0 24px;
}
.page-heading {
  flex-shrink: 0;
  padding-top: 24px;
  padding-bottom: 16px;
}
.page-heading h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
  font-weight: 650;
}
.app-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 16px;
}
@media (max-width: 760px) {
  .page-heading,
  .app-page {
    padding-left: 16px;
    padding-right: 16px;
  }
  .page-heading {
    padding-top: 16px;
    padding-bottom: 12px;
  }
  .page-heading h1 {
    font-size: 22px;
  }
}
</style>
