<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import { delayColor } from '@/utils/nodeDelay'

import NodeCard from '@/components/_common/NodeCard.vue'

import type { NodeController } from '@/views/HomeView/useNodeController'

import type { RuntimeNodeDetails } from '../runtimeNodeDetails'

const props = defineProps<{
  controller: NodeController
  coreReady: boolean
  runtimeDetails?: RuntimeNodeDetails
  runtimeUnavailable?: boolean
}>()

const { t, te } = useI18n()
const renderText = (value?: string) => {
  if (!value) return ''
  return typeof te === 'function' ? (te(value) ? t(value) : value) : t(value)
}
const nodeFilter = ref('')
const operationError = ref('')
const readonlyNotice = computed(() => {
  if (props.controller.readonlyMode?.value) return t('home.nodes.directReadonly')
  if (
    props.controller.selectedGroup.value &&
    props.controller.selectedGroup.value.type !== 'Selector'
  ) {
    return t('home.nodes.urlTestReadonly')
  }
  return ''
})
const batchPercent = computed(() => {
  const { completed, total } = props.controller.batch.value
  return total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
})
watch(
  () => props.controller.selectedGroupName.value,
  () => {
    nodeFilter.value = ''
    operationError.value = ''
  },
)

const filteredNodes = computed(() => {
  const q = nodeFilter.value.trim().toLowerCase()
  if (!q || props.controller.nodes.value.length <= 6) return props.controller.nodes.value
  return props.controller.nodes.value.filter(
    (node) =>
      node.name.toLowerCase().includes(q) || (node.proxy?.type || '').toLowerCase().includes(q),
  )
})

const switchNode = async (name: string) => {
  const result = await props.controller.switchNode(name)
  operationError.value = result.ok ? '' : result.error
}

const testNode = async (name: string) => {
  const result = await props.controller.testNode(name)
  operationError.value = result.ok ? '' : result.error
}

const groupOptions = computed(() =>
  props.controller.groups.value.map((group) => ({ label: group.name, value: group.name })),
)

const displayChain = computed(() => {
  const primary = props.controller.primary.value
  return primary.chain.join(' → ')
})

watchEffect(() => {
  if (!props.coreReady) return
  if (props.controller.selectedGroupName.value) return

  const primary = props.controller.primary.value
  const fallback =
    primary.kind === 'group' ? primary.groupName : props.controller.groups.value[0]?.name || ''

  fallback && props.controller.selectGroup(fallback)
})
</script>

<template>
  <Card :title="t('netCheck.node.title')">
    <template #extra>
      <Button
        v-if="coreReady && !controller.batch.value.running"
        data-action="test-group"
        icon="speedTest"
        size="small"
        type="primary"
        @click="controller.testGroup()"
      >
        {{ t('netCheck.node.testGroup') }}
      </Button>
      <Button
        v-else-if="coreReady"
        data-action="cancel-group-test"
        size="small"
        @click="controller.cancelGroupTest()"
      >
        {{ t('common.cancel') }}
      </Button>
    </template>

    <div v-if="!coreReady" class="py-8 text-13 text-muted">
      {{ t('netCheck.node.coreUnavailable') }}
    </div>
    <template v-else>
      <div class="node-diag-summary rounded-8 p-12 mb-12">
        <div class="flex flex-wrap items-center justify-between gap-8">
          <div
            class="font-bold text-15 line-clamp-1"
            :title="
              controller.primary.value.leafName ||
              controller.primary.value.groupName ||
              t('home.nodes.noSelectableNode')
            "
          >
            {{
              controller.primary.value.leafName ||
              controller.primary.value.groupName ||
              t('home.nodes.noSelectableNode')
            }}
          </div>
          <div
            v-if="controller.primary.value.delay"
            class="text-12 font-bold font-mono"
            :style="{ color: delayColor(controller.primary.value.delay) }"
          >
            {{ controller.primary.value.delay }} ms
          </div>
        </div>
        <div
          v-if="controller.primary.value.groupName"
          class="text-12 text-muted mt-4 line-clamp-1"
          :title="controller.primary.value.groupName"
        >
          {{ t('home.overview.tabGroups') }}: {{ controller.primary.value.groupName }}
        </div>
        <div
          v-if="displayChain"
          class="text-12 text-muted mt-4 font-mono line-clamp-1"
          :title="displayChain"
        >
          {{ displayChain }}
        </div>
        <div v-if="runtimeDetails" data-runtime-node class="text-12 mt-8 flex flex-col gap-4">
          <div v-if="runtimeDetails.kind === 'endpoint'">{{ t('netCheck.node.endpoint') }}</div>
          <template v-if="runtimeDetails.via">
            <div>{{ t('netCheck.node.upstreamDns', [runtimeDetails.via]) }}</div>
            <div class="font-mono">
              {{ t('netCheck.node.transportChain') }} {{ runtimeDetails.chain.join(' → ') }}
            </div>
          </template>
          <div v-else>
            {{ t('netCheck.node.nodeDns') }}
            <span class="font-bold">
              {{ runtimeDetails.resolver || t('netCheck.node.unknownResolver') }}
            </span>
            <span v-if="runtimeDetails.resolverAddress" class="text-muted font-mono">
              ({{ runtimeDetails.resolverAddress }})
            </span>
          </div>
          <div v-if="runtimeDetails.incomplete" class="text-danger">
            {{ t('netCheck.node.incompleteChain') }}
          </div>
        </div>
        <div v-else-if="runtimeUnavailable" class="text-12 text-muted mt-6">
          {{ t('netCheck.node.runtimeUnavailable') }}
        </div>
      </div>

      <div
        v-if="controller.stale.value && controller.refreshError.value"
        class="mb-12 flex flex-wrap items-center justify-between gap-8 text-12 text-danger"
      >
        <span>{{ renderText(controller.refreshError.value) }}</span>
        <Button size="small" type="text" @click="controller.refresh?.()">
          {{ t('home.nodes.retry') }}
        </Button>
      </div>

      <div
        v-if="controller.batch.value.running"
        class="node-diag-progress rounded-8 px-10 py-8 mb-12 flex flex-col gap-6"
      >
        <div class="text-12 text-secondary">
          {{
            t('home.nodes.testingProgress', [
              controller.batch.value.completed,
              controller.batch.value.total,
              controller.batch.value.success,
              controller.batch.value.failure,
            ])
          }}
        </div>
        <Progress :percent="batchPercent" />
      </div>

      <div v-if="readonlyNotice" class="text-12 text-muted mb-10">
        {{ readonlyNotice }}
      </div>

      <div class="flex flex-wrap items-center gap-8 mb-12">
        <Select
          v-if="groupOptions.length"
          :model-value="controller.selectedGroupName.value"
          :options="groupOptions"
          size="small"
          @change="controller.selectGroup"
        />
        <Input
          v-if="controller.nodes.value.length > 6"
          v-model="nodeFilter"
          size="small"
          clearable
          auto-size
          :placeholder="t('netCheck.node.searchPlaceholder')"
          class="flex-1 min-w-128"
        />
      </div>

      <div v-if="operationError" class="mb-8 text-12 text-danger" role="alert">
        {{ renderText(operationError) }}
      </div>
      <div
        v-if="filteredNodes.length === 0"
        class="flex flex-col items-center gap-8 py-12"
      >
        <Empty
          :description="
            nodeFilter.trim() ? t('home.nodes.noFilterMatches') : undefined
          "
        />
        <Button
          v-if="nodeFilter.trim()"
          size="small"
          @click="nodeFilter = ''"
        >
          {{ t('workspace.clearFilters') }}
        </Button>
      </div>
      <div v-else class="node-list flex flex-col gap-8">
        <NodeCard
          v-for="node in filteredNodes"
          :key="node.name"
          :node="node"
          compact
          :selected="node.name === controller.selectedGroup.value?.now"
          :testing="controller.testingNodes.value.has(node.name)"
          :disabled="
            controller.readonlyMode?.value || controller.selectedGroup.value?.type !== 'Selector'
          "
          :favorite="node.favorite"
          :phase="controller.nodePhases?.value.get(node.name)"
          :query="nodeFilter"
          @favorite="controller.toggleFavorite(node.name)"
          @select="switchNode(node.name)"
          @test="testNode(node.name)"
        />
      </div>
    </template>
  </Card>
</template>

<style scoped lang="less">
.node-diag-summary {
  background: var(--surface-bg);
  border: 1px solid var(--surface-border);
  user-select: text;
  -webkit-user-select: text;
}
.node-diag-progress {
  background: var(--surface-bg);
  border: 1px solid var(--surface-border);
}
.node-list {
  max-height: 520px;
  overflow-y: auto;
  padding-right: 2px;
}
</style>
