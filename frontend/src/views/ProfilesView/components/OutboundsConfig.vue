<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { OutboundOptions, BuiltInOutbound } from '@/constant/kernel'
import { OutboundRoleOptions } from '@/constant/outbound'
import { DefaultOutbound } from '@/constant/profile'
import { Outbound } from '@/enums/kernel'
import { useNodeGroupsStore, useSubscribesStore } from '@/stores'
import {
  deepClone,
  ensureNodeGroupOutlet,
  findOutboundGraphIssues,
  getOutboundChainLabels,
  getOutboundRole,
  getOutboundRoleLabel,
  message,
  type NodeGroupOutletBehavior,
} from '@/utils'

const model = defineModel<App.Profile['outbounds']>({ required: true })
const props = defineProps<{ native?: App.Profile['native'] }>()

let updateGroupId = 0
const showEditModal = ref(false)
const showSortModal = ref(false)
const proxySearch = ref('')
const SUBGROUP_MARKER_TYPE = 'NodeGroupSubgroup'
const expandedSet = ref<Set<string>>(
  new Set(['Built-in', SUBGROUP_MARKER_TYPE, 'Subscription', 'NodeGroup']),
)

const fields = ref<App.Outbound>(DefaultOutbound())

const { t, te } = useI18n()
const renderLabel = (label: string) => (te(label) ? t(label) : label)
const subscribesStore = useSubscribesStore()
const nodeGroupsStore = useNodeGroupsStore()

const findExistingSubgroupOutbound = (groupId: string, behavior: NodeGroupOutletBehavior) => {
  const targetType = behavior === 'auto' ? Outbound.Urltest : Outbound.Selector
  return model.value.find(
    (candidate) =>
      candidate.id !== fields.value.id &&
      candidate.source_node_group === groupId &&
      candidate.type === targetType &&
      !candidate.pre_proxy &&
      !candidate.pre_proxy_override &&
      !candidate.include &&
      !candidate.exclude &&
      candidate.outbounds.length === 1 &&
      candidate.outbounds[0]?.type === 'NodeGroup' &&
      candidate.outbounds[0]?.id === groupId,
  )
}

const isSubgroupSelected = (groupId: string, behavior: NodeGroupOutletBehavior) => {
  const markerId = `${groupId}:${behavior}`
  if (
    fields.value.outbounds.some(
      (member) => member.type === SUBGROUP_MARKER_TYPE && member.id === markerId,
    )
  ) {
    return true
  }
  const existing = findExistingSubgroupOutbound(groupId, behavior)
  return Boolean(
    existing &&
      fields.value.outbounds.some(
        (member) => member.type === 'Built-in' && member.id === existing.id,
      ),
  )
}

const handleToggleSubgroup = (
  group: Pick<App.NodeGroup, 'id' | 'name'>,
  behavior: NodeGroupOutletBehavior,
) => {
  const markerId = `${group.id}:${behavior}`
  const existing = findExistingSubgroupOutbound(group.id, behavior)
  const wasSelected = isSubgroupSelected(group.id, behavior)

  // Remove any existing marker or Built-in subgroup for this node group first.
  const otherBehavior: NodeGroupOutletBehavior = behavior === 'auto' ? 'manual' : 'auto'
  const otherExisting = findExistingSubgroupOutbound(group.id, otherBehavior)
  const removeBuiltInIds = new Set(
    [existing?.id, otherExisting?.id].filter((item): item is string => Boolean(item)),
  )
  fields.value.outbounds = fields.value.outbounds.filter(
    (member) =>
      !(
        member.type === SUBGROUP_MARKER_TYPE &&
        (member.id === markerId || member.id === `${group.id}:${otherBehavior}`)
      ) && !(member.type === 'Built-in' && removeBuiltInIds.has(member.id)),
  )

  if (wasSelected) return

  if (existing) {
    fields.value.outbounds.push({ id: existing.id, tag: existing.tag, type: 'Built-in' })
  } else {
    const label = t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual')
    fields.value.outbounds.push({
      id: markerId,
      tag: `${group.name} · ${label}`,
      type: SUBGROUP_MARKER_TYPE,
    })
  }
}

const subgroupCandidates = computed(() => {
  if (fields.value.type !== Outbound.Selector) return []
  const q = proxySearch.value.trim().toLowerCase()
  return nodeGroupsStore.nodeGroups.filter(
    (group) =>
      group.id !== fields.value.source_node_group &&
      (!q || group.name.toLowerCase().includes(q)),
  )
})

const proxyGroup = computed(() => [
  {
    id: 'Built-in',
    name: 'kernel.outbounds.builtIn',
    proxies: [
      ...BuiltInOutbound.map((v) => ({ id: v, tag: v, type: 'Built-In' })),
      ...model.value.map(({ id, tag, type }) => ({ id, tag, type: type as string })),
    ],
  },
  {
    id: 'NodeGroup',
    name: fields.value.type === Outbound.Selector ? 'nodeGroups.flattenSection' : 'nodeGroups.source',
    proxies: nodeGroupsStore.nodeGroups.map((group) => ({
      id: group.id,
      tag: group.name,
      type: group.mode,
    })),
  },
  {
    id: 'Native',
    name: 'kernel.outbounds.nativeNodes',
    proxies: [...(props.native?.outbounds || []), ...(props.native?.endpoints || [])].map(
      (entry) => ({ id: entry.tag, tag: entry.tag, type: entry.type }),
    ),
  },
  {
    id: 'Subscription',
    name: 'kernel.outbounds.subscriptions',
    proxies: subscribesStore.subscribes.map(({ id, name }) => ({
      id,
      tag: name,
      type: 'Subscribe',
    })),
  },
  ...subscribesStore.subscribes.map(({ id, name, proxies }) => ({ id, name, proxies })),
])

const filteredProxyGroups = computed(() => {
  const q = proxySearch.value.trim().toLowerCase()
  return proxyGroup.value
    .map((group) => {
      const visible =
        group.id === 'Built-in'
          ? group.proxies.filter((p) => p.id !== fields.value.id)
          : group.proxies
      return {
        ...group,
        proxies: q
          ? visible.filter(
              (p) => p.tag.toLowerCase().includes(q) || p.type.toLowerCase().includes(q),
            )
          : visible,
      }
    })
    .filter((group) => !q || group.proxies.length > 0)
})

const PRE_PROXY_NODEGROUP_PREFIX = '__nodegroup__:'

const preProxyOptions = computed(() => {
  const existingStrategyNodeGroups = new Set(
    model.value
      .filter((outbound) => outbound.source_node_group && !outbound.pre_proxy && !outbound.pre_proxy_override)
      .map((outbound) => `${outbound.source_node_group}:${outbound.type === Outbound.Urltest ? 'auto' : 'manual'}`),
  )
  return [
    { label: t('kernel.outbounds.noPreProxy'), value: '' },
    ...model.value
      .filter(
        (outbound) =>
          outbound.id !== fields.value.id &&
          [Outbound.Selector, Outbound.Urltest].includes(outbound.type as Outbound),
      )
      .map((outbound) => ({ label: outbound.tag, value: outbound.id })),
    ...nodeGroupsStore.nodeGroups.flatMap((group) =>
      (['manual', 'auto'] as const)
        .filter((behavior) => !existingStrategyNodeGroups.has(`${group.id}:${behavior}`))
        .map((behavior) => ({
          label: t('nodeGroups.preProxyNodeGroupOption', [
            group.name,
            t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
          ]),
          value: `${PRE_PROXY_NODEGROUP_PREFIX}${group.id}:${behavior}`,
        })),
    ),
  ]
})

const hasMemberWithDefaultPreProxy = computed(() =>
  fields.value.outbounds.some((member) => {
    if (member.type !== 'NodeGroup') return false
    return Boolean(nodeGroupsStore.getNodeGroupById(member.id)?.pre_proxy_group_id)
  }),
)

const handleAdd = () => {
  updateGroupId = -1
  proxySearch.value = ''
  fields.value = DefaultOutbound()
  showEditModal.value = true
}

const editById = (id: string) => {
  const index = model.value.findIndex((o) => o.id === id)
  if (index >= 0) handleEditGroup(index)
}
defineExpose({ handleAdd, editById })

const handleDeleteGroup = (index: number) => {
  const id = model.value[index]!.id
  const dependent = model.value.find((outbound) => outbound.pre_proxy === id)
  if (dependent) {
    message.error(t('kernel.outbounds.preProxyInUse', [dependent.tag]))
    return
  }
  model.value.splice(index, 1)
}

const handleClearGroup = async (outbound: App.Outbound) => {
  const filtered = outbound.outbounds.filter(({ id, type }) => {
    if (type === 'Native')
      return proxyGroup.value
        .find((group) => group.id === 'Native')!
        .proxies.some((entry) => entry.id === id)
    if (type === 'Built-in') {
      return BuiltInOutbound.includes(id as Outbound) || model.value.some((v) => v.id === id)
    } else if (type === 'Subscription') {
      return subscribesStore.getSubscribeById(id)
    } else if (type === 'NodeGroup') {
      return nodeGroupsStore.getNodeGroupById(id)
    }
    const sub = subscribesStore.getSubscribeById(type)
    return sub && sub.proxies.some((v) => v.id === id)
  })
  if (outbound.pre_proxy && !model.value.some((v) => v.id === outbound.pre_proxy))
    outbound.pre_proxy = ''
  outbound.outbounds.splice(0)
  outbound.outbounds.push(...filtered)
}

const handleAddEnd = () => {
  fields.value.tag = fields.value.tag.trim()
  const { id, tag, type } = fields.value
  if (!tag) {
    message.warn('workspace.required')
    return false
  }
  if (model.value.some((outbound) => outbound.id !== id && outbound.tag.trim() === tag)) {
    message.error(t('common.duplicateKey'))
    return false
  }
  if (type === Outbound.Direct || type === Outbound.Block) {
    fields.value.pre_proxy = ''
    fields.value.outbounds = []
  }
  const staged = deepClone(model.value)
  // Place/update the current outbound's tag first so ensureNodeGroupOutlet never collides with it.
  const stagedSelf = deepClone(fields.value)
  stagedSelf.pre_proxy = ''
  if (updateGroupId === -1) {
    staged.unshift(stagedSelf)
  } else {
    const existingIdx = staged.findIndex((outbound) => outbound.id === id)
    if (existingIdx !== -1) staged[existingIdx] = stagedSelf
  }
  let resolvedPreProxy = fields.value.pre_proxy || ''
  let createdPreProxy: App.Outbound | undefined
  const createdSubgroups: App.Outbound[] = []
  if (resolvedPreProxy.startsWith(PRE_PROXY_NODEGROUP_PREFIX)) {
    const rest = resolvedPreProxy.slice(PRE_PROXY_NODEGROUP_PREFIX.length)
    const sep = rest.lastIndexOf(':')
    const groupId = rest.slice(0, sep)
    const behavior = (rest.slice(sep + 1) === 'auto' ? 'auto' : 'manual') as NodeGroupOutletBehavior
    const ng = nodeGroupsStore.getNodeGroupById(groupId)
    if (!ng) {
      message.error(t('kernel.outbounds.missingNodeGroup', [groupId]))
      return false
    }
    const prevCount = staged.length
    const upstream = ensureNodeGroupOutlet(
      staged,
      ng,
      behavior,
      t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
      { role: 'pre_proxy' },
    )
    resolvedPreProxy = upstream.id
    if (staged.length > prevCount) createdPreProxy = upstream
  }
  const resolvedMembers: App.Proxy[] = []
  const seenResolved = new Set<string>()
  for (const member of fields.value.outbounds) {
    if (member.type === SUBGROUP_MARKER_TYPE) {
      const sep = member.id.lastIndexOf(':')
      const groupId = member.id.slice(0, sep)
      const behavior = (member.id.slice(sep + 1) === 'auto' ? 'auto' : 'manual') as NodeGroupOutletBehavior
      const ng = nodeGroupsStore.getNodeGroupById(groupId)
      if (!ng) {
        message.error(t('kernel.outbounds.missingNodeGroup', [groupId]))
        return false
      }
      const prevCount = staged.length
      const subgroup = ensureNodeGroupOutlet(
        staged,
        ng,
        behavior,
        t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
        { role: 'outlet' },
      )
      if (staged.length > prevCount) createdSubgroups.push(subgroup)
      const key = `Built-in\u0000${subgroup.id}`
      if (!seenResolved.has(key)) {
        seenResolved.add(key)
        resolvedMembers.push({ id: subgroup.id, tag: subgroup.tag, type: 'Built-in' })
      }
      continue
    }
    const key = `${member.type}\u0000${member.id}`
    if (!seenResolved.has(key)) {
      seenResolved.add(key)
      resolvedMembers.push(member)
    }
  }
  const candidateFields: App.Outbound = {
    ...fields.value,
    pre_proxy: resolvedPreProxy,
    outbounds: resolvedMembers,
  }
  const next = staged.map((outbound) => (outbound.id === id ? candidateFields : outbound))
  const previous = findOutboundGraphIssues(model.value, nodeGroupsStore.nodeGroups)
  const trackedIds = new Set([
    id,
    ...(createdPreProxy ? [createdPreProxy.id] : []),
    ...createdSubgroups.map((item) => item.id),
  ])
  const cycle = findOutboundGraphIssues(next, nodeGroupsStore.nodeGroups).find((issue) => {
    if (issue.type === 'cycle') return issue.chain.some((item) => trackedIds.has(item))
    if (!trackedIds.has(issue.groupId)) return false
    if (issue.type === 'reserved-tag') return true
    return !previous.some(
      (old) =>
        old.groupId === issue.groupId && old.type === issue.type && old.targetId === issue.targetId,
    )
  })
  if (cycle?.type === 'reserved-tag') {
    message.error(t('kernel.outbounds.reservedTag'))
    return false
  }
  if (cycle?.type === 'missing-node-group') {
    message.error(t('kernel.outbounds.missingNodeGroup', [cycle.targetId]))
    return false
  }
  if (cycle) {
    message.error(
      t(cycle.type === 'cycle' ? 'kernel.outbounds.cycle' : 'kernel.outbounds.missingReference', [
        getOutboundChainLabels(cycle.chain, next).join(' → '),
      ]),
    )
    return false
  }
  fields.value.pre_proxy = resolvedPreProxy
  fields.value.outbounds = resolvedMembers
  if (createdPreProxy) {
    model.value.push(createdPreProxy)
  }
  if (createdSubgroups.length) {
    model.value.push(...createdSubgroups)
  }
  // Add
  if (updateGroupId === -1) {
    model.value.unshift(fields.value)
    return
  }
  // Update
  model.value[updateGroupId] = fields.value
  model.value
    .filter((outbound) => [Outbound.Selector, Outbound.Urltest].includes(outbound.type as any))
    .forEach(({ outbounds }) => {
      const proxy = outbounds.find((v) => v.type === 'Built-in' && v.id === id)
      proxy && (proxy.tag = tag)
    })
}

const handleEditGroup = (index: number) => {
  updateGroupId = index
  proxySearch.value = ''
  fields.value = deepClone(model.value[index]!)
  showEditModal.value = true
}

const handleAddProxy = (groupID: string, proxyID: string, proxyName: string) => {
  // self
  if (groupID === 'Built-in' && proxyID === fields.value.id) return

  const idx = fields.value.outbounds.findIndex(
    (outbound) => outbound.type === groupID && outbound.id === proxyID,
  )
  if (idx !== -1) {
    fields.value.outbounds.splice(idx, 1)
  } else {
    fields.value.outbounds.push({ id: proxyID, tag: proxyName, type: groupID })
  }
}

const isInuse = (groupID: string, proxyID: string) => {
  return fields.value.outbounds.find(
    (outbound) => outbound.type === groupID && outbound.id === proxyID,
  )
}

const hasLost = (outbound: App.Outbound) => {
  if (outbound.pre_proxy && !model.value.some((v) => v.id === outbound.pre_proxy)) return true
  if ([Outbound.Selector, Outbound.Urltest].includes(outbound.type as any)) {
    return outbound.outbounds.some(({ id, type }) => {
      if (type === 'Native')
        return !proxyGroup.value
          .find((group) => group.id === 'Native')!
          .proxies.some((entry) => entry.id === id)
      if (type === 'Built-in') {
        if (BuiltInOutbound.includes(id as Outbound)) {
          return false
        }
        return model.value.every((v) => v.id !== id)
      } else if (type === 'Subscription') {
        const sub = subscribesStore.getSubscribeById(id)
        if (!sub) return true
        return false
      } else if (type === 'NodeGroup') {
        return !nodeGroupsStore.getNodeGroupById(id)
      }
      const sub = subscribesStore.getSubscribeById(type)
      if (!sub) return true
      return sub.proxies.every((v) => v.id !== id)
    })
  }
  return false
}

const handleSortGroup = (index: number) => {
  updateGroupId = index
  fields.value = deepClone(model.value[index]!)
  showSortModal.value = true
}

const handleSortGroupEnd = () => {
  model.value[updateGroupId] = fields.value
}

const clacSubscriptionsCount = (outbound: App.Outbound) => {
  if ([Outbound.Selector, Outbound.Urltest].includes(outbound.type as any)) {
    return outbound.outbounds.filter((v) => v.type === 'Subscription').length
  }
  return 0
}

const clacNodeGroupsCount = (outbound: App.Outbound) => {
  if ([Outbound.Selector, Outbound.Urltest].includes(outbound.type as any)) {
    return outbound.outbounds.filter((v) => v.type === 'NodeGroup').length
  }
  return 0
}

const clacOutboundsCount = (outbound: App.Outbound) => {
  if ([Outbound.Selector, Outbound.Urltest].includes(outbound.type as any)) {
    return outbound.outbounds.filter((v) => v.type !== 'Subscription' && v.type !== 'NodeGroup')
      .length
  }
  return 0
}

const needToAdd = (outbound: App.Outbound) => {
  if ([Outbound.Selector, Outbound.Urltest].includes(outbound.type as any)) {
    return outbound.outbounds.length === 0
  }
  return false
}

const toggleExpanded = (key: string) => {
  if (expandedSet.value.has(key)) {
    expandedSet.value.delete(key)
  } else {
    expandedSet.value.add(key)
  }
}

const preProxyLabels = (outbound: App.Outbound): string[] => {
  const labels: string[] = []
  if (outbound.pre_proxy) {
    const target = model.value.find((item) => item.id === outbound.pre_proxy)
    labels.push(target?.tag || outbound.pre_proxy)
  }
  if (!outbound.pre_proxy_override) {
    for (const member of outbound.outbounds) {
      if (member.type !== 'NodeGroup') continue
      const group = nodeGroupsStore.getNodeGroupById(member.id)
      if (!group?.pre_proxy_group_id) continue
      const preName =
        nodeGroupsStore.getNodeGroupById(group.pre_proxy_group_id)?.name ||
        group.pre_proxy_group_id
      if (!labels.includes(preName)) labels.push(preName)
    }
  }
  return labels
}

const isExpanded = (key: string) => Boolean(proxySearch.value.trim()) || expandedSet.value.has(key)

const showLost = () => message.warn('kernel.outbounds.notFound')

const showNeedToAdd = () => message.error('kernel.outbounds.needToAdd')
</script>

<template>
  <Empty v-if="model.length === 0">
    <template #description>
      <Button icon="add" type="primary" size="small" @click="handleAdd">
        {{ t('common.add') }}
      </Button>
    </template>
  </Empty>

  <template v-else>
    <div class="flex justify-end mb-8">
      <Button icon="add" type="primary" size="small" @click="handleAdd">
        {{ t('common.add') }}
      </Button>
    </div>

    <div v-draggable="[model, DraggableOptions]">
      <Card v-for="(outbound, index) in model" :key="outbound.id" flush class="mb-6">
        <div class="flex flex-wrap items-center py-6 gap-6">
          <Icon icon="drag" :size="15" color="var(--muted-color)" class="cursor-move shrink-0" />
          <div class="font-bold flex items-center gap-4" style="min-width: 90px">
            <img v-if="outbound.icon" :src="outbound.icon" class="w-18 h-18" />
            <Button
              v-if="hasLost(outbound)"
              v-tips="'kernel.outbounds.notFound'"
              icon="warn"
              icon-color="var(--warning-color)"
              type="text"
              size="small"
              @click="showLost"
            />
            <Button
              v-if="needToAdd(outbound)"
              v-tips="'kernel.outbounds.needToAdd'"
              icon="error"
              icon-color="var(--danger-color)"
              type="text"
              size="small"
              @click="showNeedToAdd"
            />
            <span>{{ outbound.tag }}</span>
            <Tag size="small" color="blue">
              {{ t(getOutboundRoleLabel(getOutboundRole(outbound))) }}
            </Tag>
            <Tag
              v-for="via in preProxyLabels(outbound)"
              :key="via"
              size="small"
              color="purple"
            >
              {{ t('profileSimple.preProxyVia', [via]) }}
            </Tag>
          </div>
          <span class="text-12 text-muted">
            {{ t('kernel.outbounds.refsOutbound') }}: {{ clacOutboundsCount(outbound) }} ·
            {{ t('kernel.outbounds.refsSubscription') }}: {{ clacSubscriptionsCount(outbound) }} ·
            {{ t('router.nodeGroups') }}: {{ clacNodeGroupsCount(outbound) }}
          </span>
          <Button
            v-if="[Outbound.Selector, Outbound.Urltest].includes(outbound.type as Outbound)"
            type="link"
            size="small"
            @click="handleSortGroup(index)"
            >{{ t('kernel.outbounds.sort') }}</Button
          >
          <div class="ml-auto flex items-center gap-2">
            <Button
              v-if="hasLost(outbound)"
              type="text"
              size="small"
              @click="handleClearGroup(outbound)"
            >
              {{ t('common.clear') }}
            </Button>
            <Button
              icon="edit"
              type="text"
              size="small"
              :aria-label="t('common.edit')"
              @click="handleEditGroup(index)"
            />
            <Button
              icon="delete"
              icon-color="var(--danger-color)"
              type="text"
              size="small"
              :aria-label="t('common.delete')"
              @click="handleDeleteGroup(index)"
            />
          </div>
        </div>
      </Card>
    </div>
  </template>

  <Modal
    v-model:open="showSortModal"
    size="drawer"
    :on-ok="handleSortGroupEnd"
    mask-closable
    title="kernel.outbounds.sort"
  >
    <Divider>{{ t('kernel.outbounds.refs') }}</Divider>
    <p class="text-12 text-muted mt-0 mb-8">{{ t('kernel.outbounds.sortHint') }}</p>
    <Empty v-if="fields.outbounds.length === 0" />
    <div v-draggable="[fields.outbounds, DraggableOptions]" class="flex flex-wrap gap-6">
      <Button
        v-for="proxy in fields.outbounds"
        :key="JSON.stringify([proxy.type, proxy.id])"
        type="normal"
        size="small"
        icon="drag"
      >
        {{ proxy.tag }}
      </Button>
    </div>
  </Modal>

  <Modal
    v-model:open="showEditModal"
    size="drawer"
    :on-ok="handleAddEnd"
    title="kernel.outbounds.name"
  >
    <div class="form-item">
      {{ t('kernel.outbounds.tag') }}
      <Input v-model="fields.tag" autofocus />
    </div>
    <div class="form-item">
      {{ t('kernel.outbounds.type') }}
      <Radio v-model="fields.type" :options="OutboundOptions" />
    </div>
    <div class="form-item">
      {{ t('kernel.outbounds.role.name') }}
      <Select v-model="fields.role" :options="OutboundRoleOptions" />
    </div>
    <template v-if="Outbound.Selector === fields.type || Outbound.Urltest === fields.type">
      <div class="form-item">
        {{ t('kernel.outbounds.preProxy') }}
        <Select v-model="fields.pre_proxy" :options="preProxyOptions" />
      </div>
      <div class="text-12 text-muted mb-12">
        {{ t('kernel.outbounds.preProxyHint') }}
        <span v-if="fields.pre_proxy && hasMemberWithDefaultPreProxy && !fields.pre_proxy_override">
          {{ t('nodeGroups.preProxyStackHint') }}
        </span>
      </div>
      <div class="form-item">
        {{ t('kernel.outbounds.hidden') }}
        <Switch v-model="fields.hidden" />
      </div>
      <div class="form-item">
        {{ t('kernel.outbounds.include') }}
        <Input v-model="fields.include" placeholder="keywords1|keywords2" />
      </div>
      <div class="form-item">
        {{ t('kernel.outbounds.exclude') }}
        <Input v-model="fields.exclude" placeholder="keywords1|keywords2" />
      </div>
      <div class="form-item">
        <div class="flex items-center gap-8">
          {{ t('kernel.outbounds.icon') }}
          <img v-if="fields.icon" :src="fields.icon" class="w-18 h-18" />
        </div>
        <Input v-model="fields.icon" clearable placeholder="https://" />
      </div>
    </template>
    <template v-if="Outbound.Direct === fields.type || Outbound.Block === fields.type">
      <Empty :description="t('kernel.outbounds.directDesc')" />
    </template>
    <template v-else-if="fields.type === Outbound.Urltest">
      <div class="form-item">
        {{ t('kernel.outbounds.url') }}
        <Input v-model="fields.url" placeholder="http(s)://" />
      </div>
      <div class="form-item">
        {{ t('kernel.outbounds.interval') }}
        <Input v-model="fields.interval" placeholder="3m" />
      </div>
      <div class="form-item">
        {{ t('kernel.outbounds.tolerance') }}
        <Input v-model="fields.tolerance" type="number" />
      </div>
    </template>
    <template v-if="[Outbound.Selector, Outbound.Urltest].includes(fields.type as any)">
      <Divider>
        {{ t('kernel.outbounds.refsOutbound') }}, {{ t('kernel.outbounds.refsSubscription') }},
        {{ t('router.nodeGroups') }}
      </Divider>

      <div class="mb-8">
        <Input
          v-model="proxySearch"
          size="small"
          clearable
          :placeholder="t('common.search')"
          class="w-full"
        />
      </div>

      <div
        v-if="fields.type === Outbound.Selector && subgroupCandidates.length"
        class="group mb-6"
      >
        <Button
          :type="isExpanded(SUBGROUP_MARKER_TYPE) ? 'link' : 'text'"
          class="outbound-group-toggle sticky top-0 w-full justify-start"
          @click="toggleExpanded(SUBGROUP_MARKER_TYPE)"
        >
          {{ t('nodeGroups.subgroupSection') }}
          <div class="ml-auto mr-8 text-muted">{{ subgroupCandidates.length }}</div>
          <Icon
            :class="{ 'rotate-z': isExpanded(SUBGROUP_MARKER_TYPE) }"
            icon="arrowRight"
            class="action-expand"
          />
        </Button>
        <div v-show="isExpanded(SUBGROUP_MARKER_TYPE)" class="outbound-proxy-grid p-8">
          <div
            v-for="ng in subgroupCandidates"
            :key="ng.id"
            class="subgroup-picker-card rounded-8 p-8 flex flex-col gap-6"
          >
            <div class="font-bold text-13 line-clamp-1">{{ ng.name }}</div>
            <div class="flex items-center gap-4">
              <Button
                :type="isSubgroupSelected(ng.id, 'auto') ? 'primary' : 'normal'"
                size="small"
                class="flex-1"
                @click="handleToggleSubgroup(ng, 'auto')"
              >
                {{ t('nodeGroups.outletAuto') }}
              </Button>
              <Button
                :type="isSubgroupSelected(ng.id, 'manual') ? 'primary' : 'normal'"
                size="small"
                class="flex-1"
                @click="handleToggleSubgroup(ng, 'manual')"
              >
                {{ t('nodeGroups.outletManual') }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Empty v-if="filteredProxyGroups.length === 0 && subgroupCandidates.length === 0" :icon-size="42" />

      <div v-for="group in filteredProxyGroups" :key="group.id" class="group mb-6">
        <Button
          :type="isExpanded(group.id) ? 'link' : 'text'"
          class="outbound-group-toggle sticky top-0 w-full justify-start"
          @click="toggleExpanded(group.id)"
        >
          {{ renderLabel(group.name) }}
          <div class="ml-auto mr-8 text-muted">{{ group.proxies.length }}</div>
          <Icon
            :class="{ 'rotate-z': isExpanded(group.id) }"
            icon="arrowRight"
            class="action-expand"
          />
        </Button>
        <div v-show="isExpanded(group.id)">
          <Empty
            v-if="group.proxies.length === 0"
            :description="
              group.id === 'Subscription'
                ? t('kernel.outbounds.noSubs')
                : t('kernel.outbounds.empty')
            "
          />
          <template v-else>
            <div class="outbound-proxy-grid p-8">
              <Button
                v-for="proxy in group.proxies"
                :key="proxy.id"
                :type="isInuse(group.id, proxy.id) ? 'primary' : 'normal'"
                size="small"
                class="outbound-proxy-item"
                @click="handleAddProxy(group.id, proxy.id, proxy.tag)"
              >
                <div class="min-w-0 text-left w-full">
                  <div class="line-clamp-1 font-bold">{{ proxy.tag }}</div>
                  <div class="text-12 opacity-75 line-clamp-1">{{ proxy.type }}</div>
                </div>
              </Button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </Modal>
</template>

<style lang="less" scoped>
.action-expand {
  transition: transform 0.2s;
}
.rotate-z {
  transform: rotateZ(90deg);
}
.outbound-proxy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.outbound-proxy-item {
  width: 100%;
  justify-content: flex-start;
  padding: 6px 10px;
}
.outbound-group-toggle {
  z-index: 1;
  background: var(--surface-elevated-bg, var(--modal-bg));
  backdrop-filter: blur(var(--surface-blur, 8px));
}
.subgroup-picker-card {
  border: 1px solid var(--surface-border, var(--border-color));
  background: var(--surface-bg);
}
</style>
