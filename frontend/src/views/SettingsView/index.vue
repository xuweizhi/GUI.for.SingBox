<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { useAppStore } from '@/stores'

import BackupSettings from './components/BackupSettings.vue'
import CoreSettings from './components/CoreSettings.vue'
import GeneralSettings from './components/GeneralSettings.vue'
import PluginSettings from './components/PluginSettings.vue'

const settings = [
  {
    key: 'general',
    tab: 'workspace.general',
    component: GeneralSettings,
  },
  {
    key: 'kernel',
    tab: 'workspace.core',
    component: CoreSettings,
  },
  {
    key: 'plugins',
    tab: 'router.plugins',
    component: PluginSettings,
  },
  { key: 'backup', tab: 'workspace.backup', component: BackupSettings },
] as const

const route = useRoute()
const router = useRouter()
const activeKey = computed({
  get: () => settings.find((s) => s.key === route.query.tab)?.key ?? 'general',
  set: (tab: string) => {
    void router.replace({ query: { ...route.query, tab } })
  },
})

const { t } = useI18n()
const appStore = useAppStore()
</script>

<template>
  <Tabs
    v-model:active-key="activeKey"
    :items="settings"
    tab-width="190px"
    content-width="auto"
    class="settings-tabs h-full"
  >
    <template #extra>
      <Button type="text" @click="appStore.showAbout = true">
        {{ t('router.about') }}
      </Button>
    </template>
  </Tabs>
</template>

<style lang="less" scoped>
.settings-tabs {
  max-width: 1040px;
  width: 100%;
  min-height: 0;
  gap: 24px;
  :deep(.gui-tabs-rail) {
    flex-shrink: 0;
    gap: 4px;
  }
  :deep(.gui-tabs-tab > .gui-button),
  :deep(.gui-tabs-extra > .gui-button) {
    justify-content: flex-start;
    min-height: 40px;
  }
  :deep(.gui-tabs-extra) {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
  }
  :deep(.gui-tabs-tab > .link) {
    background: var(--accent-soft);
    font-weight: 600;
  }
  :deep(.gui-tabs-content) {
    flex: 1;
    min-width: 0;
    padding-right: 4px;
  }
}
@media (max-width: 640px) {
  .settings-tabs {
    flex-direction: column;
    gap: 16px;
    :deep(.gui-tabs-extra) {
      margin-top: 0;
      padding-top: 0;
      border-top: 0;
    }
    :deep(.gui-tabs-tab > .gui-button),
    :deep(.gui-tabs-extra > .gui-button) {
      justify-content: center;
      min-height: 44px;
    }
    :deep(.gui-tabs-content) {
      width: 100% !important;
      padding-right: 0;
    }
  }
}
</style>
