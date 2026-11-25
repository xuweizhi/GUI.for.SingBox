<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { message } from '@/utils'
import { useNodeController } from '@/views/HomeView/useNodeController'

import NodeSelectorModal from './NodeSelectorModal.vue'

const open = ref(false)
const active = ref(false)
const controller = useNodeController()
const kernelApiStore = useKernelApiStore()
const { t } = useI18n()
const { mode, primary, stale } = controller

const displayChain = computed(() => primary.value.chain.join(' → '))

const delayColor = computed(() => {
  const delay = primary.value.delay
  if (!delay) return 'var(--muted-color)'
  if (delay < 500) return 'var(--level-1-color)'
  if (delay < 1000) return 'var(--level-2-color)'
  return 'var(--level-3-color)'
})

const openSelector = () => {
  if (!kernelApiStore.running) {
    message.warn('home.nodes.startCoreFirst')
    return
  }
  open.value = true
}

const start = () => {
  active.value = true
  if (kernelApiStore.running) {
    controller.startPolling()
  } else {
    controller.stopPolling()
  }
}

const stop = () => {
  active.value = false
  controller.stopPolling()
}

onMounted(start)
onActivated(start)
onDeactivated(stop)
onUnmounted(stop)

watch(
  () => kernelApiStore.running,
  (running) => {
    if (!active.value) return
    if (running) {
      controller.startPolling()
    } else {
      open.value = false
      controller.stopPolling()
    }
  },
)
</script>

<template>
  <div
    data-current-node
    role="button"
    tabindex="0"
    class="h-full"
    :aria-label="t('home.nodes.openSelector')"
    @click="openSelector"
    @keydown.enter.prevent="openSelector"
    @keydown.space.prevent="openSelector"
  >
    <Card :title="t('home.nodes.current')" :interactive="kernelApiStore.running" class="h-full">
      <template #extra>
        <Tag v-if="kernelApiStore.running" size="small" color="blue">
          {{ t(`home.nodes.mode.${mode}`) }}
        </Tag>
        <span v-if="stale" class="text-12 text-danger">
          {{ t('home.nodes.stale') }}
        </span>
        <span
          v-if="primary.delay"
          class="text-12 font-bold"
          :style="{ color: delayColor }"
        >
          {{ primary.delay }} ms
        </span>
        <span v-else-if="controller.nodeErrors.value.has(primary.leafName)" class="text-12 text-danger">
          {{ t('home.nodes.unavailable') }}
        </span>
        <Icon v-if="kernelApiStore.running" icon="arrowRight" :size="14" color="var(--muted-color)" />
      </template>

      <div v-if="!kernelApiStore.running" class="py-6 text-12 text-muted">
        {{ t('home.nodes.coreUnavailable') }}
      </div>
      <div v-else-if="primary.kind === 'unavailable'" class="py-6 text-12 text-muted">
        {{ t('home.nodes.noSelectableNode') }}
      </div>
      <div v-else-if="primary.error" class="py-6 text-12 text-danger">
        {{ t('home.nodes.invalidChain') }}
      </div>
      <div v-else class="py-4 min-w-0">
        <div class="font-bold text-16 line-clamp-1">
          {{ primary.leafName }}
        </div>
        <div v-tips="displayChain" class="text-12 text-muted line-clamp-1 mt-4">
          {{ t('home.nodes.via') }} {{ displayChain }}
        </div>
      </div>
    </Card>
  </div>

  <NodeSelectorModal v-model:open="open" :controller="controller" />
</template>
