<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { message } from '@/utils'

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

const delayColor = (delay?: number | null) => {
  if (!delay) return 'var(--level-0-color)'
  if (delay < 500) return 'var(--level-1-color)'
  if (delay < 1000) return 'var(--level-2-color)'
  return 'var(--level-3-color)'
}

const prepareModal = async () => {
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
    width="82"
    height="82"
    mask-closable
  >
    <div class="mode-banner rounded-8 p-10 mb-8 text-12">
      <div class="flex items-center gap-8">
        <Tag size="small" color="blue">{{ t(`home.nodes.mode.${mode}`) }}</Tag>
        <span>{{ t(modeMessage) }}</span>
      </div>
      <div v-if="mode === 'global' && !proxyActive" class="mt-4 text-danger">
        {{ t('home.nodes.globalProxyInactive') }}
      </div>
    </div>

    <details v-if="effectiveChain" class="chain-details rounded-8 p-10 mb-8 text-12">
      <summary class="cursor-pointer font-bold">{{ t('home.nodes.effectiveChain') }}</summary>
      <div class="mt-4 break-all font-mono">{{ effectiveChain }}</div>
    </details>

    <div class="node-toolbar sticky top-0 z-2 flex flex-wrap items-center gap-8 pb-8 pt-2">
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
    </div>

    <div v-if="readonlyMode" class="readonly-banner rounded-8 p-10 mb-8 text-12">
      {{ t(readonlyMessage) }}
    </div>

    <div v-if="stale" class="stale-banner rounded-8 p-10 mb-8 text-12 flex items-center justify-between">
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

    <div v-if="batch.running || batch.completed" class="mb-8">
      <Progress :percent="batchPercent" />
      <div class="text-12 text-muted mt-4">
        {{
          t('home.nodes.testProgress', [batch.completed, batch.total, batch.success, batch.failure])
        }}
      </div>
    </div>

    <Empty v-if="nodes.length === 0" :description="emptyMessage">
      <template #description>
        <div class="text-12 text-muted">{{ emptyMessage }}</div>
        <Button v-if="!filtering" type="link" size="small" @click="openSubscriptions">
          {{ t('home.nodes.addSubscription') }}
        </Button>
      </template>
    </Empty>
    <div v-else class="node-grid grid gap-8 pb-8">
      <Card
        v-for="node in nodes"
        :key="node.name"
        :title="node.displayName ? t(node.displayName) : node.name"
        :selected="node.name === selectedGroup?.now"
        :interactive="!switchingNode && !readonlyMode && selectedGroup?.type === 'Selector'"
        :data-node="node.name"
        :aria-disabled="!!switchingNode || readonlyMode || selectedGroup?.type !== 'Selector'"
        :aria-pressed="node.name === selectedGroup?.now"
        :aria-busy="switchingNode === node.name"
        :class="{
          'cursor-pointer': !switchingNode && !readonlyMode && selectedGroup?.type === 'Selector',
          'cursor-not-allowed':
            !!switchingNode || readonlyMode || selectedGroup?.type !== 'Selector',
        }"
        role="button"
        tabindex="0"
        @click="switchNode(node.name)"
        @keydown.enter.self.prevent="switchNode(node.name)"
        @keydown.space.self.prevent="switchNode(node.name)"
      >
        <div v-if="node.displayName" class="text-12 text-muted mb-4 line-clamp-1">
          {{ node.name }}
          <span v-if="node.proxy?.now">
            · {{ t('home.nodes.currentAutoNode') }}: {{ node.proxy.now }}</span
          >
        </div>
        <div class="flex items-center text-12 gap-4">
          <span class="text-muted">{{ node.proxy?.type || t('home.nodes.unknownType') }}</span>
          <Tag v-if="node.proxy?.udp" size="small" color="default">UDP</Tag>
          <button
            type="button"
            class="favorite-button ml-auto"
            :data-favorite="node.name"
            :aria-pressed="node.favorite"
            :aria-label="
              t(node.favorite ? 'home.nodes.removeFavorite' : 'home.nodes.addFavorite', [node.name])
            "
            :title="
              t(node.favorite ? 'home.nodes.removeFavorite' : 'home.nodes.addFavorite', [node.name])
            "
            @click.stop="controller.toggleFavorite(node.name)"
          >
            {{ node.favorite ? '★' : '☆' }}
          </button>
          <Button
            v-tips.fast="node.error?.message"
            :data-delay="node.name"
            :loading="testingNodes.has(node.name)"
            :aria-description="node.error?.message"
            type="text"
            size="small"
            @click.stop="testNode(node.name)"
          >
            <span v-if="nodePhases.get(node.name) === 'queued'" class="text-muted">
              {{ t('home.nodes.queued') }}
            </span>
            <span v-else-if="nodePhases.get(node.name) === 'retry-queued'" class="text-muted">
              {{ t('home.nodes.retryQueued') }}
            </span>
            <span
              v-else-if="node.delayStatus === 'success'"
              class="delay-success font-bold"
              :style="{ color: delayColor(node.delay) }"
            >
              {{ node.delay }} ms<span v-if="(node.attempts ?? 1) > 1" class="font-normal">
                · {{ node.attempts }} {{ t('home.nodes.attempts') }}</span
              >
            </span>
            <span v-else-if="node.delayStatus === 'failed'" class="delay-failed">
              {{ t(`home.nodes.delayError.${node.error?.category ?? 'unknown'}`) }} ·
              {{ node.error?.attempts ?? 1 }}/{{ node.error?.maxAttempts ?? 3 }}
            </span>
            <span v-else class="text-muted">{{ t('home.nodes.untested') }}</span>
          </Button>
        </div>
      </Card>
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
.favorite-button {
  cursor: pointer;
  background: transparent;
  color: var(--muted-color);
  font-size: 1.15rem;
  border: 0;
  padding: 0 4px;
  line-height: 1;
}
.favorite-button[aria-pressed='true'] {
  color: var(--warning-color);
}

.node-toolbar {
  background: var(--modal-bg);
}

.readonly-banner {
  color: var(--warning-color);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
}

.mode-banner {
  color: var(--card-color);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}

.chain-details {
  color: var(--muted-color);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}

.stale-banner {
  color: var(--danger-color);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent);
}

.delay-success {
  color: var(--level-1-color);
}

.delay-failed {
  color: var(--danger-color);
}

.node-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 1000px) {
  .node-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .node-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .node-search {
    flex-basis: 100%;
  }
}
</style>
