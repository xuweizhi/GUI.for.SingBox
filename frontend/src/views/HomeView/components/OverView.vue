<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { ProcessMemory } from '@/bridge'
import { ModeOptions } from '@/constant/kernel'
import { useAppStore, useKernelApiStore, useAppSettingsStore, useProfilesStore } from '@/stores'
import { confirm, formatBytes, handleChangeMode, message, modal } from '@/utils'

import CommonController from './CommonController.vue'
import ConnectionsController from './ConnectionsController.vue'
import CurrentNodeCard from './CurrentNodeCard.vue'
import LogsController from './LogsController.vue'

const emit = defineEmits<{ 'open-groups': [] }>()

const trafficHistory = ref<[number[], number[]]>([[], []])
const statistics = ref({
  upload: 0,
  download: 0,
  downloadTotal: 0,
  uploadTotal: 0,
  connections: [] as any[],
  inuse: 0,
  memUsage: 0,
})

const { t } = useI18n()
const router = useRouter()
const appStore = useAppStore()
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()
const profilesStore = useProfilesStore()

const activeProfileName = computed(() => profilesStore.currentProfile?.name || '')

const handleRestartKernel = async () => {
  try {
    await kernelApiStore.restartCore()
  } catch (error: any) {
    console.error(error)
    message.error(error)
  }
}

const handleStopKernel = async () => {
  try {
    await confirm(t('home.overview.stop'), t('common.confirmStopCore'), {
      type: 'text',
      okText: 'home.overview.stop',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await kernelApiStore.stopCore()
  } catch (error: any) {
    console.error(error)
    message.error(error)
  }
}

const handleShowApiLogs = () => {
  const m = modal({
    title: 'home.overview.logs',
    cancelText: 'common.close',
    width: '90',
    height: '90',
    submit: false,
    maskClosable: true,
  })
  m.setContent(LogsController).open()
}

const handleShowApiConnections = () => {
  const m = modal({
    title: 'home.overview.connections',
    cancelText: 'common.close',
    width: '90',
    height: '90',
    submit: false,
    maskClosable: true,
  })
  m.setContent(ConnectionsController).open()
}

const handleToggleRealMemoryUsage = () => {
  appSettings.app.kernel.realMemoryUsage = !appSettings.app.kernel.realMemoryUsage
}

const handleShowSettings = () => {
  const m = modal({
    title: 'home.overview.settings',
    cancelText: 'common.close',
    width: '90',
    submit: false,
    maskClosable: true,
  })
  m.setContent(CommonController).open()
}

const onTunSwitchChange = async (enable: boolean) => {
  try {
    await kernelApiStore.updateConfig('tun', { enable })
  } catch (error: any) {
    kernelApiStore.config.tun.enable = !kernelApiStore.config.tun.enable
    console.error(error)
    message.error(error)
  }
}

let latestCoreMemoryUsageTime: number
const getCoreMemoryUsage = async (fallback: number) => {
  if (latestCoreMemoryUsageTime && Date.now() - latestCoreMemoryUsageTime < 30_000) {
    return fallback
  }
  const useage = await ProcessMemory(kernelApiStore.pid).catch(() => fallback)
  latestCoreMemoryUsageTime = Date.now()
  return useage
}

const updateDisplayedMemoryUsage = (usage: number) => {
  if (usage > 0) {
    statistics.value.inuse = usage
  }
}

const unregisterMemoryHandler = kernelApiStore.onMemory(async (data) => {
  updateDisplayedMemoryUsage(data.inuse)
  if (appSettings.app.kernel.realMemoryUsage) {
    getCoreMemoryUsage(statistics.value.memUsage || data.inuse).then((usage) => {
      statistics.value.memUsage = usage
    })
  }
})

const unregisterTrafficHandler = kernelApiStore.onTraffic((data) => {
  const { up, down } = data
  statistics.value.upload = up
  statistics.value.download = down

  trafficHistory.value[0].push(up)
  trafficHistory.value[1].push(down)

  if (trafficHistory.value[0].length > 60) {
    trafficHistory.value[0].shift()
    trafficHistory.value[1].shift()
  }
})

const unregisterConnectionsHandler = kernelApiStore.onConnections((data) => {
  statistics.value.downloadTotal = data.downloadTotal
  statistics.value.uploadTotal = data.uploadTotal
  statistics.value.connections = data.connections || []
  updateDisplayedMemoryUsage(data.memory)
})

onUnmounted(() => {
  unregisterMemoryHandler()
  unregisterTrafficHandler()
  unregisterConnectionsHandler()
})
</script>

<template>
  <div class="home-overview">
    <div class="overview-toolbar flex items-center rounded-12 px-12 py-8">
      <Button
        v-tips="'home.overview.settings'"
        :aria-label="t('home.overview.settings')"
        type="text"
        size="small"
        icon="settings"
        @click="handleShowSettings"
      />
      <Switch
        v-model="kernelApiStore.config.tun.enable"
        size="small"
        border="square"
        class="ml-4"
        @change="onTunSwitchChange"
      >
        {{ t('home.overview.tunMode') }}
      </Switch>
      <Button
        v-if="activeProfileName"
        v-tips="'common.activeProfile'"
        type="text"
        size="small"
        icon="profiles"
        class="profile-chip"
        @click="router.push('/profiles')"
      >
        {{ activeProfileName }}
      </Button>
      <CustomAction :actions="appStore.customActions.core_state" />
      <div class="ml-auto flex items-center gap-4">
        <Button
          type="text"
          size="small"
          icon="overview"
          @click="emit('open-groups')"
        >
          {{ t('home.overview.allGroups') }}
        </Button>
        <Button
          v-tips="'home.overview.viewlog'"
          :aria-label="t('home.overview.viewlog')"
          type="text"
          size="small"
          icon="log"
          @click="handleShowApiLogs"
        />
        <Button
          v-tips="'home.overview.restart'"
          :aria-label="t('home.overview.restart')"
          :loading="kernelApiStore.restarting"
          type="text"
          size="small"
          icon="restart"
          @click="handleRestartKernel"
        />
        <Button
          v-tips="'home.overview.stop'"
          :aria-label="t('home.overview.stop')"
          :loading="kernelApiStore.stopping"
          type="text"
          size="small"
          icon="stop"
          icon-color="var(--danger-color)"
          class="stop-btn"
          @click="handleStopKernel"
        />
      </div>
    </div>

    <div class="home-stats overview-cards grid mt-16 gap-12">
      <div class="overview-node-slot">
        <CurrentNodeCard />
      </div>
      <Card
        :title="t('home.overview.realtimeTraffic')"
        class="home-stat-card home-stat-card--realtime"
      >
        <div class="home-stat-card__value flex flex-col gap-4 py-4">
          <span class="metric metric--upload">↑ {{ formatBytes(statistics.upload) }}/s</span>
          <span class="metric metric--download">↓ {{ formatBytes(statistics.download) }}/s</span>
        </div>
      </Card>
      <Card
        :title="t('home.overview.totalTraffic')"
        class="home-stat-card home-stat-card--total"
      >
        <div class="home-stat-card__value flex flex-col gap-4 py-4">
          <span class="metric metric--upload">↑ {{ formatBytes(statistics.uploadTotal) }}</span>
          <span class="metric metric--download">↓ {{ formatBytes(statistics.downloadTotal) }}</span>
        </div>
      </Card>
      <Card
        :title="t('home.overview.connections')"
        interactive
        class="home-stat-card home-stat-card--connections"
        @click="handleShowApiConnections"
      >
        <template #extra>
          <Icon icon="arrowRight" :size="14" color="var(--muted-color)" />
        </template>
        <div class="home-stat-card__value py-4">
          {{ statistics.connections.length }}
        </div>
        <div class="text-12 text-muted">{{ t('home.overview.clickToInspect') }}</div>
      </Card>
      <Card
        :title="t('home.overview.memory')"
        interactive
        class="home-stat-card home-stat-card--memory"
        @click="handleToggleRealMemoryUsage"
      >
        <div class="home-stat-card__value py-4">
          {{ formatBytes(statistics.inuse) }}
          <span v-if="appSettings.app.kernel.realMemoryUsage" class="text-13 text-muted font-normal">
            / {{ formatBytes(statistics.memUsage) }}
          </span>
        </div>
        <div class="text-12 text-muted">{{ t('home.overview.clickToToggleMemory') }}</div>
      </Card>
    </div>

    <div class="home-dashboard flex gap-16 mt-16">
      <div class="traffic-panel flex-1 min-w-0">
        <div class="traffic-panel__title pb-10 font-bold" style="color: var(--card-color)">
          {{ t('home.overview.traffic') }}
        </div>
        <TrafficChart
          :series="trafficHistory"
          :legend="[t('home.overview.transmit'), t('home.overview.receive')]"
        />
      </div>
      <div class="mode-panel">
        <div class="mode-panel__title pb-10 font-bold" style="color: var(--card-color)">
          {{ t('kernel.mode') }}
        </div>
        <div class="mode-panel__list flex flex-col gap-10">
          <Card
            v-for="mode in ModeOptions"
            :key="mode.value"
            :selected="kernelApiStore.config.mode === mode.value"
            :title="t(mode.label)"
            interactive
            :class="['home-mode-card', `home-mode-card--${String(mode.value).toLowerCase()}`]"
            @click="handleChangeMode(mode.value as any)"
          >
            <div class="text-12 text-muted py-2">{{ t(mode.desc) }}</div>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.overview-toolbar {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  flex-wrap: wrap;
  gap: 8px;
}

.profile-chip {
  color: var(--muted-color);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stop-btn:hover {
  background-color: var(--danger-soft);
}

.overview-cards {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.overview-node-slot {
  grid-column: span 2;
  min-width: 0;
}

.home-stat-card__value {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
}

.metric--upload {
  color: #8851e3;
}

.metric--download {
  color: #2e9ae5;
}

.mode-panel {
  width: 340px;
  flex-shrink: 0;
}

@media (max-width: 1100px) {
  .overview-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .overview-node-slot {
    grid-column: span 2;
  }
}

@media (max-width: 860px) {
  .home-dashboard {
    flex-direction: column;
  }
  .mode-panel {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .overview-cards {
    grid-template-columns: minmax(0, 1fr);
  }
  .overview-node-slot {
    grid-column: span 1;
  }
}
</style>
