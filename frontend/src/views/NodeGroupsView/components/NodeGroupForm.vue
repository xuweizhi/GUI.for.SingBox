<script setup lang="ts">
import { computed, h, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DefaultNodeGroup } from '@/constant/nodeGroup'
import { useNodeGroupsStore, useSubscribesStore } from '@/stores'
import { deepClone, message, nodeGroupNodeKey, resolveNodeGroup } from '@/utils'

import Button from '@/components/Button/index.vue'

import type { ResolvedNodeGroupNode } from '@/utils/nodeGroup'

const props = defineProps<{ id?: string }>()

const { t } = useI18n()
const nodeGroupsStore = useNodeGroupsStore()
const subscribesStore = useSubscribesStore()
const handleCancel = inject('cancel') as () => void
const handleSubmit = inject('submit') as () => void
const loading = ref(false)
const keywords = ref('')
const original = props.id ? nodeGroupsStore.getNodeGroupById(props.id) : undefined
const group = ref<App.NodeGroup>(
  deepClone({ ...DefaultNodeGroup(), ...original, match_field: original?.match_field ?? 'all' }),
)

const modeOptions = [
  { label: 'nodeGroups.manual', value: 'manual' },
  { label: 'nodeGroups.filter', value: 'filter' },
]
const sourceOptions = [
  { label: 'nodeGroups.allSources', value: 'all' },
  { label: 'nodeGroups.selectedSources', value: 'selected' },
]
const matchFieldOptions = [
  { label: 'nodeGroups.matchFields.all', value: 'all' },
  { label: 'nodeGroups.matchFields.name', value: 'name' },
  { label: 'nodeGroups.matchFields.protocol', value: 'protocol' },
  { label: 'nodeGroups.matchFields.subscription', value: 'subscription' },
]
const subscriptionOptions = computed(() =>
  subscribesStore.subscribes.map((subscription) => ({
    label: subscription.name,
    value: subscription.id,
  })),
)
const selectedKeys = computed(
  () =>
    new Set(
      group.value.members.map((member) => nodeGroupNodeKey(member.subscription_id, member.node_id)),
    ),
)
const availableNodes = computed(() => {
  const query = keywords.value.trim().toLowerCase()
  return subscribesStore.subscribes.flatMap((subscription) =>
    subscription.proxies.flatMap((proxy) => {
      const text = `${subscription.name} ${proxy.tag} ${proxy.type}`.toLowerCase()
      return !query || text.includes(query) ? [{ subscription, proxy }] : []
    }),
  )
})
const resolution = computed(() => resolveNodeGroup(group.value, subscribesStore.subscribes))
const matchExplanation = (node: ResolvedNodeGroupNode) => {
  if (!node.match) return ''
  const reason = t(
    group.value.include ? 'nodeGroups.matchIncluded' : 'nodeGroups.matchUnrestricted',
    {
      field: t(`nodeGroups.matchFields.${node.match.field}`),
      value: node.match.value,
      expression: group.value.include,
    },
  )
  return group.value.exclude
    ? `${reason} · ${t('nodeGroups.matchNotExcluded', { expression: group.value.exclude })}`
    : reason
}

const toggleMember = (
  subscription: App.Subscription,
  proxy: App.Subscription['proxies'][number],
) => {
  const index = group.value.members.findIndex(
    (member) => member.subscription_id === subscription.id && member.node_id === proxy.id,
  )
  if (index === -1) {
    group.value.members.push({
      subscription_id: subscription.id,
      node_id: proxy.id,
      last_known_tag: proxy.tag,
    })
  } else {
    group.value.members.splice(index, 1)
  }
}

const handleSave = async () => {
  loading.value = true
  try {
    if (props.id) await nodeGroupsStore.editNodeGroup(props.id, group.value)
    else await nodeGroupsStore.addNodeGroup(group.value)
    await handleSubmit()
  } catch (error: any) {
    message.error(error.message || error)
  } finally {
    loading.value = false
  }
}

const modalSlots = {
  cancel: () =>
    h(Button, { disabled: loading.value, onClick: handleCancel }, () => t('common.cancel')),
  submit: () =>
    h(Button, { type: 'primary', loading: loading.value, onClick: handleSave }, () =>
      t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div class="h-full flex flex-col gap-12">
    <div class="node-group-fields grid grid-cols-2 gap-12">
      <div class="form-item">
        {{ t('nodeGroups.name') }}
        <Input v-model="group.name" autofocus />
      </div>
      <div class="form-item">
        {{ t('nodeGroups.icon') }}
        <Input v-model="group.icon" clearable placeholder="https://" />
      </div>
    </div>
    <div class="form-item">
      {{ t('nodeGroups.mode') }}
      <Radio v-model="group.mode" :options="modeOptions" />
    </div>

    <template v-if="group.mode === 'manual'">
      <div class="text-14" aria-live="polite">
        {{ t('common.selectedCount', [group.members.length]) }}
      </div>
      <Input v-model="keywords" :placeholder="t('nodeGroups.search')" clearable />
      <div class="node-member-grid grid gap-8 overflow-y-auto min-h-128">
        <Button
          v-for="item in availableNodes"
          :key="nodeGroupNodeKey(item.subscription.id, item.proxy.id)"
          :type="
            selectedKeys.has(nodeGroupNodeKey(item.subscription.id, item.proxy.id))
              ? 'link'
              : 'text'
          "
          :data-member="item.proxy.id"
          :data-selected="selectedKeys.has(nodeGroupNodeKey(item.subscription.id, item.proxy.id))"
          :aria-pressed="selectedKeys.has(nodeGroupNodeKey(item.subscription.id, item.proxy.id))"
          class="node-member justify-start"
          @click="toggleMember(item.subscription, item.proxy)"
        >
          <span class="node-member__check" aria-hidden="true">
            <Icon
              v-if="selectedKeys.has(nodeGroupNodeKey(item.subscription.id, item.proxy.id))"
              icon="selected"
              :size="16"
            />
          </span>
          <div class="text-left min-w-0">
            <div class="line-clamp-1">{{ item.proxy.tag }}</div>
            <div class="text-12 opacity-70 line-clamp-1">
              {{ item.subscription.name }} · {{ item.proxy.type }}
            </div>
          </div>
        </Button>
      </div>
      <Empty v-if="availableNodes.length === 0" />
    </template>

    <template v-else>
      <div class="form-item">
        {{ t('nodeGroups.sources') }}
        <Radio v-model="group.source_scope" :options="sourceOptions" />
      </div>
      <div v-if="group.source_scope === 'selected'" class="form-item">
        {{ t('nodeGroups.sources') }}
        <Select v-model="group.subscription_ids" :options="subscriptionOptions" multiple />
      </div>
      <div class="form-item">
        {{ t('nodeGroups.matchField') }}
        <Select
          v-model="group.match_field"
          :options="matchFieldOptions"
          data-testid="node-group-match-field"
        />
        <span class="text-12 opacity-70">{{ t('nodeGroups.matchFieldHint') }}</span>
      </div>
      <div class="node-group-fields grid grid-cols-2 gap-12">
        <div class="form-item">
          {{ t('nodeGroups.include') }}
          <Input v-model="group.include" placeholder="HK|Hong Kong" />
        </div>
        <div class="form-item">
          {{ t('nodeGroups.exclude') }}
          <Input v-model="group.exclude" placeholder="Expire|Traffic" />
        </div>
      </div>
      <div class="form-item">
        {{ t('nodeGroups.maxNodes') }}
        <Input v-model="group.max_nodes" type="number" :min="0" />
      </div>
    </template>

    <Divider>{{ t('nodeGroups.resolved') }} · {{ resolution.nodes.length }}</Divider>
    <div class="flex flex-wrap gap-6">
      <div v-for="node in resolution.nodes" :key="node.key" class="min-w-0 max-w-full">
        <Tag color="blue">{{ node.proxy.tag }} · {{ node.subscription.name }}</Tag>
        <div
          v-if="node.match"
          class="text-12 opacity-70 break-all"
          data-testid="node-group-match-reason"
        >
          {{ matchExplanation(node) }}
        </div>
      </div>
      <span v-if="resolution.nodes.length === 0" class="text-12 opacity-70">{{
        t('common.none')
      }}</span>
    </div>
    <template v-if="resolution.issues.length">
      <Divider>{{ t('nodeGroups.unresolved') }} · {{ resolution.issues.length }}</Divider>
      <div class="text-12" style="color: var(--level-4-color)">
        <div v-for="(issue, index) in resolution.issues" :key="index">
          {{ issue.type }} · {{ 'label' in issue ? issue.label : issue.expression }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.node-member-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.node-member {
  border: 1px solid var(--border-color);
  padding: 12px;
  gap: 10px;
}
.node-member[data-selected='true'] {
  border-color: var(--accent-text);
  background: var(--accent-soft);
}
.node-member__check {
  display: flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

@media (max-width: 900px) {
  .node-member-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .node-group-fields,
  .node-member-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
