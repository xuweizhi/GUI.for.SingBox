<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAppStore } from '@/stores'

import CoreSettings from './components/CoreSettings.vue'
import GeneralSettings from './components/GeneralSettings.vue'
import PluginSettings from './components/PluginSettings.vue'

const settings = [
  {
    key: 'general',
    tab: 'settings.general',
    component: GeneralSettings,
  },
  {
    key: 'kernel',
    tab: 'router.kernel',
    component: CoreSettings,
  },
  {
    key: 'plugins',
    tab: 'router.plugins',
    component: PluginSettings,
  },
] as const

const activeKey = ref(settings[0].key)

const { t } = useI18n()
const appStore = useAppStore()
</script>

<template>
  <Tabs
    v-model:active-key="activeKey"
    :items="settings"
    tab-width="160px"
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
  :deep(.gui-tabs-tab) {
    flex-shrink: 0;
    gap: 4px;
  }
  :deep(.gui-tabs-tab > .gui-button) {
    justify-content: flex-start;
    min-height: 40px;
  }
  :deep(.gui-tabs-tab > .link) {
    background: var(--accent-soft);
    font-weight: 600;
  }
  :deep(.gui-tabs-content) {
    flex: 1;
    min-width: 0;
  }
  :deep(.gui-tabs-content > .pr-20) {
    padding-right: 4px;
  }
  :deep(.settings-row) {
    display: grid;
    grid-template-columns: minmax(160px, 0.8fr) minmax(0, 1.2fr);
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 0;
    > :first-child {
      min-width: 0;
      font-size: 14px;
      font-weight: 500;
    }
    > :last-child {
      max-width: 100%;
      justify-self: start;
    }
    > .gui-switch {
      justify-self: end;
    }
    > .flex:last-child {
      flex-wrap: wrap;
      gap: 6px;
    }
    .text-12 {
      display: block;
      color: var(--muted-color);
      margin-top: 4px;
    }
    + .settings-row {
      border-top: 1px solid var(--border-color);
    }
  }
}
@media (max-width: 760px) {
  .settings-tabs {
    flex-direction: column;
    gap: 16px;
    :deep(.gui-tabs-tab) {
      width: 100% !important;
      flex-direction: row;
      flex-wrap: wrap;
    }
    :deep(.gui-tabs-tab > .gui-button) {
      flex: 1;
      justify-content: center;
      min-height: 44px;
    }
    :deep(.gui-tabs-content) {
      width: 100% !important;
    }
    :deep(.settings-row) {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
      > :last-child {
        max-width: 100%;
      }
      > .flex:last-child {
        justify-content: flex-start;
      }
      &:has(> .gui-switch) {
        flex-direction: row;
        align-items: center;
      }
    }
  }
}
</style>
