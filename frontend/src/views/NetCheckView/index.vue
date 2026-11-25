<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { useNodeController } from '@/views/HomeView/useNodeController'
import NetCheckGroupCard from '@/views/NetCheckView/components/NetCheckGroupCard.vue'
import NodeDiagnosticsPanel from '@/views/NetCheckView/components/NodeDiagnosticsPanel.vue'
import { useRuntimeNetworkCheck } from '@/views/NetCheckView/useRuntimeNetworkCheck'
import { useRuntimeNodeDetails } from '@/views/NetCheckView/useRuntimeNodeDetails'

const { t, te } = useI18n()
const kernelApiStore = useKernelApiStore()
const nodeController = useNodeController({ includePolicyNodes: true })
const networkCheck = useRuntimeNetworkCheck()
const runError = ref('')

const presetTargets = [
  { label: 'gstatic 204', value: 'https://www.gstatic.com/generate_204' },
  { label: 'Cloudflare', value: 'https://cp.cloudflare.com' },
  { label: 'GitHub', value: 'https://github.com' },
] as const

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

const applyPreset = (target: string) => {
  networkCheck.input.value = target
  void handleRun()
}

const clearResults = () => {
  runError.value = ''
  networkCheck.clear()
}

const active = ref(false)
const activate = () => { active.value = true }
const deactivate = () => { active.value = false }
onMounted(activate)
onActivated(activate)
onDeactivated(deactivate)
watch(() => active.value && kernelApiStore.running, (running) => void syncNodeController(running))
onUnmounted(() => nodeController.stopPolling())
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
        <div class="flex flex-wrap items-center gap-6">
          <Button
            v-for="preset in presetTargets"
            :key="preset.value"
            type="text"
            size="small"
            class="preset-chip"
            :disabled="networkCheck.running.value"
            @click="applyPreset(preset.value)"
          >
            {{ preset.label }}
          </Button>
        </div>
        <div v-if="runError" role="alert" class="net-check__error rounded-8 px-12 py-8 text-12">
          {{ renderText(runError) }}
        </div>
      </div>
    </Card>

    <div class="net-check__grid">
      <Card :title="t('netCheck.results.title')">
        <div
          v-if="networkCheck.groups.value.length === 0"
          class="py-24 text-center text-13 text-muted"
        >
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
  </div>
</template>

<style lang="less" scoped>
.net-check__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 1fr);
  gap: 16px;
  align-items: start;
}

.preset-chip {
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--muted-color);
  border-radius: 999px;
  padding: 2px 10px;
}

.net-check__error {
  color: var(--danger-color);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent);
}

@media (max-width: 1040px) {
  .net-check__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
