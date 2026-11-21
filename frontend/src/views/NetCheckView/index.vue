<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { useNodeController } from '@/views/HomeView/useNodeController'
import NetCheckGroupCard from '@/views/NetCheckView/components/NetCheckGroupCard.vue'
import NodeDiagnosticsPanel from '@/views/NetCheckView/components/NodeDiagnosticsPanel.vue'
import { useRuntimeNetworkCheck } from '@/views/NetCheckView/useRuntimeNetworkCheck'
import { useRuntimeNodeDetails } from '@/views/NetCheckView/useRuntimeNodeDetails'

const { t, te } = useI18n()
const kernelApiStore = useKernelApiStore()
const nodeController = useNodeController()
const networkCheck = useRuntimeNetworkCheck()
const runError = ref('')

const coreReady = computed(() => kernelApiStore.running)
const runtimeNode = useRuntimeNodeDetails(
  coreReady,
  computed(() => nodeController.primary.value.leafName || ''),
  computed(() => kernelApiStore.proxies || {}),
)

const renderText = (value?: string) => {
  if (!value) return ''
  return te(value) ? t(value) : value
}

const syncNodeController = async (running: boolean) => {
  if (!running) {
    nodeController.stopPolling()
    return
  }

  nodeController.startPolling()
  await Promise.resolve(nodeController.prepareModal()).catch(() => undefined)
}

const handleRun = async () => {
  if (networkCheck.running.value) return
  runError.value = ''

  try {
    await networkCheck.run()
    if (kernelApiStore.running) {
      await Promise.resolve(nodeController.refresh()).catch(() => undefined)
      await runtimeNode.refresh()
    }
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  }
}

const clearResults = () => {
  runError.value = ''
  networkCheck.clear()
}

onMounted(() => {
  void syncNodeController(kernelApiStore.running)
})

watch(
  () => kernelApiStore.running,
  (running) => {
    void syncNodeController(running)
  },
)

onUnmounted(() => {
  nodeController.stopPolling()
})
</script>

<template>
  <div class="net-check flex flex-col gap-16 pb-16">
    <Card>
      <div class="flex flex-col gap-10 py-14">
        <div class="text-13 text-muted">
          {{ t('netCheck.target.description') }}
        </div>
        <div class="flex flex-wrap items-center gap-8">
          <Input
            v-model="networkCheck.input.value"
            clearable
            :placeholder="t('netCheck.target.placeholder')"
            class="flex-1 min-w-240"
            @keydown.enter="handleRun"
          />
          <Button
            data-action="run-check"
            type="primary"
            icon="speedTest"
            :loading="networkCheck.running.value"
            @click="handleRun"
          >
            {{ t('netCheck.actions.run') }}
          </Button>
          <Button
            :disabled="networkCheck.running.value || networkCheck.groups.value.length === 0"
            @click="clearResults"
          >
            {{ t('netCheck.actions.clear') }}
          </Button>
        </div>
        <div v-if="runError" role="alert" class="net-check__error rounded-8 px-12 py-8 text-12">
          {{ renderText(runError) }}
        </div>
      </div>
    </Card>

    <Card :title="t('netCheck.results.title')">
      <div v-if="networkCheck.groups.value.length === 0" class="py-16 text-center text-13 text-muted">
        {{ t('netCheck.results.empty') }}
      </div>
      <div v-else class="flex flex-col gap-12">
        <NetCheckGroupCard
          v-for="group in networkCheck.groups.value"
          :key="group.id"
          :group="group"
          :running="networkCheck.running.value"
        />
      </div>
    </Card>

    <NodeDiagnosticsPanel
      :controller="nodeController"
      :core-ready="coreReady"
      :runtime-details="runtimeNode.details.value"
      :runtime-unavailable="runtimeNode.unavailable.value"
    />
  </div>
</template>

<style lang="less" scoped>
.net-check__error {
  color: var(--danger-color);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent);
}
</style>
