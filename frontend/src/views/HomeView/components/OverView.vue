<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { ProcessMemory } from '@/bridge'
import { ModeOptions } from '@/constant/kernel'
import { useKernelApiStore, useAppSettingsStore } from '@/stores'
import { formatBytes, handleChangeMode } from '@/utils'

import CurrentNodeCard from './CurrentNodeCard.vue'

const emit = defineEmits<{
  'open-groups': []
  'open-connections': []
  'open-logs': []
  'connections-count': [count: number]
}>()

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
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()

const handleToggleRealMemoryUsage = () => {
  appSettings.app.kernel.realMemoryUsage = !appSettings.app.kernel.realMemoryUsage
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
  emit('connections-count', statistics.value.connections.length)
  updateDisplayedMemoryUsage(data.memory)
})

onUnmounted(() => {
  unregisterMemoryHandler()
  unregisterTrafficHandler()
  unregisterConnectionsHandler()
})
</script>

<template>
  <div class="home-overview pb-16">
    <div class="home-stats overview-cards grid gap-12">
      <div class="overview-node-slot">
        <CurrentNodeCard />
      </div>
      <Card
        :title="t('home.overview.realtimeTraffic')"
        class="home-stat-card home-stat-card--realtime"
      >
        <div class="home-stat-card__value flex flex-col gap-4 py-4 font-mono">
          <span class="metric metric--upload">↑ {{ formatBytes(statistics.upload) }}/s</span>
          <span class="metric metric--download">↓ {{ formatBytes(statistics.download) }}/s</span>
        </div>
      </Card>
      <Card
        :title="t('home.overview.totalTraffic')"
        class="home-stat-card home-stat-card--total"
      >
        <div class="home-stat-card__value flex flex-col gap-4 py-4 font-mono">
          <span class="metric metric--upload">↑ {{ formatBytes(statistics.uploadTotal) }}</span>
          <span class="metric metric--download">↓ {{ formatBytes(statistics.downloadTotal) }}</span>
        </div>
      </Card>
      <Card
        :title="t('home.overview.connections')"
        interactive
        class="home-stat-card home-stat-card--connections"
        @click="emit('open-connections')"
      >
        <template #extra>
          <Icon icon="arrowRight" :size="14" color="var(--muted-color)" />
        </template>
        <div class="home-stat-card__value py-4 font-mono">
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
        <div class="home-stat-card__value py-4 font-mono">
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
        <div class="flex items-center justify-between pb-10">
          <div class="font-bold" style="color: var(--card-color)">
            {{ t('home.overview.traffic') }}
          </div>
          <Button type="link" size="small" @click="emit('open-logs')">
            {{ t('home.overview.logs') }}
          </Button>
        </div>
        <TrafficChart
          :series="trafficHistory"
          :legend="[t('home.overview.transmit'), t('home.overview.receive')]"
        />
      </div>
      <div class="mode-panel">
        <div class="flex items-center justify-between pb-10">
          <div class="font-bold" style="color: var(--card-color)">
            {{ t('kernel.mode') }}
          </div>
          <Button type="link" size="small" @click="emit('open-groups')">
            {{ t('home.overview.allGroups') }}
          </Button>
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
.overview-cards {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.overview-node-slot {
  grid-column: span 2;
  min-width: 0;
}

.home-stat-card__value {
  font-size: 16px;
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
