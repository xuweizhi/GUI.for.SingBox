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
const { primary, stale } = controller

const displayChain = computed(() => primary.value.chain.join(' -> '))

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
    <Card :title="t('home.nodes.current')" class="h-full cursor-pointer">
      <template #extra>
        <span v-if="stale" class="text-12 mr-4">
          {{ t('home.nodes.stale') }}
        </span>
        <span v-if="primary.delay" class="text-12"> {{ primary.delay }} ms </span>
      </template>

      <div v-if="!kernelApiStore.running" class="py-8 text-12">
        {{ t('home.nodes.coreUnavailable') }}
      </div>
      <div v-else-if="primary.kind === 'unavailable'" class="py-8 text-12">
        {{ t('home.nodes.noSelectableNode') }}
      </div>
      <div v-else-if="primary.error" class="py-8 text-12">
        {{ t('home.nodes.invalidChain') }}
      </div>
      <div v-else class="py-8 min-w-0">
        <div class="font-bold line-clamp-1">
          {{ primary.groupName }}
        </div>
        <div v-tips="displayChain" class="text-12 line-clamp-1 mt-4">
          {{ displayChain }}
        </div>
      </div>
    </Card>
  </div>

  <NodeSelectorModal v-model:open="open" :controller="controller" />
</template>
