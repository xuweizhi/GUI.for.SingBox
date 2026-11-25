<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import type { NodeController } from '@/views/HomeView/useNodeController'

import type { RuntimeNodeDetails } from '../runtimeNodeDetails'

const props = defineProps<{
  controller: NodeController
  coreReady: boolean
  runtimeDetails?: RuntimeNodeDetails
  runtimeUnavailable?: boolean
}>()

const { t } = useI18n()
const nodeFilter = ref('')
const operationError = ref('')
watch(() => props.controller.selectedGroupName.value, () => {
  nodeFilter.value = ''
  operationError.value = ''
})

const filteredNodes = computed(() => {
  const q = nodeFilter.value.trim().toLowerCase()
  if (!q || props.controller.nodes.value.length <= 6) return props.controller.nodes.value
  return props.controller.nodes.value.filter(
    (node) =>
      node.name.toLowerCase().includes(q) ||
      (node.proxy?.type || '').toLowerCase().includes(q),
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

const delayColor = (delay?: number | null) => {
  if (!delay) return 'var(--muted-color)'
  if (delay < 500) return 'var(--level-1-color)'
  if (delay < 1000) return 'var(--level-2-color)'
  return 'var(--level-3-color)'
}

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
          <div class="font-bold text-15 line-clamp-1">
            {{ controller.primary.value.groupName || t('home.nodes.noSelectableNode') }}
          </div>
          <div
            v-if="controller.primary.value.delay"
            class="text-12 font-bold font-mono"
            :style="{ color: delayColor(controller.primary.value.delay) }"
          >
            {{ controller.primary.value.delay }} ms
          </div>
        </div>
        <div v-if="displayChain" class="text-12 text-muted mt-4 font-mono line-clamp-1">
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
        class="mb-12 text-12 text-danger"
      >
        {{ controller.refreshError.value }}
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

      <div v-if="operationError" class="mb-8 text-12 text-danger" role="alert">{{ t(operationError) }}</div>
      <Empty v-if="filteredNodes.length === 0" />
      <div v-else class="node-list flex flex-col gap-8">
        <div
          v-for="node in filteredNodes"
          :key="node.name"
          :data-node="node.name"
          :class="{ 'is-selected': node.name === controller.selectedGroup.value?.now }"
          class="node-row rounded-8 p-10 cursor-pointer"
          role="button"
          tabindex="0"
          :aria-pressed="node.name === controller.selectedGroup.value?.now"
          @click="switchNode(node.name)"
          @keydown.enter.self.prevent="switchNode(node.name)"
          @keydown.space.self.prevent="switchNode(node.name)"
        >
          <div class="flex items-center gap-8">
            <div class="min-w-0 flex-1">
              <div class="font-bold line-clamp-1">
                {{ node.name }}
              </div>
              <div class="text-12 text-muted mt-2">
                {{ node.proxy?.type || t('home.nodes.unknownType') }}
              </div>
            </div>

            <button
              :data-delay="node.name"
              type="button"
              class="delay-button"
              @click.stop="testNode(node.name)"
            >
              <span v-if="controller.testingNodes.value.has(node.name)" class="text-muted">
                ...
              </span>
              <span
                v-else-if="node.delayStatus === 'success'"
                class="font-bold font-mono"
                :style="{ color: delayColor(node.delay) }"
              >
                {{ node.delay }} ms
              </span>
              <span v-else-if="node.delayStatus === 'failed'" class="text-danger">
                {{ t('home.nodes.unavailable') }}
              </span>
              <span v-else class="text-muted">{{ t('home.nodes.untested') }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped lang="less">
.node-diag-summary {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  user-select: text;
  -webkit-user-select: text;
}

.node-list {
  max-height: 460px;
  overflow-y: auto;
  padding-right: 2px;
}

.node-row {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--card-bg, #fff);
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 50%, var(--border-color));
    background: var(--card-hover-bg);
  }

  &.is-selected {
    border-color: var(--accent-text);
    background: var(--accent-soft);
  }
}

.delay-button {
  border: 0;
  border-radius: 6px;
  padding: 4px 8px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.14s ease;

  &:hover {
    background: var(--btn-text-hover-bg);
  }
}
</style>
