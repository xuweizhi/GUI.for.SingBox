<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { RuleActionRejectOptions } from '@/constant/kernel'
import {
  DomainStrategyOptions,
  RuleActionOptions,
  RuleSnifferOptions,
  RulesTypeOptions,
} from '@/constant/kernel'
import { DefaultRouteRule } from '@/constant/profile'
import { CommonServiceRulesetPresets, type ServiceRulesetPreset } from '@/constant/profilePresets'
import {
  RuleActionReject,
  RuleAction,
  RulesetFormat,
  RulesetType,
  RuleType,
  ClashMode,
  Strategy,
} from '@/enums/kernel'
import { useBool } from '@/hooks'
import { useNodeGroupsStore, useRulesetsStore } from '@/stores'
import {
  deepClone,
  detectManagedRuleKey,
  ensureNodeGroupOutlet,
  ensureProfileRuleset,
  getOutboundRole,
  isValidJson,
  message,
  type NodeGroupOutletBehavior,
  type NodeGroupOutletPreProxyOption,
} from '@/utils'

interface Props {
  inboundOptions: { label: string; value: string }[]
  outboundOptions: { label: string; value: string }[]
  serverOptions: { label: string; value: string }[]
  ruleSet: App.ProfileRuleSet[]
  outbounds: App.Outbound[]
  inbounds?: App.Inbound[]
  showCleanup?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ cleanupUnused: [] }>()

const model = defineModel<App.Rule[]>({ required: true })

let ruleId = 0
const fields = ref<App.Rule>(DefaultRouteRule())

const { t } = useI18n()
const nodeGroupsStore = useNodeGroupsStore()
const rulesetsStore = useRulesetsStore()
const hideSystemRules = ref(false)
const rulesetQuery = ref('')
const targetType = ref('outbound')
const outletNodeGroup = ref('')
const outletBehavior = ref<NodeGroupOutletBehavior>('manual')
const outletPreProxyMode = ref<'inherit' | 'none' | 'replace-group' | 'stack-group'>('inherit')
const outletPreProxyGroup = ref('')
const outletPreProxyBehavior = ref<NodeGroupOutletBehavior>('manual')
const outletCustomPreProxyOutboundId = ref('')
const pendingRulesets = ref<App.ProfileRuleSet[]>([])
const nodeGroupOptions = computed(() =>
  nodeGroupsStore.nodeGroups.map((group) => ({ label: group.name, value: group.id })),
)
const selectedOutletGroup = computed(() =>
  outletNodeGroup.value ? nodeGroupsStore.getNodeGroupById(outletNodeGroup.value) : undefined,
)
const selectedOutletDefaultPreProxy = computed(() =>
  selectedOutletGroup.value?.pre_proxy_group_id
    ? nodeGroupsStore.getNodeGroupById(selectedOutletGroup.value.pre_proxy_group_id)
    : undefined,
)
const preProxyGroupOptions = computed(() =>
  nodeGroupsStore.nodeGroups
    .filter((group) => group.id !== outletNodeGroup.value)
    .map((group) => ({ label: group.name, value: group.id })),
)
const outletPreProxyModeOptions = computed(() => {
  const defaultName = selectedOutletDefaultPreProxy.value?.name
  return [
    {
      label: defaultName
        ? t('nodeGroups.preProxyInheritWith', [defaultName])
        : t('nodeGroups.preProxyInheritNone'),
      value: 'inherit',
    },
    ...(defaultName ? [{ label: t('nodeGroups.preProxyNoneOverride'), value: 'none' }] : []),
    { label: t('nodeGroups.preProxyReplaceGroup'), value: 'replace-group' },
    ...(defaultName ? [{ label: t('nodeGroups.preProxyStackGroup'), value: 'stack-group' }] : []),
  ]
})
const [showEditModal] = useBool(false)

const resetOutletPreProxy = () => {
  outletPreProxyMode.value = 'inherit'
  outletPreProxyGroup.value = ''
  outletPreProxyBehavior.value = 'manual'
  outletCustomPreProxyOutboundId.value = ''
}

const handleAdd = () => {
  ruleId = -1
  fields.value = DefaultRouteRule()
  targetType.value = 'outbound'
  outletNodeGroup.value = ''
  outletBehavior.value = 'manual'
  rulesetQuery.value = ''
  pendingRulesets.value = []
  resetOutletPreProxy()
  showEditModal.value = true
}

const editById = (id: string) => {
  const index = model.value.findIndex((rule) => rule.id === id)
  if (index >= 0) handleEdit(index)
}
defineExpose({ handleAdd, editById })

const handleAddInsertionPoint = () => {
  model.value.unshift({
    id: RuleType.InsertionPoint,
    type: RuleType.InsertionPoint,
    enable: true,
    payload: '',
    invert: false,
    action: RuleAction.Sniff,
    outbound: '',
    sniffer: [],
    strategy: Strategy.Default,
    server: '',
  })
}

const commitPendingRulesets = (
  target: App.Profile['route']['rule_set'],
  candidates: App.Profile['route']['rule_set'],
  selectedIds: Set<string>,
) => {
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.id) && !target.some((item) => item.id === candidate.id)) {
      target.push(candidate)
    }
  }
}

const handleAddEnd = () => {
  if (fields.value.type !== RuleType.InsertionPoint) {
    if (!fields.value.payload.trim()) {
      message.warn('workspace.required')
      return false
    }
    if (fields.value.type === RuleType.Inline && !isValidJson(fields.value.payload)) {
      message.error('kernel.route.rules.invalid')
      return false
    }
  }
  if (fields.value.action === RuleAction.RouteOptions && !isValidJson(fields.value.outbound)) {
    message.error('kernel.route.rules.invalid')
    return false
  }
  if (fields.value.action === RuleAction.Route && targetType.value === 'outbound' && !fields.value.outbound) {
    message.warn('workspace.required')
    return false
  }
  if (fields.value.action === RuleAction.Route && targetType.value === 'group') {
    if (!applyNodeGroupOutlet()) return false
  }
  if (fields.value.type === RuleType.RuleSet && pendingRulesets.value.length) {
    const selectedIds = new Set(fields.value.payload.split(',').filter(Boolean))
    commitPendingRulesets(props.ruleSet, pendingRulesets.value, selectedIds)
    pendingRulesets.value = []
  }
  if (ruleId !== -1) {
    model.value[ruleId] = fields.value
  } else {
    const index = model.value.findIndex((v) => v.type === RuleType.InsertionPoint)
    if (index !== -1) {
      model.value.splice(index + 1, 0, fields.value)
    } else {
      model.value.unshift(fields.value)
    }
  }
}

const handleEdit = (index: number) => {
  ruleId = index
  fields.value = deepClone(model.value[index]!)
  rulesetQuery.value = ''
  pendingRulesets.value = []
  const generated = props.outbounds.find((outbound) => outbound.id === fields.value.outbound)
  targetType.value = generated?.source_node_group ? 'group' : 'outbound'
  outletNodeGroup.value = generated?.source_node_group || ''
  outletBehavior.value = generated?.type === 'urltest' ? 'auto' : 'manual'
  resetOutletPreProxy()
  if (generated?.source_node_group) {
    if (generated.pre_proxy) {
      const upstream = props.outbounds.find((outbound) => outbound.id === generated.pre_proxy)
      if (upstream?.source_node_group) {
        outletPreProxyMode.value = generated.pre_proxy_override ? 'replace-group' : 'stack-group'
        outletPreProxyGroup.value = upstream.source_node_group
        outletPreProxyBehavior.value = upstream.type === 'urltest' ? 'auto' : 'manual'
      } else {
        outletCustomPreProxyOutboundId.value = generated.id
      }
    } else if (generated.pre_proxy_override) {
      outletPreProxyMode.value = 'none'
    }
  }
  showEditModal.value = true
}

const applyNodeGroupOutlet = () => {
  const group = nodeGroupsStore.getNodeGroupById(outletNodeGroup.value)
  if (!group) {
    message.error(t('kernel.outbounds.missingNodeGroup', [outletNodeGroup.value]))
    return false
  }
  if (
    outletCustomPreProxyOutboundId.value &&
    outletPreProxyMode.value === 'inherit' &&
    fields.value.outbound === outletCustomPreProxyOutboundId.value
  ) {
    return true
  }
  const label = t(
    outletBehavior.value === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual',
  )
  let preProxy: NodeGroupOutletPreProxyOption = { mode: 'inherit' }
  if (outletPreProxyMode.value === 'none') {
    preProxy = { mode: 'none' }
  } else if (
    outletPreProxyMode.value === 'replace-group' ||
    outletPreProxyMode.value === 'stack-group'
  ) {
    const preGroup = nodeGroupsStore.getNodeGroupById(outletPreProxyGroup.value)
    if (!preGroup) {
      message.error(t('kernel.outbounds.missingNodeGroup', [outletPreProxyGroup.value]))
      return false
    }
    preProxy = {
      mode: outletPreProxyMode.value,
      group: preGroup,
      behavior: outletPreProxyBehavior.value,
      behaviorLabel: t(
        outletPreProxyBehavior.value === 'auto'
          ? 'nodeGroups.outletAuto'
          : 'nodeGroups.outletManual',
      ),
    }
  }
  fields.value.outbound = ensureNodeGroupOutlet(
    props.outbounds,
    group,
    outletBehavior.value,
    label,
    { role: 'outlet', preProxy },
  ).id
  return true
}

const updateRuleType = () => {
  const { type } = fields.value
  if (type === RuleType.IpIsPrivate || type === RuleType.IpAcceptAny) fields.value.payload = 'true'
  else if (type === RuleType.ClashMode) fields.value.payload = ClashMode.Global
  else if (type === RuleType.Inline) fields.value.payload = '{}'
  else fields.value.payload = ''
}
const updateRuleAction = () => {
  const { action } = fields.value
  targetType.value = 'outbound'
  outletNodeGroup.value = ''
  outletBehavior.value = 'manual'
  resetOutletPreProxy()
  fields.value.sniffer = []
  fields.value.server = ''
  fields.value.strategy = Strategy.Default
  if (action === RuleAction.Reject) fields.value.outbound = RuleActionReject.Default
  else if (action === RuleAction.RouteOptions) fields.value.outbound = '{}'
  else
    fields.value.outbound = action === RuleAction.Route ? props.outboundOptions[0]?.value || '' : ''
}

const handleUse = (ruleset: any) => {
  const ids = fields.value.payload.split(',').filter((v) => v)
  const idx = ids.findIndex((v) => v === ruleset.id)
  if (idx === -1) {
    ids.push(ruleset.id)
  } else {
    ids.splice(idx, 1)
  }
  fields.value.payload = ids.join(',')
}

const handleClearRuleset = (ruleset: any) => {
  const ids = ruleset.payload
    .split(',')
    .filter((id: string) => props.ruleSet.some((v) => v.id === id))
  ruleset.payload = ids.join(',')
}

const handleDelete = (index: number) => {
  model.value.splice(index, 1)
}

const showLost = () => message.warn('kernel.route.rules.invalid')

const isSupportPayload = computed(() => {
  return ![RuleType.RuleSet].includes(fields.value.type as any)
})

const isInsertionPointMissing = computed(
  () => model.value.findIndex((rule) => rule.type === RuleType.InsertionPoint) === -1,
)

const hasLost = (rule: App.Rule) => {
  const rulesValidationFlags: boolean[] = []
  const hasMissingInbound = !props.inboundOptions.find((v) => v.value === rule.payload)
  const hasMissingOutbound = !props.outboundOptions.find((v) => v.value === rule.outbound)
  const hasMissingRuleset = rule.payload
    .split(',')
    .some((id) => !props.ruleSet.find((v) => v.id === id))
  if (rule.action === RuleAction.Route) {
    rulesValidationFlags.push(hasMissingOutbound)
  } else if (rule.action === RuleAction.RouteOptions) {
    let isValid = true
    try {
      JSON.parse(rule.outbound)
    } catch {
      isValid = false
    }
    rulesValidationFlags.push(!isValid)
  }
  if (rule.type === RuleType.Inbound) {
    rulesValidationFlags.push(hasMissingInbound)
  } else if (rule.type === RuleType.IpIsPrivate) {
    rulesValidationFlags.push(!['true', 'false'].includes(rule.payload))
  } else if (rule.type === RuleType.RuleSet) {
    rulesValidationFlags.push(hasMissingRuleset)
  }
  return rulesValidationFlags.some((v) => v) || !rule.payload
}

const formatRuleParts = (rule: App.Rule) => {
  const { type, payload, outbound, action, invert } = rule
  let displayPayload = payload
  if (type === RuleType.RuleSet) {
    displayPayload = rule.payload
      .split(',')
      .map((id) => props.ruleSet.find((v) => v.id === id)?.tag || id)
      .join(', ')
  } else if (type === RuleType.Inbound) {
    displayPayload =
      props.inboundOptions.find((v) => v.value === rule.payload)?.label || rule.payload
  }
  const target = outbound
    ? props.outboundOptions.find((v) => v.value === outbound)?.label || outbound
    : ''
  return { type, payload: displayPayload, action, target, invert }
}

const isSystemRule = (rule: App.Rule) =>
  Boolean(
    detectManagedRuleKey(rule, {
      inbounds: props.inbounds || [],
      outbounds: props.outbounds,
      route: { rules: model.value, rule_set: props.ruleSet } as App.Route,
    }),
  )

const systemRulesCount = computed(() => model.value.filter((rule) => isSystemRule(rule)).length)

const directDownloadDetour = computed(
  () => props.outbounds.find((o) => getOutboundRole(o) === 'direct')?.id || '',
)

const allAvailableProfileRulesets = computed(() => [...props.ruleSet, ...pendingRulesets.value])

const filteredProfileRulesets = computed(() => {
  const q = rulesetQuery.value.trim().toLowerCase()
  if (!q) return allAvailableProfileRulesets.value
  return allAvailableProfileRulesets.value.filter(
    (rs) => rs.tag.toLowerCase().includes(q) || rs.type.toLowerCase().includes(q),
  )
})

const filteredPresetRulesets = computed(() => {
  const q = rulesetQuery.value.trim().toLowerCase()
  const existingUrls = new Set(
    allAvailableProfileRulesets.value
      .filter((rs) => rs.type === RulesetType.Remote)
      .map((rs) => rs.url),
  )
  return CommonServiceRulesetPresets.filter((preset) => {
    if (existingUrls.has(preset.url)) return false
    if (!q) return true
    return (
      preset.tag.toLowerCase().includes(q) ||
      t(preset.labelKey).toLowerCase().includes(q) ||
      preset.category.toLowerCase().includes(q)
    )
  })
})

const filteredLocalRulesets = computed(() => {
  const q = rulesetQuery.value.trim().toLowerCase()
  const existingLocalIds = new Set(
    allAvailableProfileRulesets.value
      .filter((rs) => rs.type === RulesetType.Local)
      .map((rs) => rs.path),
  )
  return rulesetsStore.rulesets.filter((rs) => {
    if (existingLocalIds.has(rs.id)) return false
    if (!q) return true
    return rs.name.toLowerCase().includes(q) || rs.path.toLowerCase().includes(q)
  })
})

const HUB_DISPLAY_LIMIT = 24
const hubLoading = ref(false)
const getHubRulesetUrl = (item: App.RulesetHub['list'][number]) => {
  const base =
    item.type === 'geosite' ? rulesetsStore.rulesetHub?.geosite : rulesetsStore.rulesetHub?.geoip
  return base ? `${base}${item.name}.srs` : ''
}
const allFilteredHubRulesets = computed(() => {
  const list = rulesetsStore.rulesetHub?.list || []
  if (!list.length) return []
  const q = rulesetQuery.value.trim().toLowerCase()
  const existingUrls = new Set([
    ...allAvailableProfileRulesets.value
      .filter((rs) => rs.type === RulesetType.Remote)
      .map((rs) => rs.url),
    ...CommonServiceRulesetPresets.map((preset) => preset.url),
  ])
  return list.filter((item) => {
    const url = getHubRulesetUrl(item)
    if (!url || existingUrls.has(url)) return false
    if (!q) return true
    return item.name.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
  })
})
const visibleHubRulesets = computed(() => allFilteredHubRulesets.value.slice(0, HUB_DISPLAY_LIMIT))
const hasHubLoader = computed(() => typeof rulesetsStore.updateRulesetHub === 'function')
const handleLoadRulesetHub = async () => {
  if (hubLoading.value || !hasHubLoader.value) return
  hubLoading.value = true
  try {
    await rulesetsStore.updateRulesetHub()
  } catch (error: any) {
    message.error(error?.message || error)
  } finally {
    hubLoading.value = false
  }
}

const stageProfileRuleset = (
  spec:
    | { kind: 'local'; id: string; tag: string; format: App.RuleSet['format'] }
    | {
        kind: 'remote'
        url: string
        tag: string
        format: App.RuleSet['format']
        downloadDetour?: string
      },
) => {
  const existing =
    spec.kind === 'local'
      ? allAvailableProfileRulesets.value.find(
          (item) => item.type === RulesetType.Local && item.path === spec.id,
        )
      : allAvailableProfileRulesets.value.find(
          (item) => item.type === RulesetType.Remote && item.url === spec.url,
        )
  if (existing) return existing
  const snapshot = [...props.ruleSet, ...pendingRulesets.value]
  const created = ensureProfileRuleset(snapshot, spec)
  pendingRulesets.value.push(created)
  return created
}

const handleUseHubRuleset = (item: App.RulesetHub['list'][number]) => {
  const url = getHubRulesetUrl(item)
  if (!url) return
  handleUse(
    stageProfileRuleset({
      kind: 'remote',
      url,
      tag: `${item.type}-${item.name}`,
      format: RulesetFormat.Binary,
      downloadDetour: directDownloadDetour.value,
    }),
  )
}

const handleUsePresetRuleset = (preset: ServiceRulesetPreset) => {
  handleUse(
    stageProfileRuleset({
      kind: 'remote',
      url: preset.url,
      tag: preset.tag,
      format: preset.format,
      downloadDetour: directDownloadDetour.value,
    }),
  )
}

const handleUseLocalRuleset = (ruleset: App.RuleSet) => {
  handleUse(
    stageProfileRuleset({
      kind: 'local',
      id: ruleset.id,
      tag: ruleset.name,
      format: ruleset.format,
    }),
  )
}

const isRulesetSelected = (id: string) => fields.value.payload.split(',').includes(id)
const resetTarget = () => {
  fields.value.outbound = ''
  outletNodeGroup.value = ''
  outletBehavior.value = 'manual'
  resetOutletPreProxy()
}
</script>

<template>
  <Empty v-if="model.length === 0 || (model.length === 1 && !isInsertionPointMissing)">
    <template #description>
      <Button icon="add" type="primary" size="small" @click="handleAdd">
        {{ t('common.add') }}
      </Button>
    </template>
  </Empty>

  <div v-else class="flex flex-wrap items-center justify-between gap-8 mb-8">
    <div v-if="systemRulesCount > 0" class="flex items-center gap-6 text-12 text-muted">
      <Switch v-model="hideSystemRules" size="small" />
      <span>{{ t('profileSimple.hideSystemRules', [systemRulesCount]) }}</span>
    </div>
    <div class="ml-auto flex items-center gap-6">
      <Button v-if="showCleanup" size="small" type="text" @click="emit('cleanupUnused')">
        {{ t('profileSimple.cleanupUnused') }}
      </Button>
      <Button icon="add" type="primary" size="small" @click="handleAdd">
        {{ t('common.add') }}
      </Button>
    </div>
  </div>

  <Divider v-if="isInsertionPointMissing">
    <Button type="text" size="small" @click="handleAddInsertionPoint">
      {{ t('kernel.addInsertionPoint') }}
    </Button>
  </Divider>

  <div v-draggable="[model, DraggableOptions]">
    <Card
      v-for="(rule, index) in model"
      v-show="!hideSystemRules || !isSystemRule(rule)"
      :key="rule.id"
      flush
      class="mb-6"
    >
      <div v-if="rule.type === RuleType.InsertionPoint" class="text-center font-bold">
        <Divider class="cursor-move">
          <Button icon="add" type="text" size="small" @click="handleAdd">
            {{ t('kernel.insertionPoint') }}
          </Button>
        </Divider>
      </div>
      <div v-else class="flex items-start py-6 gap-8">
        <Icon icon="drag" :size="15" color="var(--muted-color)" class="cursor-move shrink-0 mt-2" />
        <div class="shrink-0">
          <Switch v-model="rule.enable" border="square" size="small" />
        </div>
        <div class="flex-1 rule-content flex items-center gap-6 flex-wrap text-13">
          <Button
            v-if="hasLost(rule)"
            v-tips="'kernel.route.rules.invalid'"
            icon="warn"
            icon-color="var(--warning-color)"
            type="text"
            size="small"
            @click="showLost"
          />
          <Tag size="small" color="cyan">{{ formatRuleParts(rule).type }}</Tag>
          <span v-if="formatRuleParts(rule).payload" class="font-mono text-12 break-all">
            {{ formatRuleParts(rule).payload }}
          </span>
          <Tag v-if="formatRuleParts(rule).invert" size="small" color="orange">invert</Tag>
          <span class="text-muted" aria-hidden="true">→</span>
          <Tag
            size="small"
            :color="formatRuleParts(rule).action === RuleAction.Reject ? 'red' : 'blue'"
          >
            {{ formatRuleParts(rule).action }}
          </Tag>
          <Tag v-if="formatRuleParts(rule).target" size="small" color="default">
            {{ formatRuleParts(rule).target }}
          </Tag>
        </div>
        <div class="ml-auto shrink-0 flex items-center gap-2">
          <Button
            v-if="rule.type === RuleType.RuleSet && rule.payload && hasLost(rule)"
            type="text"
            size="small"
            @click="handleClearRuleset(rule)"
          >
            {{ t('common.clear') }}
          </Button>
          <Button
            icon="edit"
            type="text"
            size="small"
            :aria-label="t('common.edit')"
            @click="handleEdit(index)"
          />
          <Button
            icon="delete"
            icon-color="var(--danger-color)"
            type="text"
            size="small"
            :aria-label="t('common.delete')"
            @click="handleDelete(index)"
          />
        </div>
      </div>
    </Card>
  </div>

  <Modal
    v-model:open="showEditModal"
    size="drawer"
    :on-ok="handleAddEnd"
    title="kernel.route.tab.rules"
  >
    <div class="form-item">
      {{ t('kernel.route.rules.type') }}
      <Select v-model="fields.type" :options="RulesTypeOptions" @change="updateRuleType" />
    </div>
    <div class="form-item">
      {{ t('kernel.route.rules.action.name') }}
      <Radio v-model="fields.action" :options="RuleActionOptions" @change="updateRuleAction" />
    </div>
    <div v-if="isSupportPayload" class="form-item">
      {{ t('kernel.route.rules.payload') }}
      <Radio
        v-if="fields.type === RuleType.ClashMode"
        v-model="fields.payload"
        :options="[
          {
            label: 'kernel.global',
            value: ClashMode.Global,
          },
          {
            label: 'kernel.direct',
            value: ClashMode.Direct,
          },
        ]"
      />
      <Select
        v-else-if="fields.type === RuleType.Inbound"
        v-model="fields.payload"
        :options="inboundOptions"
      />
      <CodeEditor
        v-else-if="fields.type === RuleType.Inline"
        v-model="fields.payload"
        editable
        lang="json"
        class="w-full"
      />
      <Switch
        v-else-if="fields.type === RuleType.IpIsPrivate"
        :model-value="fields.payload === 'true'"
        @change="(val) => (fields.payload = val ? 'true' : 'false')"
      />
      <Input v-else v-model="fields.payload" autofocus />
    </div>
    <div class="form-item">
      {{ t('kernel.route.rules.invert') }}
      <Switch v-model="fields.invert" />
    </div>
    <Card class="mt-4 mb-16">
      <template v-if="fields.action === RuleAction.Route">
        <div v-if="nodeGroupOptions.length || targetType === 'group'" class="form-item">
          {{ t('kernel.route.rules.targetType') }}
          <Radio
            v-model="targetType"
            :options="[
              { label: 'kernel.route.rules.outbound', value: 'outbound' },
              { label: 'router.nodeGroups', value: 'group' },
            ]"
            @change="resetTarget"
          />
        </div>
        <div v-if="targetType === 'outbound'" class="form-item">
          {{ t('kernel.route.rules.outbound') }}
          <Select
            v-model="fields.outbound"
            :options="outboundOptions"
            clearable
            @change="outletNodeGroup = ''"
          />
        </div>
        <div v-else class="flex flex-col gap-8">
          <div class="form-item">
            {{ t('router.nodeGroups') }}
            <div class="flex flex-wrap items-center gap-8">
              <Select
                v-model="outletNodeGroup"
                :options="nodeGroupOptions"
                clearable
                @change="
                  () => {
                    fields.outbound = ''
                    resetOutletPreProxy()
                  }
                "
              />
              <Radio
                v-model="outletBehavior"
                :options="[
                  { label: 'nodeGroups.outletManual', value: 'manual' },
                  { label: 'nodeGroups.outletAuto', value: 'auto' },
                ]"
                @change="fields.outbound = ''"
              />
            </div>
          </div>
          <div v-if="outletNodeGroup && preProxyGroupOptions.length" class="form-item">
            {{ t('nodeGroups.preProxyOutletMode') }}
            <div class="flex flex-col gap-8 w-full">
              <Select
                v-model="outletPreProxyMode"
                :options="outletPreProxyModeOptions"
                @change="fields.outbound = ''"
              />
              <div
                v-if="
                  outletPreProxyMode === 'replace-group' || outletPreProxyMode === 'stack-group'
                "
                class="flex flex-wrap items-center gap-8"
              >
                <Select
                  v-model="outletPreProxyGroup"
                  :options="preProxyGroupOptions"
                  clearable
                  :placeholder="t('nodeGroups.preProxy')"
                  @change="fields.outbound = ''"
                />
                <Radio
                  v-model="outletPreProxyBehavior"
                  :options="[
                    { label: 'nodeGroups.outletManual', value: 'manual' },
                    { label: 'nodeGroups.outletAuto', value: 'auto' },
                  ]"
                  @change="fields.outbound = ''"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="fields.action === RuleAction.RouteOptions">
        <div class="form-item">
          {{ t('kernel.route.rules.routeOptions') }}
          <CodeEditor v-model="fields.outbound" editable lang="json" class="w-full" />
        </div>
      </template>
      <template v-else-if="fields.action === RuleAction.Reject">
        <div class="form-item">
          {{ t('kernel.route.rules.action.rejectMethod') }}
          <Radio v-model="fields.outbound" :options="RuleActionRejectOptions" />
        </div>
      </template>
      <template v-else-if="fields.action === RuleAction.HijackDNS">
        <Empty description="common.none" />
      </template>
      <template v-else-if="fields.action === RuleAction.Sniff">
        <div class="form-item">
          {{ t('kernel.route.rules.sniffer.name') }}
          <Select
            v-model="fields.sniffer"
            multiple
            clearable
            :options="RuleSnifferOptions"
            placeholder="All"
          />
        </div>
      </template>
      <template v-else-if="fields.action === RuleAction.Resolve">
        <div class="form-item">
          {{ t('kernel.strategy.name') }}
          <Select v-model="fields.strategy" :options="DomainStrategyOptions" />
        </div>
        <div class="form-item">
          {{ t('kernel.route.rules.server') }}
          <Select
            v-model="fields.server"
            :options="[{ label: 'kernel.strategy.byDnsRules', value: '' }, ...serverOptions]"
          />
        </div>
      </template>
    </Card>
    <template v-if="fields.type === RuleType.RuleSet">
      <Divider>{{ t('kernel.route.tab.rule_set') }}</Divider>
      <div class="mb-8">
        <Input
          v-model="rulesetQuery"
          size="small"
          clearable
          :placeholder="t('profileSimple.searchRulesets')"
          class="w-full"
        />
      </div>
      <div v-if="filteredProfileRulesets.length" class="responsive-card-grid mb-12">
        <Card
          v-for="ruleset in filteredProfileRulesets"
          :key="ruleset.id"
          v-tips="ruleset.type"
          :title="ruleset.tag"
          :selected="isRulesetSelected(ruleset.id)"
          interactive
          class="ruleset"
          @click="handleUse(ruleset)"
        >
          <div class="text-12 text-muted">
            {{ ruleset.type }}
            {{ ruleset.type === RulesetType.Inline ? RulesetFormat.Source : ruleset.format }}
          </div>
        </Card>
      </div>
      <template v-if="filteredPresetRulesets.length">
        <Divider>{{ t('profileSimple.commonServicesAutoRegister') }}</Divider>
        <div class="responsive-card-grid mb-12">
          <Card
            v-for="preset in filteredPresetRulesets"
            :key="preset.id"
            :title="t(preset.labelKey)"
            interactive
            class="ruleset"
            @click="handleUsePresetRuleset(preset)"
          >
            <div class="text-12 text-muted">{{ preset.tag }}</div>
          </Card>
        </div>
      </template>
      <template v-if="filteredLocalRulesets.length">
        <Divider>{{ t('profileSimple.localRulesetsAutoRegister') }}</Divider>
        <div class="responsive-card-grid mb-12">
          <Card
            v-for="ruleset in filteredLocalRulesets"
            :key="ruleset.id"
            :title="ruleset.name"
            interactive
            class="ruleset"
            @click="handleUseLocalRuleset(ruleset)"
          >
            <div class="text-12 text-muted break-all">{{ ruleset.path }}</div>
          </Card>
        </div>
      </template>
      <template v-if="visibleHubRulesets.length">
        <Divider>{{ t('profileSimple.rulesetHubAutoRegister') }}</Divider>
        <div
          v-if="allFilteredHubRulesets.length > visibleHubRulesets.length"
          class="text-12 text-muted mb-8"
        >
          {{
            t('profileSimple.rulesetHubShowingFirst', [
              visibleHubRulesets.length,
              allFilteredHubRulesets.length,
            ])
          }}
        </div>
        <div class="responsive-card-grid mb-12">
          <Card
            v-for="item in visibleHubRulesets"
            :key="item.type + ':' + item.name"
            :title="item.name"
            interactive
            class="ruleset"
            @click="handleUseHubRuleset(item)"
          >
            <div class="text-12 text-muted">{{ item.type }} · {{ item.count }}</div>
          </Card>
        </div>
      </template>
      <div
        v-else-if="!(rulesetsStore.rulesetHub?.list?.length) && hasHubLoader"
        class="flex justify-center my-8"
      >
        <Button size="small" :loading="hubLoading" @click="handleLoadRulesetHub">
          {{ t('profileSimple.loadRulesetHub') }}
        </Button>
      </div>
      <Empty
        v-if="
          !filteredProfileRulesets.length &&
          !filteredPresetRulesets.length &&
          !filteredLocalRulesets.length &&
          !visibleHubRulesets.length
        "
        :description="t('kernel.route.rule_set.empty')"
      />
    </template>
  </Modal>
</template>

<style lang="less" scoped>
.rule-content {
  min-width: 0;
  word-break: break-all;
}
</style>
