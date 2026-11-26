<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { message } from '@/utils'

import NodeCard from '@/components/_common/NodeCard.vue'

import type { NodeController } from '@/views/HomeView/useNodeController'

const props = defineProps<{ controller: NodeController }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const router = useRouter()

const {
  query,
  sortByDelay,
  nodeGroupFilter,
  nodeGroupFilterOptions,
  nodePhases,
  testingNodes,
  switchingNode,
  batch,
  stale,
  refreshError,
  mode,
  primary,
  proxyActive,
  selectedGroup,
  nodes,
  readonlyMode,
} = props.controller

const filtering = computed(() => !!query.value.trim() || nodeGroupFilter.value !== '__all')
const emptyMessage = computed(() =>
  t(filtering.value ? 'home.nodes.noFilterMatches' : 'home.nodes.emptyProxyNodes'),
)

const batchPercent = computed(() =>
  batch.value.total ? (batch.value.completed / batch.value.total) * 100 : 0,
)
const modeMessage = computed(() => `home.nodes.modeHint.${mode.value}`)
const effectiveChain = computed(() => primary.value.chain.join(' → '))
const readonlyMessage = computed(() =>
  selectedGroup.value?.type === 'URLTest'
    ? 'home.nodes.urlTestReadonly'
    : 'home.nodes.directReadonly',
)

const clearFilters = () => {
  query.value = ''
  nodeGroupFilter.value = '__all'
}

const prepareModal = async () => {
  if (!batch.value.running && batch.value.cancelled) {
    batch.value.completed = 0
    batch.value.cancelled = false
  }
  try {
    await props.controller.prepareModal()
  } catch (error) {
    message.error(error)
  }
}

watch(open, (value) => value && void prepareModal(), { immediate: true })

const switchNode = async (name: string) => {
  if (
    switchingNode.value ||
    readonlyMode.value ||
    selectedGroup.value?.type !== 'Selector' ||
    selectedGroup.value.now === name
  ) {
    return
  }
  const result = await props.controller.switchNode(name)
  result.ok ? message.success('common.success') : message.error(result.error)
}

const testNode = async (name: string) => {
  const result = await props.controller.testNode(name)
  if (!result.ok) message.error(result.error)
}

const openSubscriptions = async () => {
  open.value = false
  await router.push('/subscriptions')
}

const openRoutePolicies = async () => {
  open.value = false
  await router.push('/profiles')
}
</script>

<template>
  <Modal
    v-model:open="open"
    title="home.nodes.title"
    :submit="false"
    cancel-text="common.close"
    size="drawer"
    mask-closable
  >
    <div
      v-if="mode === 'global' && !proxyActive"
      role="alert"
      class="stale-banner rounded-8 p-10 mb-8 text-12"
    >
      {{ t('home.nodes.globalProxyInactive') }}
    </div>
    <details class="mode-details mb-8">
      <summary class="text-muted text-12 cursor-pointer">
        {{ t(`home.nodes.mode.${mode}`) }} · {{ t('home.nodes.effectiveChain') }}
      </summary>
      <div class="mode-banner rounded-8 p-10 mt-8 text-12">
        <div class="flex items-center gap-8">
          <Tag size="small" color="blue">{{ t(`home.nodes.mode.${mode}`) }}</Tag>
          <span>{{ t(modeMessage) }}</span>
        </div>
        <div v-if="effectiveChain" class="mt-8">
          <div class="font-bold">{{ t('home.nodes.effectiveChain') }}</div>
          <div class="mt-4 break-all font-mono">{{ effectiveChain }}</div>
        </div>
      </div>
    </details>
    <div class="node-toolbar sticky top-0 z-2 flex flex-wrap items-center gap-8 pb-8 pt-2">
      <Select
        v-if="controller.groups.value.length > 1"
        :model-value="controller.selectedGroupName.value"
        :options="controller.groups.value.map((g) => ({ label: g.name, value: g.name }))"
        class="node-group-select"
        size="small"
        @change="controller.selectGroup"
      />
      <Input
        v-model="query"
        auto-size
        clearable
        size="small"
        :placeholder="t('common.keywords')"
        class="node-search flex-1 min-w-128"
      />
      <Select
        v-model="nodeGroupFilter"
        :options="nodeGroupFilterOptions"
        class="node-group-filter"
        size="small"
      />
      <Switch v-model="sortByDelay" size="small" label="home.nodes.sortByDelay" />
      <Button
        v-if="!batch.running"
        data-action="test-group"
        icon="speedTest"
        size="small"
        type="primary"
        @click="controller.testGroup"
      >
        {{ t('home.nodes.testGroup') }}
      </Button>
      <Button v-else data-action="cancel-test" size="small" @click="controller.cancelGroupTest">
        {{ t('common.cancel') }}
      </Button>
      <div v-if="batch.running || batch.completed" class="w-full">
        <Progress :percent="batchPercent" />
        <div class="text-12 text-muted mt-4">
          {{
            t('home.nodes.testProgress', [
              batch.completed,
              batch.total,
              batch.success,
              batch.failure,
            ])
          }}
        </div>
      </div>
    </div>

    <div v-if="readonlyMode" class="readonly-banner rounded-8 p-10 mb-8 text-12">
      {{ t(readonlyMessage) }}
    </div>

    <div
      v-if="stale"
      class="stale-banner rounded-8 p-10 mb-8 text-12 flex items-center justify-between"
    >
      <span>{{ t('home.nodes.stale') }}: {{ refreshError }}</span>
      <Button
        data-action="retry-refresh"
        type="link"
        size="small"
        class="ml-8"
        @click="prepareModal"
      >
        {{ t('home.nodes.retry') }}
      </Button>
    </div>

    <Empty v-if="nodes.length === 0" :description="emptyMessage">
      <template #description>
        <div class="text-12 text-muted">{{ emptyMessage }}</div>
        <Button v-if="filtering" type="link" size="small" @click="clearFilters">
          {{ t('workspace.clearFilters') }}
        </Button>
        <Button v-else type="link" size="small" @click="openSubscriptions">
          {{ t('home.nodes.addSubscription') }}
        </Button>
      </template>
    </Empty>
    <div v-else class="node-grid grid gap-8 pb-8">
      <NodeCard
        v-for="node in nodes"
        :key="node.name"
        :node="node"
        :selected="node.name === selectedGroup?.now"
        :disabled="!!switchingNode || readonlyMode || selectedGroup?.type !== 'Selector'"
        :aria-busy="switchingNode === node.name"
        :testing="testingNodes.has(node.name)"
        :phase="nodePhases.get(node.name)"
        :favorite="!!node.favorite"
        :query="query"
        :can-inspect="
          ['Selector', 'URLTest'].includes(node.proxy?.type || '') &&
          controller.groups.value.some((g) => g.name === node.name)
        "
        @select="switchNode(node.name)"
        @favorite="controller.toggleFavorite(node.name)"
        @test="testNode(node.name)"
        @inspect="controller.selectGroup(node.name)"
      />
    </div>

    <Divider />
    <div class="flex justify-end">
      <Button type="link" size="small" @click="openRoutePolicies">
        {{ t('home.nodes.managePolicies') }}
      </Button>
    </div>
  </Modal>
</template>

<style lang="less" scoped>
.node-toolbar {
  background: var(--surface-elevated-bg, var(--modal-bg));
  border-bottom: 1px solid var(--surface-border, var(--border-color));
  margin-bottom: 8px;
}

.readonly-banner {
  color: var(--warning-color);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
}

.mode-banner {
  color: var(--card-color);
  background: var(--surface-bg);
  border: 1px solid var(--surface-border);
}

.stale-banner {
  color: var(--danger-color);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent);
}

.node-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(210px, 100%), 1fr));
}
</style>
