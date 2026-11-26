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
const testedNode = ref('')
const checkedAt = ref<Date>()
const currentNode = computed(() => nodeController.primary.value.leafName || '')
const totals = computed(() => {
  const items = networkCheck.groups.value.flatMap((g) => g.items)
  return {
    passed: items.filter((i) => i.status === 'success').length,
    failed: items.filter((i) => i.status === 'failed').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
  }
})

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

  const initialNode = currentNode.value
  try {
    testedNode.value = (await networkCheck.run()) ?? initialNode
    checkedAt.value = new Date()
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
  testedNode.value = ''
  checkedAt.value = undefined
  networkCheck.clear()
}
const verdictColor = computed(() => {
  if (networkCheck.running.value) return 'blue'
  if (totals.value.failed || !totals.value.passed) return 'red'
  return 'green'
})

const active = ref(false)
const activate = () => {
  active.value = true
}
const deactivate = () => {
  active.value = false
}
onMounted(activate)
onActivated(activate)
onDeactivated(deactivate)
watch(
  () => active.value && kernelApiStore.running,
  (running) => void syncNodeController(running),
)
onUnmounted(() => nodeController.stopPolling())
</script>

<template>
  <div class="net-check flex flex-col gap-16 pb-16">
    <Card>
      <div class="flex flex-col gap-10">
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

    <section
      v-if="checkedAt && networkCheck.groups.value.length"
      class="net-check__verdict surface-panel p-12"
      aria-live="polite"
    >
      <div class="flex flex-wrap items-center gap-8">
        <Tag size="small" :color="verdictColor">
          {{
            t(
              networkCheck.running.value
                ? 'netCheck.status.running'
                : totals.failed || !totals.passed
                  ? 'workspace.issues'
                  : 'workspace.passed',
            )
          }}
        </Tag>
        <strong>{{
          t(
            networkCheck.running.value
              ? 'netCheck.status.running'
              : totals.failed || !totals.passed
                ? 'workspace.issues'
                : 'workspace.passed',
          )
        }}</strong>
        <span class="text-12 text-muted"
          >{{ t('workspace.tested') }} {{ testedNode || t('common.none') }} ·
          {{ checkedAt.toLocaleTimeString() }}</span
        >
      </div>
      <div class="text-12 text-secondary mt-4">
        {{ t('netCheck.summary.groupCountSuccess', [totals.passed]) }} ·
        {{ t('netCheck.summary.groupCountFailed', [totals.failed]) }} ·
        {{ t('netCheck.summary.groupCountSkipped', [totals.skipped]) }}
      </div>
      <div
        v-if="!networkCheck.running.value && testedNode && currentNode !== testedNode"
        class="net-check__stale mt-8"
      >
        <span>{{ t('workspace.nodeChanged', [currentNode || t('common.none'), testedNode]) }}</span>
        <Button size="small" :disabled="networkCheck.running.value" @click="handleRun">{{
          t('netCheck.actions.run')
        }}</Button>
      </div>
    </section>
    <div class="net-check__grid">
      <section class="net-check__results">
        <div class="text-16 font-bold mb-12">{{ t('netCheck.results.title') }}</div>
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
      </section>

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
.net-check__verdict {
  border-color: var(--surface-border);
}
.net-check__stale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: var(--danger-color);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent);
  border-radius: var(--control-radius);
  font-size: calc(12px * var(--font-scale, 1));
}

@container (max-width: 1024px) {
  .net-check__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
