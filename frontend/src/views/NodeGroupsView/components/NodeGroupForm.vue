<script setup lang="ts">
import { computed, h, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DefaultNodeGroup } from '@/constant/nodeGroup'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useNodeGroupsStore, useSubscribesStore } from '@/stores'
import {
  confirm,
  deepClone,
  message,
  nodeGroupNodeKey,
  resolveNodeGroup,
  resolveNodeGroupPreProxyChain,
  wouldCreateNodeGroupCycle,
} from '@/utils'

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
const preProxyBehaviorOptions = [
  { label: 'nodeGroups.outletManual', value: 'manual' },
  { label: 'nodeGroups.outletAuto', value: 'auto' },
]
const preProxyGroupOptions = computed(() => [
  { label: t('nodeGroups.noPreProxy'), value: '' },
  ...nodeGroupsStore.nodeGroups
    .filter(
      (candidate) =>
        candidate.id !== group.value.id &&
        !wouldCreateNodeGroupCycle(group.value.id, candidate.id, nodeGroupsStore.nodeGroups),
    )
    .map((candidate) => ({ label: candidate.name, value: candidate.id })),
])
const preProxyChain = computed(() => {
  if (!group.value.pre_proxy_group_id) return undefined
  const simulated = props.id
    ? nodeGroupsStore.nodeGroups.map((item) => (item.id === props.id ? group.value : item))
    : [...nodeGroupsStore.nodeGroups, group.value]
  return resolveNodeGroupPreProxyChain(group.value.id, simulated)
})
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
const source = ref('')
const availableNodes = computed(() => {
  const query = keywords.value.trim().toLowerCase()
  return subscribesStore.subscribes
    .filter((sub) => !source.value || sub.id === source.value)
    .flatMap((subscription) =>
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

const selectFiltered = () => {
  for (const { subscription, proxy } of availableNodes.value) {
    if (!selectedKeys.value.has(nodeGroupNodeKey(subscription.id, proxy.id)))
      toggleMember(subscription, proxy)
  }
}
const clearMissing = () => {
  const subscriptions = new Map(subscribesStore.subscribes.map((sub) => [sub.id, sub]))
  if (group.value.mode === 'manual') {
    group.value.members = group.value.members.filter((member) =>
      subscriptions.get(member.subscription_id)?.proxies.some((node) => node.id === member.node_id),
    )
  } else {
    group.value.subscription_ids = group.value.subscription_ids.filter((id) =>
      subscriptions.has(id),
    )
  }
}

const clearMembers = async () => {
  if (group.value.members.length === 0) return
  try {
    await confirm(
      t('common.clear'),
      t('common.confirmClear', [group.value.name || t('nodeGroups.title')]),
      {
        type: 'text',
        okText: 'common.clear',
        danger: true,
      },
    )
    group.value.members = []
  } catch {
    return
  }
}

const handleSave = async () => {
  if (loading.value) return
  errorField.value = ''
  if (!group.value.name.trim()) {
    return invalid('name')
  }
  if (group.value.mode === 'filter') {
    if (group.value.source_scope === 'selected' && group.value.subscription_ids.length === 0) {
      return invalid('sources', t('common.selectAtLeast', [1]))
    }
    const invalidFilter = resolution.value.issues.find((issue) => issue.type === 'invalid-filter')
    if (invalidFilter) {
      return invalid(invalidFilter.field, t('nodeGroups.issues.invalid-filter'))
    }
  }
  loading.value = true
  try {
    if (props.id) await nodeGroupsStore.editNodeGroup(props.id, group.value)
    else await nodeGroupsStore.addNodeGroup(group.value)
    message.success('common.success')
    await handleSubmit()
  } catch (error: any) {
    message.error(error.message || error)
  } finally {
    loading.value = false
  }
}

const { errorField, errorMessage, invalid } = useFormDraft(() => group.value)
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
  <div ref="formRoot" class="resource-form group-editor">
    <section class="flex flex-col gap-12">
      <div class="form-item" :data-invalid="errorField === 'name'">
        {{ t('nodeGroups.name') }}
        <div>
          <Input v-model="group.name" autofocus />
          <small v-if="errorField === 'name'" class="field-error" role="alert">{{
            errorMessage
          }}</small>
        </div>
      </div>
      <div class="form-item">
        {{ t('nodeGroups.icon') }}
        <Input v-model="group.icon" clearable placeholder="https://" />
      </div>
      <div class="form-item">
        {{ t('nodeGroups.preProxy') }}
        <div class="w-full">
          <Select
            v-model="group.pre_proxy_group_id"
            :options="preProxyGroupOptions"
            clearable
            data-testid="node-group-pre-proxy"
          />
          <span class="field-hint text-12 opacity-70">{{ t('nodeGroups.preProxyHint') }}</span>
        </div>
      </div>
      <div v-if="group.pre_proxy_group_id" class="form-item">
        {{ t('nodeGroups.preProxyBehavior') }}
        <Radio
          v-model="group.pre_proxy_behavior"
          :options="preProxyBehaviorOptions"
          data-testid="node-group-pre-proxy-behavior"
        />
      </div>
      <div class="form-item">
        {{ t('nodeGroups.mode') }}
        <Radio v-model="group.mode" :options="modeOptions" />
      </div>

      <template v-if="group.mode === 'manual'">
        <div class="text-14" aria-live="polite">
          {{ t('common.selectedCount', [group.members.length]) }}
        </div>
        <Select
          v-model="source"
          :options="subscriptionOptions"
          clearable
          :placeholder="t('nodeGroups.allSources')"
        />
        <div class="flex gap-6">
          <Button size="small" @click="selectFiltered">{{ t('common.selectAll') }}</Button>
          <Button size="small" :disabled="group.members.length === 0" @click="clearMembers">{{
            t('common.clear')
          }}</Button>
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
        <div
          v-if="group.source_scope === 'selected'"
          class="form-item"
          :data-invalid="errorField === 'sources'"
        >
          {{ t('nodeGroups.selectedSources') }}
          <div class="w-full">
            <Select
              v-model="group.subscription_ids"
              :options="subscriptionOptions"
              multiple
              clearable
              auto-size
            />
            <small v-if="errorField === 'sources'" class="field-error" role="alert">{{
              errorMessage
            }}</small>
          </div>
        </div>
        <div class="form-item">
          {{ t('nodeGroups.matchField') }}
          <div>
            <Select
              v-model="group.match_field"
              :options="matchFieldOptions"
              data-testid="node-group-match-field"
            />
            <span class="field-hint text-12 opacity-70">{{ t('nodeGroups.matchFieldHint') }}</span>
          </div>
        </div>
        <div class="form-item" :data-invalid="errorField === 'include'">
          {{ t('nodeGroups.include') }}
          <div class="w-full">
            <Input v-model="group.include" placeholder="HK|Hong Kong" class="w-full" />
            <small v-if="errorField === 'include'" class="field-error" role="alert">{{
              errorMessage
            }}</small>
          </div>
        </div>
        <div class="form-item" :data-invalid="errorField === 'exclude'">
          {{ t('nodeGroups.exclude') }}
          <div class="w-full">
            <Input v-model="group.exclude" placeholder="Expire|Traffic" class="w-full" />
            <small v-if="errorField === 'exclude'" class="field-error" role="alert">{{
              errorMessage
            }}</small>
          </div>
        </div>
        <div class="form-item">
          {{ t('nodeGroups.maxNodes') }}
          <Input v-model="group.max_nodes" type="number" :min="0" />
        </div>
      </template>
    </section>
    <aside class="group-preview surface-panel p-12">
      <template v-if="preProxyChain">
        <Divider>{{ t('nodeGroups.preProxyChain') }}</Divider>
        <div class="flex flex-wrap items-center gap-4 text-12 mb-8" data-testid="node-group-chain-preview">
          <Tag size="small">{{ t('nodeGroups.preProxyChainFlow') }}</Tag>
          <template v-for="hop in preProxyChain.hops" :key="hop.id">
            <span class="text-muted">→</span>
            <Tag :color="hop.id === group.id ? 'blue' : 'purple'" size="small">
              {{ hop.name
              }}{{
                hop.behavior
                  ? ` (${t(hop.behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual')})`
                  : ''
              }}
            </Tag>
          </template>
        </div>
        <div v-if="preProxyChain.error" class="text-12 mb-8" style="color: var(--color-danger)">
          {{
            t(
              preProxyChain.error === 'cycle'
                ? 'nodeGroups.issues.pre-proxy-cycle'
                : 'nodeGroups.issues.missing-pre-proxy',
            )
          }}
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
        <Button
          v-if="resolution.issues.some((issue) => issue.type !== 'invalid-filter')"
          size="small"
          @click="clearMissing"
        >
          {{ t('common.clear') }}
        </Button>
        <div class="text-12" style="color: var(--color-danger)">
          <div v-for="(issue, index) in resolution.issues" :key="index">
            {{ t('nodeGroups.issues.' + issue.type) }} ·
            {{ 'label' in issue ? issue.label : issue.expression }}
          </div>
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.group-editor {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  align-items: start;
  gap: 16px;
}
.group-preview {
  position: sticky;
  top: 0;
  max-height: 72vh;
  overflow: auto;
}
.field-hint {
  display: block;
  margin-top: 4px;
}
@container (max-width: 860px) {
  .group-editor {
    grid-template-columns: 1fr;
  }
  .group-preview {
    position: static;
    max-height: none;
  }
}

.node-member-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  max-height: 55vh;
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

@container (max-width: 1024px) {
  .node-member-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 640px) {
  .node-member-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
