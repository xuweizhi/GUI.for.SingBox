<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { useNodeController } from '@/views/HomeView/useNodeController'
import NodeDiagnosticsPanel from '@/views/NetCheckView/components/NodeDiagnosticsPanel.vue'
import { useRuntimeNetworkCheck } from '@/views/NetCheckView/useRuntimeNetworkCheck'

const { t, te } = useI18n()
const kernelApiStore = useKernelApiStore()
const nodeController = useNodeController()
const networkCheck = useRuntimeNetworkCheck()
const runError = ref('')

const coreReady = computed(() => kernelApiStore.running)

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
  runError.value = ''

  try {
    await networkCheck.run()
    if (kernelApiStore.running) {
      await Promise.resolve(nodeController.refresh()).catch(() => undefined)
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
  <div class="net-check flex flex-col gap-12 p-12">
    <Card :title="t('router.netcheck')">
      <div class="flex flex-col gap-8">
        <div class="text-12">
          {{ t('netCheck.target.description') }}
        </div>
        <div class="flex flex-wrap items-center gap-8">
          <Input v-model="networkCheck.input.value" class="flex-1 min-w-240" />
          <Button
            data-action="run-check"
            type="primary"
            icon="speedTest"
            :disabled="networkCheck.running.value"
            @click="handleRun"
          >
            {{ t('netCheck.actions.run') }}
          </Button>
          <Button :disabled="networkCheck.running.value" @click="clearResults">
            {{ t('netCheck.actions.clear') }}
          </Button>
        </div>
        <div v-if="runError" class="text-12">
          {{ renderText(runError) }}
        </div>
      </div>
    </Card>

    <Card :title="t('netCheck.results.title')">
      <div v-if="networkCheck.results.value.length === 0" class="text-12">
        {{ t('netCheck.results.empty') }}
      </div>
      <div v-else class="flex flex-col gap-8">
        <div
          v-for="item in networkCheck.results.value"
          :key="item.id"
          class="result-item rounded-8 p-8"
          :data-result="item.id"
        >
          <div class="font-bold">
            {{ renderText(item.title) }}
          </div>
          <div class="text-12 mt-4">
            {{ renderText(item.summary) }}
          </div>
          <div v-if="item.detail" class="text-12 mt-4">
            {{ renderText(item.detail) }}
          </div>
          <div v-if="item.durationMs !== undefined" class="text-12 mt-4">
            {{ t('netCheck.results.duration', [item.durationMs]) }}
          </div>
        </div>
      </div>
    </Card>

    <NodeDiagnosticsPanel :controller="nodeController" :core-ready="coreReady" />
  </div>
</template>

<style scoped lang="less">
.result-item {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--card-bg, #fff);
}
</style>
