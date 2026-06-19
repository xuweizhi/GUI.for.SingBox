<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { message } from '@/utils'

import type { NodeController } from '@/views/HomeView/useNodeController'

const props = defineProps<{ controller: NodeController }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const {
  selectedGroupName,
  query,
  sortByDelay,
  testingNodes,
  batch,
  stale,
  refreshError,
  groups,
  selectedGroup,
  nodes,
  readonlyMode,
} = props.controller

const groupOptions = computed(() =>
  groups.value.map((group) => ({ label: group.name, value: group.name })),
)
const batchPercent = computed(() =>
  batch.value.total ? (batch.value.completed / batch.value.total) * 100 : 0,
)
const readonlyMessage = computed(() =>
  selectedGroup.value?.type === 'URLTest'
    ? 'home.nodes.urlTestReadonly'
    : 'home.nodes.directReadonly',
)

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
    <div class="node-toolbar sticky top-0 z-2 flex flex-wrap items-center gap-8 pb-8">
      <Select
        :model-value="selectedGroupName"
        :options="groupOptions"
        size="small"
        @change="controller.selectGroup"
      />
      <Input
        v-model="query"
        auto-size
        clearable
        size="small"
        placeholder="common.keywords"
        class="node-search flex-1 min-w-128"
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

    <div v-if="readonlyMode" class="readonly-banner rounded-6 p-8 mb-8 text-12">
      {{ t(readonlyMessage) }}
    </div>

    <div v-if="stale" class="stale-banner rounded-6 p-8 mb-8 text-12">
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
      <div class="text-12 mt-4">
        {{
          t('home.nodes.testProgress', [batch.completed, batch.total, batch.success, batch.failure])
        }}
      </div>
    </div>

    <Empty v-if="nodes.length === 0" />
    <div v-else class="node-grid grid gap-8 pb-8">
      <Card
        v-for="node in nodes"
        :key="node.name"
        :title="node.name"
        :selected="node.name === selectedGroup?.now"
        :data-node="node.name"
        :aria-disabled="readonlyMode || selectedGroup?.type !== 'Selector'"
        :class="{
          'cursor-pointer': !readonlyMode && selectedGroup?.type === 'Selector',
          'cursor-not-allowed': readonlyMode || selectedGroup?.type !== 'Selector',
        }"
        role="button"
        tabindex="0"
        @click="switchNode(node.name)"
        @keydown.enter.prevent="switchNode(node.name)"
        @keydown.space.prevent="switchNode(node.name)"
      >
        <div class="flex items-center text-12">
          <span>{{ node.proxy?.type || t('home.nodes.unknownType') }}</span>
          <span v-if="node.proxy?.udp" class="ml-4">UDP</span>
          <Button
            :data-delay="node.name"
            :loading="testingNodes.has(node.name)"
            type="text"
            size="small"
            class="ml-auto"
            @click.stop="testNode(node.name)"
          >
            <span v-if="node.delayStatus === 'success'">{{ node.delay }} ms</span>
            <span v-else-if="node.delayStatus === 'failed'">
              {{ t('home.nodes.unavailable') }}
            </span>
            <span v-else>{{ t('home.nodes.untested') }}</span>
          </Button>
        </div>
      </Card>
    </div>
  </Modal>
</template>

<style lang="less" scoped>
.node-toolbar {
  background: var(--modal-bg);
}

.readonly-banner {
  color: var(--level-3-color);
  background: var(--card-bg);
}

.stale-banner {
  color: var(--level-4-color);
  background: var(--card-bg);
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
