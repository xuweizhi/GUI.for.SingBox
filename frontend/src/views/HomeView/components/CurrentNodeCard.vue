<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { message } from '@/utils'
import { delayColor, isDelayTestableNode } from '@/views/HomeView/nodeController'
import { useNodeController } from '@/views/HomeView/useNodeController'

import NodeSelectorModal from './NodeSelectorModal.vue'

const props = withDefaults(defineProps<{ active?: boolean }>(), {
  active: true,
})

const open = ref(false)
const mountedActive = ref(false)
const controller = useNodeController({ persistPreferences: true })
const kernelApiStore = useKernelApiStore()
const { t, te } = useI18n()
const { mode, primary, stale } = controller

const displayChain = computed(() => primary.value.chain.join(' → '))

const testCurrentNode = async () => {
  const result = await controller.testNode(primary.value.leafName)
  if (!result.ok) message.error(te(result.error) ? t(result.error) : result.error)
}

const openSelector = () => {
  if (!kernelApiStore.running) {
    message.warn('home.nodes.startCoreFirst')
    return
  }
  open.value = true
}

const syncPolling = () => {
  if (mountedActive.value && props.active && kernelApiStore.running) {
    controller.startPolling()
  } else {
    controller.stopPolling()
  }
}

const start = () => {
  mountedActive.value = true
  syncPolling()
}

const stop = () => {
  mountedActive.value = false
  controller.stopPolling()
}

onMounted(start)
onActivated(start)
onDeactivated(stop)
onUnmounted(stop)

watch(
  [() => kernelApiStore.running, () => props.active],
  ([running]) => {
    if (!running) open.value = false
    syncPolling()
  },
)
</script>

<template>
  <div
    data-current-node
    role="button"
    tabindex="0"
    class="current-node-wrapper h-full"
    :aria-label="t('home.nodes.openSelector')"
    @click="openSelector"
    @keydown.enter.self.prevent="openSelector"
    @keydown.space.self.prevent="openSelector"
  >
    <Card :title="t('home.nodes.current')" :interactive="kernelApiStore.running" class="h-full">
      <template #extra>
        <div class="current-node-extra flex items-center gap-6">
          <Tag v-if="kernelApiStore.running" size="small" color="blue">
            {{ t(`home.nodes.mode.${mode}`) }}
          </Tag>
          <span v-if="stale" class="text-12 text-danger">
            {{ t('home.nodes.stale') }}
          </span>
          <span
            v-if="primary.delay"
            class="text-12 font-bold"
            :style="{ color: delayColor(primary.delay) }"
          >
            {{ primary.delay }} ms
          </span>
          <span
            v-else-if="controller.nodeErrors.value.has(primary.leafName)"
            class="text-12 text-danger"
          >
            {{ t('home.nodes.unavailable') }}
          </span>
          <Button
            v-if="isDelayTestableNode(primary.leafName, primary.leaf)"
            icon="speedTest"
            :aria-label="t('workspace.testDelay')"
            type="text"
            size="small"
            :loading="controller.testingNodes.value.has(primary.leafName)"
            @click.stop="testCurrentNode"
          />
          <span v-if="kernelApiStore.running" class="current-node-switch text-12 text-muted">{{
            t('home.nodes.switchNode')
          }}</span>
          <Icon
            v-if="kernelApiStore.running"
            icon="arrowRight"
            :size="14"
            color="var(--muted-color)"
          />
        </div>
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
        <div class="flex min-w-0 items-center gap-6">
          <div class="font-bold text-16 line-clamp-1">
            {{ primary.leafName }}
          </div>
          <Tag v-if="primary.leaf?.type" size="small" color="blue">{{
            primary.leaf.type
          }}</Tag>
        </div>
        <div v-tips="displayChain" class="text-12 text-muted line-clamp-1 mt-4">
          {{ t('home.nodes.via') }} {{ displayChain }}
        </div>
      </div>
    </Card>
  </div>

  <NodeSelectorModal v-model:open="open" :controller="controller" />
</template>

<style scoped>
.current-node-wrapper :deep(.gui-card__header) {
  flex-wrap: wrap;
}
.current-node-extra {
  flex-wrap: wrap;
  justify-content: flex-end;
}
@container (max-width: 640px) {
  .current-node-switch {
    display: none;
  }
}
</style>
