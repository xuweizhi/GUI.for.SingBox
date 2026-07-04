<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import type { NodeController } from '@/views/HomeView/useNodeController'

const props = defineProps<{
  controller: NodeController
  coreReady: boolean
}>()

const { t } = useI18n()

const groupOptions = computed(() =>
  props.controller.groups.value.map((group) => ({ label: group.name, value: group.name })),
)

const displayChain = computed(() => {
  const primary = props.controller.primary.value
  return primary.chain.join(' -> ')
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

    <div v-if="!coreReady" class="py-8 text-12">
      {{ t('netCheck.node.coreUnavailable') }}
    </div>
    <template v-else>
      <div class="mb-12">
        <div class="font-bold line-clamp-1">
          {{ controller.primary.value.groupName || t('home.nodes.noSelectableNode') }}
        </div>
        <div v-if="displayChain" class="text-12 mt-4 line-clamp-1">
          {{ displayChain }}
        </div>
        <div v-if="controller.primary.value.delay" class="text-12 mt-4">
          {{ controller.primary.value.delay }} ms
        </div>
      </div>

      <div v-if="controller.stale.value && controller.refreshError.value" class="mb-12 text-12">
        {{ controller.refreshError.value }}
      </div>

      <div class="mb-12">
        <Select
          v-if="groupOptions.length"
          :model-value="controller.selectedGroupName.value"
          :options="groupOptions"
          size="small"
          @change="controller.selectGroup"
        />
      </div>

      <Empty v-if="controller.nodes.value.length === 0" />
      <div v-else class="flex flex-col gap-8">
        <div
          v-for="node in controller.nodes.value"
          :key="node.name"
          :data-node="node.name"
          class="node-row rounded-8 p-8"
          role="button"
          tabindex="0"
          @click="controller.switchNode(node.name)"
          @keydown.enter.prevent="controller.switchNode(node.name)"
          @keydown.space.prevent="controller.switchNode(node.name)"
        >
          <div class="flex items-center gap-8">
            <div class="min-w-0 flex-1">
              <div class="font-bold line-clamp-1">
                {{ node.name }}
              </div>
              <div class="text-12 mt-2">
                {{ node.proxy?.type || t('home.nodes.unknownType') }}
              </div>
            </div>

            <button
              :data-delay="node.name"
              type="button"
              class="delay-button"
              @click.stop="controller.testNode(node.name)"
            >
              <span v-if="node.delayStatus === 'success'">{{ node.delay }} ms</span>
              <span v-else-if="node.delayStatus === 'failed'">
                {{ t('home.nodes.unavailable') }}
              </span>
              <span v-else>{{ t('home.nodes.untested') }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped lang="less">
.node-row {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--card-bg, #fff);
}

.delay-button {
  border: 0;
  background: transparent;
  white-space: nowrap;
}
</style>
