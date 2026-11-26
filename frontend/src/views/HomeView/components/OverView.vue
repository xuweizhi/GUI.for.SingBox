<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { GetSystemProxy, ProcessMemory } from '@/bridge'
import { ModeOptions } from '@/constant/kernel'
import { useKernelApiStore, useAppSettingsStore } from '@/stores'
import { formatBytes, handleChangeMode, message, modal } from '@/utils'

import CommonController from './CommonController.vue'
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

const openSettings = () =>
  modal({
    title: 'home.overview.settings',
    size: 'md',
    submit: false,
    cancelText: 'common.close',
    maskClosable: true,
  })
    .setContent(CommonController)
    .open()
const setTun = async (enable: boolean) => {
  try {
    await kernelApiStore.updateConfig('tun', { enable })
  } catch (error) {
    if (kernelApiStore.running) kernelApiStore.config.tun.enable = !enable
    message.error(error)
  }
}
const modeKey = ref(0)
const onModeChange = async (mode: 'direct' | 'global' | 'rule') => {
  try {
    await handleChangeMode(mode)
  } catch (error) {
    modeKey.value++
    message.error(error)
  }
}
const handleToggleRealMemoryUsage = () => {
  appSettings.app.kernel.realMemoryUsage = !appSettings.app.kernel.realMemoryUsage
}

const hasSystemProxy = ref<boolean>()
onMounted(async () => {
  try {
    hasSystemProxy.value = Boolean(await GetSystemProxy())
  } catch {
    /* The host may not report a proxy. */
  }
})
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
    <div class="hero-grid mb-16">
      <CurrentNodeCard />
      <Card :title="t('kernel.mode')">
        <Radio
          :key="kernelApiStore.config.mode + '-' + modeKey"
          :model-value="kernelApiStore.config.mode"
          :options="ModeOptions"
          @change="onModeChange"
        />
        <div class="flex flex-wrap items-center gap-8 mt-12">
          <Switch v-model="kernelApiStore.config.tun.enable" @change="setTun">{{
            t('home.overview.tunMode')
          }}</Switch>
          <span v-if="hasSystemProxy !== undefined" class="text-secondary text-12"
            >{{ t('settings.systemProxy') }} ·
            {{ t(hasSystemProxy ? 'common.enabled' : 'common.disabled') }}</span
          >
          <Button size="small" icon="settings" @click="openSettings">{{
            t('home.overview.settings')
          }}</Button>
        </div>
        <div class="flex flex-wrap gap-6 mt-12">
          <Button size="small" @click="emit('open-groups')">{{
            t('home.overview.allGroups')
          }}</Button>
          <Button size="small" @click="emit('open-logs')">{{ t('home.overview.logs') }}</Button>
        </div>
      </Card>
    </div>
    <div class="home-stats overview-cards grid gap-12">
      <Card
        :title="t('home.overview.realtimeTraffic')"
        class="home-stat-card home-stat-card--realtime"
      >
        <div class="home-stat-card__value flex flex-col gap-4 py-4 font-mono">
          <span class="metric metric--upload">↑ {{ formatBytes(statistics.upload) }}/s</span>
          <span class="metric metric--download">↓ {{ formatBytes(statistics.download) }}/s</span>
        </div>
      </Card>
      <Card :title="t('home.overview.totalTraffic')" class="home-stat-card home-stat-card--total">
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
        <template #extra>
          <Tag size="small" :color="appSettings.app.kernel.realMemoryUsage ? 'green' : 'default'">
            {{ t(appSettings.app.kernel.realMemoryUsage ? 'common.enabled' : 'common.disabled') }}
          </Tag>
        </template>
        <div class="home-stat-card__value py-4 font-mono">
          {{ formatBytes(statistics.inuse) }}
          <span
            v-if="appSettings.app.kernel.realMemoryUsage"
            class="text-13 text-muted font-normal"
          >
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
        </div>
        <TrafficChart
          :series="trafficHistory"
          :legend="[t('home.overview.transmit'), t('home.overview.receive')]"
        />
        <div class="flex items-center justify-between text-12 text-secondary mt-6">
          {{ t('workspace.trafficSamples', [60]) }}
          <Button size="small" type="text" icon="reset" @click="trafficHistory = [[], []]">{{
            t('common.reset')
          }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.overview-cards {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--grid-gap, 12px);
}

.home-stat-card {
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    opacity: 0.85;
    pointer-events: none;
  }

  &--realtime::before {
    background: linear-gradient(90deg, #8b5cf6, #38bdf8);
  }

  &--total::before {
    background: linear-gradient(90deg, var(--primary-color), #06b6d4);
  }

  &--connections::before {
    background: linear-gradient(90deg, #10b981, #34d399);
  }

  &--memory::before {
    background: linear-gradient(90deg, #f59e0b, #fb7185);
  }
}

.home-stat-card__value {
  font-size: calc(16px * var(--font-scale, 1));
  font-weight: 650;
  line-height: 1.4;
}

.metric--upload {
  color: #8b5cf6;
}

.metric--download {
  color: #0ea5e9;
}

.hero-grid {
  display: grid;
  grid-template-columns: 7fr 5fr;
  gap: var(--grid-gap);
}
@container (max-width: 1024px) {
  .overview-cards {
    grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  }
}
@container (max-width: 640px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
}
</style>
