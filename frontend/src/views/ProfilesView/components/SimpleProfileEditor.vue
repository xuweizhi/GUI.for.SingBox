<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { DefaultOutboundIds } from '@/constant/outbound'
import { DefaultRouteRule } from '@/constant/profile'
import {
  CommonServiceRulesetPresets,
  ProfilePresetOptions,
  type ServiceRulesetPreset,
} from '@/constant/profilePresets'
import { Inbound, Outbound, RuleAction, RuleType } from '@/enums/kernel'
import { useNodeGroupsStore, useRulesetsStore, useSubscribesStore } from '@/stores'
import {
  applyDnsPreset,
  applyProfilePreset,
  detectDnsPreset,
  detectManagedRuleKey,
  detectProfilePreset,
  ensureNodeGroupOutlet,
  ensureProfileRuleset,
  getManagedToggleStates,
  getOutboundRole,
  getPrimaryProxyOutbound,
  message,
  normalizeQuickRules,
  pruneUnusedNodeGroupOutlets,
  pruneUnusedProfileRulesets,
  setInitialOutboundTarget,
  setManagedToggle,
  splitQuickRuleLines,
  type ManagedToggleKey,
  type NodeGroupOutletBehavior,
  type NodeGroupOutletPreProxyOption,
} from '@/utils'

const profile = defineModel<App.Profile>({ required: true })
const emit = defineEmits<{ openAdvancedStep: [step: number] }>()

const { t } = useI18n()
const subscribesStore = useSubscribesStore()
const nodeGroupsStore = useNodeGroupsStore()
const rulesetsStore = useRulesetsStore()

// --- Card 1: Proxy Sources, Primary Pre-Proxy, and Inbounds ---
const primaryOutbound = computed(() => getPrimaryProxyOutbound(profile.value))
const autoOutbound = computed(() =>
  profile.value.outbounds.find((outbound) => getOutboundRole(outbound) === 'auto'),
)

const selectedSubscriptionIds = computed({
  get: () =>
    (primaryOutbound.value?.outbounds || [])
      .filter((member) => member.type === 'Subscription')
      .map((member) => member.id),
  set: (ids: string[]) => {
    const primary = primaryOutbound.value
    if (!primary) return
    const nextSubs: App.Proxy[] = ids.map((id) => ({
      id,
      tag: subscribesStore.getSubscribeById(id)?.name || id,
      type: 'Subscription',
    }))
    const keepNonSub = primary.outbounds.filter((member) => member.type !== 'Subscription')
    primary.outbounds = [...keepNonSub, ...nextSubs]
    if (autoOutbound.value) {
      const keepAuto = autoOutbound.value.outbounds.filter(
        (member) => member.type !== 'Subscription',
      )
      autoOutbound.value.outbounds = [...keepAuto, ...nextSubs]
    }
  },
})

const isManagedSubgroupOutbound = (outbound?: App.Outbound): outbound is App.Outbound =>
  Boolean(
    outbound &&
      outbound.source_node_group &&
      outbound.source_node_group_role !== 'pre_proxy' &&
      !outbound.pre_proxy &&
      !outbound.pre_proxy_override &&
      !outbound.include &&
      !outbound.exclude &&
      outbound.outbounds.length === 1 &&
      outbound.outbounds[0]?.type === 'NodeGroup' &&
      outbound.outbounds[0]?.id === outbound.source_node_group,
  )

const getPrimarySubgroupMembers = (primary?: App.Outbound) => {
  if (!primary) return []
  const byId = new Map(profile.value.outbounds.map((item) => [item.id, item]))
  return primary.outbounds.flatMap((member) => {
    if (member.type !== 'Built-in') return []
    const target = byId.get(member.id)
    if (!isManagedSubgroupOutbound(target)) return []
    return [
      {
        member,
        outbound: target,
        groupId: target.source_node_group!,
        behavior: (target.type === Outbound.Urltest ? 'auto' : 'manual') as NodeGroupOutletBehavior,
      },
    ]
  })
}

const detectPrimaryNodeGroupMode = (primary?: App.Outbound): 'subgroup' | 'flatten' => {
  if (!primary) return 'subgroup'
  const hasSubgroup = getPrimarySubgroupMembers(primary).length > 0
  const hasDirectGroup = primary.outbounds.some((member) => member.type === 'NodeGroup')
  return hasDirectGroup && !hasSubgroup ? 'flatten' : 'subgroup'
}

const primaryNodeGroupMode = ref<'subgroup' | 'flatten'>(
  detectPrimaryNodeGroupMode(primaryOutbound.value),
)

watch(
  () => profile.value.id,
  () => {
    primaryNodeGroupMode.value = detectPrimaryNodeGroupMode(primaryOutbound.value)
  },
)

const selectedNodeGroupIds = computed({
  get: () => {
    const primary = primaryOutbound.value
    if (!primary) return []
    const ids: string[] = []
    const seen = new Set<string>()
    const add = (id: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      ids.push(id)
    }
    const byId = new Map(profile.value.outbounds.map((item) => [item.id, item]))
    primary.outbounds.forEach((member) => {
      if (member.type === 'NodeGroup') {
        add(member.id)
      } else if (member.type === 'Built-in') {
        const target = byId.get(member.id)
        if (isManagedSubgroupOutbound(target)) add(target.source_node_group!)
      }
    })
    return ids
  },
  set: (ids: string[]) => {
    const primary = primaryOutbound.value
    if (!primary) return
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    const existingSubgroups = getPrimarySubgroupMembers(primary)
    const behaviorByGroupId = new Map(
      existingSubgroups.map((item) => [item.groupId, item.behavior] as const),
    )
    const managedSubgroupIds = new Set(existingSubgroups.map((item) => item.outbound.id))
    const keepUnrelated = primary.outbounds.filter(
      (member) =>
        member.type !== 'NodeGroup' &&
        !(member.type === 'Built-in' && managedSubgroupIds.has(member.id)),
    )

    if (primaryNodeGroupMode.value === 'subgroup') {
      const nextSubgroupMembers: App.Proxy[] = []
      for (const id of uniqueIds) {
        const group = nodeGroupsStore.getNodeGroupById(id)
        if (!group) continue
        const behavior = behaviorByGroupId.get(id) ?? 'auto'
        const outlet = ensureNodeGroupOutlet(
          profile.value.outbounds,
          group,
          behavior,
          t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
          { role: 'outlet' },
        )
        if (outlet.id !== primary.id) {
          nextSubgroupMembers.push({ id: outlet.id, tag: outlet.tag, type: 'Built-in' })
        }
      }
      primary.outbounds = [...keepUnrelated, ...nextSubgroupMembers]
    } else {
      const nextDirectGroups: App.Proxy[] = uniqueIds.map((id) => ({
        id,
        tag: nodeGroupsStore.getNodeGroupById(id)?.name || id,
        type: 'NodeGroup',
      }))
      primary.outbounds = [...keepUnrelated, ...nextDirectGroups]
    }

    if (autoOutbound.value) {
      const nextAutoGroups: App.Proxy[] = uniqueIds.map((id) => ({
        id,
        tag: nodeGroupsStore.getNodeGroupById(id)?.name || id,
        type: 'NodeGroup',
      }))
      const keepAuto = autoOutbound.value.outbounds.filter((member) => member.type !== 'NodeGroup')
      autoOutbound.value.outbounds = [...keepAuto, ...nextAutoGroups]
    }

    pruneUnusedNodeGroupOutlets(profile.value)
  },
})

const selectedSubgroupItems = computed(() => {
  if (primaryNodeGroupMode.value !== 'subgroup') return []
  return getPrimarySubgroupMembers(primaryOutbound.value).map((item) => ({
    groupId: item.groupId,
    name: nodeGroupsStore.getNodeGroupById(item.groupId)?.name || item.outbound.tag,
    outboundId: item.outbound.id,
    behavior: item.behavior,
  }))
})

const handleChangePrimaryNodeGroupMode = (mode: 'subgroup' | 'flatten') => {
  primaryNodeGroupMode.value = mode
  if (selectedNodeGroupIds.value.length) {
    selectedNodeGroupIds.value = [...selectedNodeGroupIds.value]
  }
}

const togglePrimarySubgroupBehavior = (groupId: string) => {
  const primary = primaryOutbound.value
  const group = nodeGroupsStore.getNodeGroupById(groupId)
  if (!primary || !group) return
  const existing = getPrimarySubgroupMembers(primary).find((item) => item.groupId === groupId)
  if (!existing) return
  const nextBehavior: NodeGroupOutletBehavior = existing.behavior === 'auto' ? 'manual' : 'auto'
  const outlet = ensureNodeGroupOutlet(
    profile.value.outbounds,
    group,
    nextBehavior,
    t(nextBehavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
    { role: 'outlet' },
  )
  const idx = primary.outbounds.findIndex(
    (member) => member.type === 'Built-in' && member.id === existing.outbound.id,
  )
  if (idx !== -1) {
    primary.outbounds[idx] = { id: outlet.id, tag: outlet.tag, type: 'Built-in' }
  }
  pruneUnusedNodeGroupOutlets(profile.value)
}

const subscriptionOptions = computed(() =>
  subscribesStore.subscribes.map((sub) => ({ label: sub.name, value: sub.id })),
)
const nodeGroupOptions = computed(() =>
  nodeGroupsStore.nodeGroups.map((group) => ({ label: group.name, value: group.id })),
)

const primaryPreProxyGroupOptions = computed(() =>
  nodeGroupsStore.nodeGroups
    .filter(
      (group) =>
        group.id !== primaryOutbound.value?.source_node_group &&
        (group.id === primaryPreProxyGroupId.value || !selectedNodeGroupIds.value.includes(group.id)),
    )
    .map((group) => ({ label: group.name, value: group.id })),
)

const primaryPreProxyGroupId = computed({
  get: () => {
    const preId = primaryOutbound.value?.pre_proxy
    if (!preId) return ''
    return (
      profile.value.outbounds.find((outbound) => outbound.id === preId)?.source_node_group || ''
    )
  },
  set: (groupId: string) => {
    const primary = primaryOutbound.value
    if (!primary) return
    if (!groupId) {
      primary.pre_proxy = ''
      return
    }
    if (groupId === primary.source_node_group) return
    const group = nodeGroupsStore.getNodeGroupById(groupId)
    if (!group) return
    const behavior = primaryPreProxyBehavior.value
    const upstream = ensureNodeGroupOutlet(
      profile.value.outbounds,
      group,
      behavior,
      t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
      { role: 'pre_proxy' },
    )
    if (upstream.id === primary.id) return
    primary.pre_proxy = upstream.id
  },
})

const primaryPreProxyBehavior = computed<NodeGroupOutletBehavior>({
  get: () => {
    const preId = primaryOutbound.value?.pre_proxy
    if (!preId) return 'manual'
    return profile.value.outbounds.find((outbound) => outbound.id === preId)?.type ===
      Outbound.Urltest
      ? 'auto'
      : 'manual'
  },
  set: (behavior: NodeGroupOutletBehavior) => {
    const groupId = primaryPreProxyGroupId.value
    if (!groupId || !primaryOutbound.value) return
    if (groupId === primaryOutbound.value.source_node_group) return
    const group = nodeGroupsStore.getNodeGroupById(groupId)
    if (!group) return
    const upstream = ensureNodeGroupOutlet(
      profile.value.outbounds,
      group,
      behavior,
      t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
      { role: 'pre_proxy' },
    )
    if (upstream.id === primaryOutbound.value.id) return
    primaryOutbound.value.pre_proxy = upstream.id
  },
})

const mixedInbound = computed(() =>
  profile.value.inbounds.find((inbound) => inbound.type === Inbound.Mixed),
)
const tunInbound = computed(() =>
  profile.value.inbounds.find((inbound) => inbound.type === Inbound.Tun),
)

// --- Card 2: Routing Preset, Fallback, and System Toggles ---
const currentPreset = computed(() => detectProfilePreset(profile.value))
const handleSelectPreset = (preset: App.ProfilePreset) => {
  applyProfilePreset(profile.value, preset)
}

const directOutbound = computed(() =>
  profile.value.outbounds.find((outbound) => getOutboundRole(outbound) === 'direct'),
)
const blockOutbound = computed(() =>
  profile.value.outbounds.find((outbound) => getOutboundRole(outbound) === 'block'),
)
const fallbackOutbound = computed(() =>
  profile.value.outbounds.find((outbound) => getOutboundRole(outbound) === 'fallback'),
)

const fallbackTarget = computed({
  get: () => {
    const fb = fallbackOutbound.value
    if (fb && profile.value.route.final === fb.id) {
      return fb.outbounds[0]?.id || ''
    }
    return profile.value.route.final
  },
  set: (targetId: string) => {
    if (!targetId) return
    const fb = fallbackOutbound.value
    const target = profile.value.outbounds.find((outbound) => outbound.id === targetId)
    if (fb && target && ['proxy', 'direct', 'block'].includes(getOutboundRole(target))) {
      setInitialOutboundTarget(fb, target.id, target.tag)
      profile.value.route.final = fb.id
    } else {
      profile.value.route.final = targetId
    }
  },
})

const fallbackOptions = computed(() => {
  const options: { label: string; value: string }[] = []
  if (primaryOutbound.value) {
    options.push({
      label: `${t('profileSimple.targetProxy')} (${primaryOutbound.value.tag})`,
      value: primaryOutbound.value.id,
    })
  }
  if (directOutbound.value) {
    options.push({
      label: `${t('profileSimple.targetDirect')} (${directOutbound.value.tag})`,
      value: directOutbound.value.id,
    })
  }
  if (blockOutbound.value) {
    options.push({
      label: `${t('profileSimple.targetBlock')} (${blockOutbound.value.tag})`,
      value: blockOutbound.value.id,
    })
  }
  return options
})

const managedToggles = computed(() => getManagedToggleStates(profile.value))
const toggleItems: Array<{ key: ManagedToggleKey; labelKey: string }> = [
  { key: 'directPrivate', labelKey: 'profileSimple.toggleDirectPrivate' },
  { key: 'blockAds', labelKey: 'profileSimple.toggleBlockAds' },
  { key: 'blockQuic', labelKey: 'profileSimple.toggleBlockQuic' },
  { key: 'tunSniff', labelKey: 'profileSimple.toggleTunSniff' },
  { key: 'hijackDns', labelKey: 'profileSimple.toggleHijackDns' },
  { key: 'clashModes', labelKey: 'profileSimple.toggleClashModes' },
  { key: 'directIcmp', labelKey: 'profileSimple.toggleDirectIcmp' },
]

const handleToggleManaged = (key: ManagedToggleKey, value: boolean) => {
  setManagedToggle(profile.value, key, value)
}

// --- Card 3: Quick Custom Rules (Direct / Proxy / Block) ---
const quickDirectText = ref('')
const quickProxyText = ref('')
const quickBlockText = ref('')

const syncQuickTextFromProfile = () => {
  const normalized = normalizeQuickRules(profile.value.route.quick_rules)
  quickDirectText.value = normalized.direct.join('\n')
  quickProxyText.value = normalized.proxy.join('\n')
  quickBlockText.value = normalized.block.join('\n')
}
syncQuickTextFromProfile()

watch(
  () => profile.value.route.quick_rules,
  (val) => {
    const normalized = normalizeQuickRules(val)
    if (normalized.direct.join('\n') !== splitQuickRuleLines(quickDirectText.value).join('\n')) {
      quickDirectText.value = normalized.direct.join('\n')
    }
    if (normalized.proxy.join('\n') !== splitQuickRuleLines(quickProxyText.value).join('\n')) {
      quickProxyText.value = normalized.proxy.join('\n')
    }
    if (normalized.block.join('\n') !== splitQuickRuleLines(quickBlockText.value).join('\n')) {
      quickBlockText.value = normalized.block.join('\n')
    }
  },
  { deep: true },
)

const commitQuickRules = () => {
  const next: App.QuickRuleLists = {
    direct: splitQuickRuleLines(quickDirectText.value),
    proxy: splitQuickRuleLines(quickProxyText.value),
    block: splitQuickRuleLines(quickBlockText.value),
  }
  if (next.direct.length || next.proxy.length || next.block.length) {
    profile.value.route.quick_rules = next
  } else {
    delete profile.value.route.quick_rules
  }
}

const quickCounts = computed(() => {
  const normalized = normalizeQuickRules(profile.value.route.quick_rules)
  return {
    direct: normalized.direct.length,
    proxy: normalized.proxy.length,
    block: normalized.block.length,
  }
})

// --- Card 4: Service & Node-Group Routing Rules ---
const isPresetGeoTag = (tag: string) =>
  ['geosite-cn', 'geoip-cn', 'geolocation-!cn'].includes(tag.toLowerCase())

const isCustomServiceRule = (rule: App.Rule) => {
  if (rule.type === RuleType.InsertionPoint) return false
  if (detectManagedRuleKey(rule, profile.value)) return false
  if (rule.type === RuleType.RuleSet && !rule.invert && !rule.payload.includes(',')) {
    const rs = profile.value.route.rule_set.find((item) => item.id === rule.payload)
    if (rs && isPresetGeoTag(rs.tag)) return false
  }
  return rule.action === RuleAction.Route
}

const customServiceRules = computed(() =>
  profile.value.route.rules.filter((rule) => isCustomServiceRule(rule)),
)

const otherAdvancedRulesCount = computed(
  () =>
    profile.value.route.rules.filter(
      (rule) =>
        rule.type !== RuleType.InsertionPoint &&
        !detectManagedRuleKey(rule, profile.value) &&
        !isCustomServiceRule(rule) &&
        !(
          rule.type === RuleType.RuleSet &&
          !rule.invert &&
          !rule.payload.includes(',') &&
          isPresetGeoTag(
            profile.value.route.rule_set.find((item) => item.id === rule.payload)?.tag || '',
          )
        ),
    ).length,
)

const describeRulePayload = (rule: App.Rule) => {
  if (rule.type === RuleType.RuleSet) {
    return rule.payload
      .split(',')
      .map((id) => profile.value.route.rule_set.find((rs) => rs.id === id)?.tag || id)
      .join(', ')
  }
  return `${rule.type}: ${rule.payload}`
}

const describeRuleTarget = (rule: App.Rule) => {
  const outbound = profile.value.outbounds.find((item) => item.id === rule.outbound)
  if (!outbound) return rule.outbound
  if (outbound.pre_proxy) {
    const upstream = profile.value.outbounds.find((item) => item.id === outbound.pre_proxy)
    if (upstream) return `${outbound.tag} ← ${upstream.tag}`
  }
  if (outbound.source_node_group && !outbound.pre_proxy_override) {
    const ng = nodeGroupsStore.getNodeGroupById(outbound.source_node_group)
    if (ng?.pre_proxy_group_id) {
      const preNg = nodeGroupsStore.getNodeGroupById(ng.pre_proxy_group_id)
      if (preNg) return `${outbound.tag} ← ${preNg.name}`
    }
  }
  return outbound.tag
}

const removeRuleById = (ruleId: string) => {
  const index = profile.value.route.rules.findIndex((rule) => rule.id === ruleId)
  if (index !== -1) profile.value.route.rules.splice(index, 1)
}

const handleCleanupUnused = () => {
  const removedRulesets = pruneUnusedProfileRulesets(profile.value)
  const removedOutlets = pruneUnusedNodeGroupOutlets(profile.value)
  const total = removedRulesets.length + removedOutlets.length
  if (total > 0) message.success(t('profileSimple.cleanupDone', [total]))
  else message.info(t('profileSimple.cleanupNone'))
}

// Quick Add / Edit Service Rule Modal
const showAddRuleModal = ref(false)
const editingRuleId = ref('')
const editingNonRulesetType = ref<App.Rule['type'] | ''>('')
const editingNonRulesetPayload = ref('')
const editingCustomOutboundId = ref('')
const editingCustomPreProxyOutletId = ref('')
const addRuleSourceType = ref<'preset' | 'local' | 'existing'>('preset')
const addRulePresetId = ref(CommonServiceRulesetPresets[0]?.id || '')
const addRuleLocalId = ref('')
const addRuleExistingId = ref('')
const addRuleTargetType = ref<'proxy' | 'direct' | 'block' | 'nodeGroup' | 'custom'>('nodeGroup')
const addRuleNodeGroupId = ref('')
const addRuleBehavior = ref<NodeGroupOutletBehavior>('manual')
const addRulePreProxyMode = ref<'inherit' | 'none' | 'replace-group' | 'stack-group'>('inherit')
const addRulePreProxyGroupId = ref('')
const addRulePreProxyBehavior = ref<NodeGroupOutletBehavior>('manual')

const servicePresetOptions = computed(() =>
  CommonServiceRulesetPresets.map((preset) => ({
    label: `${t(preset.labelKey)} (${preset.tag})`,
    value: preset.id,
  })),
)
const localRulesetOptions = computed(() =>
  rulesetsStore.rulesets.map((rs) => ({ label: rs.name, value: rs.id })),
)
const existingRulesetOptions = computed(() =>
  profile.value.route.rule_set.map((rs) => ({ label: rs.tag, value: rs.id })),
)
const addRulePreProxyOptions = computed(() =>
  nodeGroupsStore.nodeGroups
    .filter((group) => group.id !== addRuleNodeGroupId.value)
    .map((group) => ({ label: group.name, value: group.id })),
)
const addRuleSelectedGroupDefaultPre = computed(() => {
  const group = nodeGroupsStore.getNodeGroupById(addRuleNodeGroupId.value)
  return group?.pre_proxy_group_id
    ? nodeGroupsStore.getNodeGroupById(group.pre_proxy_group_id)
    : undefined
})
const addRulePreProxyModeOptions = computed(() => {
  const defaultName = addRuleSelectedGroupDefaultPre.value?.name
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

const openAddServiceRule = () => {
  editingRuleId.value = ''
  editingNonRulesetType.value = ''
  editingNonRulesetPayload.value = ''
  editingCustomOutboundId.value = ''
  editingCustomPreProxyOutletId.value = ''
  addRuleSourceType.value = 'preset'
  addRulePresetId.value = CommonServiceRulesetPresets[0]?.id || ''
  addRuleLocalId.value = localRulesetOptions.value[0]?.value || ''
  addRuleExistingId.value = existingRulesetOptions.value[0]?.value || ''
  addRuleTargetType.value = nodeGroupOptions.value.length ? 'nodeGroup' : 'proxy'
  addRuleNodeGroupId.value = nodeGroupOptions.value[0]?.value || ''
  addRuleBehavior.value = 'manual'
  addRulePreProxyMode.value = 'inherit'
  addRulePreProxyGroupId.value = ''
  addRulePreProxyBehavior.value = 'manual'
  showAddRuleModal.value = true
}

const openEditServiceRule = (rule: App.Rule) => {
  editingRuleId.value = rule.id
  editingCustomOutboundId.value = ''
  editingCustomPreProxyOutletId.value = ''
  addRuleNodeGroupId.value = nodeGroupOptions.value[0]?.value || ''
  addRuleBehavior.value = 'manual'
  addRulePreProxyMode.value = 'inherit'
  addRulePreProxyGroupId.value = ''
  addRulePreProxyBehavior.value = 'manual'

  if (rule.type === RuleType.RuleSet && !rule.payload.includes(',')) {
    editingNonRulesetType.value = ''
    editingNonRulesetPayload.value = ''
    addRuleSourceType.value = 'existing'
    addRuleExistingId.value = rule.payload
    addRulePresetId.value = CommonServiceRulesetPresets[0]?.id || ''
    addRuleLocalId.value = localRulesetOptions.value[0]?.value || ''
  } else {
    editingNonRulesetType.value = rule.type
    editingNonRulesetPayload.value = rule.payload
  }

  const outbound = profile.value.outbounds.find((item) => item.id === rule.outbound)
  if (outbound?.source_node_group) {
    addRuleTargetType.value = 'nodeGroup'
    addRuleNodeGroupId.value = outbound.source_node_group
    addRuleBehavior.value = outbound.type === Outbound.Urltest ? 'auto' : 'manual'
    if (outbound.pre_proxy) {
      const upstream = profile.value.outbounds.find((item) => item.id === outbound.pre_proxy)
      if (upstream?.source_node_group) {
        addRulePreProxyMode.value = outbound.pre_proxy_override ? 'replace-group' : 'stack-group'
        addRulePreProxyGroupId.value = upstream.source_node_group
        addRulePreProxyBehavior.value = upstream.type === Outbound.Urltest ? 'auto' : 'manual'
      } else {
        editingCustomPreProxyOutletId.value = outbound.id
      }
    } else if (outbound.pre_proxy_override) {
      addRulePreProxyMode.value = 'none'
    }
  } else if (outbound && getOutboundRole(outbound) === 'direct') {
    addRuleTargetType.value = 'direct'
  } else if (outbound && getOutboundRole(outbound) === 'block') {
    addRuleTargetType.value = 'block'
  } else if (outbound && outbound.id === primaryOutbound.value?.id) {
    addRuleTargetType.value = 'proxy'
  } else if (rule.outbound) {
    editingCustomOutboundId.value = rule.outbound
    addRuleTargetType.value = 'custom'
  } else {
    addRuleTargetType.value = 'proxy'
  }

  showAddRuleModal.value = true
}

const confirmAddServiceRule = () => {
  // Validate both source and target before mutating profile.route.rule_set or profile.outbounds.
  let presetSpec: ServiceRulesetPreset | undefined
  let localSpec: App.RuleSet | undefined
  if (editingNonRulesetType.value) {
    if (!editingNonRulesetPayload.value.trim()) {
      message.warn('workspace.required')
      return false
    }
  } else if (addRuleSourceType.value === 'preset') {
    presetSpec = CommonServiceRulesetPresets.find((item) => item.id === addRulePresetId.value)
    if (!presetSpec) {
      message.warn('workspace.required')
      return false
    }
  } else if (addRuleSourceType.value === 'local') {
    localSpec = rulesetsStore.getRulesetById(addRuleLocalId.value)
    if (!localSpec) {
      message.warn('workspace.required')
      return false
    }
  } else if (!addRuleExistingId.value) {
    message.warn('workspace.required')
    return false
  }

  let selectedNodeGroup: App.NodeGroup | undefined
  let selectedPreProxyGroup: App.NodeGroup | undefined
  const reuseCustomPreProxyOutlet = Boolean(
    addRuleTargetType.value === 'nodeGroup' &&
      editingCustomPreProxyOutletId.value &&
      addRulePreProxyMode.value === 'inherit' &&
      profile.value.outbounds.find((o) => o.id === editingCustomPreProxyOutletId.value)
        ?.source_node_group === addRuleNodeGroupId.value &&
      (profile.value.outbounds.find((o) => o.id === editingCustomPreProxyOutletId.value)?.type ===
      Outbound.Urltest
        ? 'auto'
        : 'manual') === addRuleBehavior.value,
  )
  if (addRuleTargetType.value === 'nodeGroup' && !reuseCustomPreProxyOutlet) {
    selectedNodeGroup = nodeGroupsStore.getNodeGroupById(addRuleNodeGroupId.value)
    if (!selectedNodeGroup) {
      message.warn('workspace.required')
      return false
    }
    if (
      addRulePreProxyMode.value === 'replace-group' ||
      addRulePreProxyMode.value === 'stack-group'
    ) {
      selectedPreProxyGroup = nodeGroupsStore.getNodeGroupById(addRulePreProxyGroupId.value)
      if (!selectedPreProxyGroup) {
        message.warn('workspace.required')
        return false
      }
    }
  }

  let nextType: App.Rule['type'] = RuleType.RuleSet
  let nextPayload = ''
  if (editingNonRulesetType.value) {
    nextType = editingNonRulesetType.value
    nextPayload = editingNonRulesetPayload.value.trim()
  } else if (presetSpec) {
    nextPayload = ensureProfileRuleset(profile.value.route.rule_set, {
      kind: 'remote',
      url: presetSpec.url,
      tag: presetSpec.tag,
      format: presetSpec.format,
      downloadDetour: directOutbound.value?.id || '',
    }).id
  } else if (localSpec) {
    nextPayload = ensureProfileRuleset(profile.value.route.rule_set, {
      kind: 'local',
      id: localSpec.id,
      tag: localSpec.name,
      format: localSpec.format,
    }).id
  } else {
    nextPayload = addRuleExistingId.value
  }

  let outboundId = ''
  if (addRuleTargetType.value === 'custom' && editingCustomOutboundId.value) {
    outboundId = editingCustomOutboundId.value
  } else if (addRuleTargetType.value === 'proxy') {
    outboundId = primaryOutbound.value?.id || DefaultOutboundIds.Select
  } else if (addRuleTargetType.value === 'direct') {
    outboundId = directOutbound.value?.id || DefaultOutboundIds.Direct
  } else if (addRuleTargetType.value === 'block') {
    outboundId = blockOutbound.value?.id || DefaultOutboundIds.Block
  } else if (reuseCustomPreProxyOutlet) {
    outboundId = editingCustomPreProxyOutletId.value
  } else {
    let preProxy: NodeGroupOutletPreProxyOption = { mode: 'inherit' }
    if (addRulePreProxyMode.value === 'none') {
      preProxy = { mode: 'none' }
    } else if (
      selectedPreProxyGroup &&
      (addRulePreProxyMode.value === 'replace-group' ||
        addRulePreProxyMode.value === 'stack-group')
    ) {
      preProxy = {
        mode: addRulePreProxyMode.value,
        group: selectedPreProxyGroup,
        behavior: addRulePreProxyBehavior.value,
        behaviorLabel: t(
          addRulePreProxyBehavior.value === 'auto'
            ? 'nodeGroups.outletAuto'
            : 'nodeGroups.outletManual',
        ),
      }
    }
    outboundId = ensureNodeGroupOutlet(
      profile.value.outbounds,
      selectedNodeGroup!,
      addRuleBehavior.value,
      t(addRuleBehavior.value === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
      { role: 'outlet', preProxy },
    ).id
  }

  if (editingRuleId.value) {
    const existing = profile.value.route.rules.find((item) => item.id === editingRuleId.value)
    if (existing) {
      existing.type = nextType
      existing.payload = nextPayload
      existing.outbound = outboundId
      return
    }
  }

  const rule: App.Rule = {
    ...DefaultRouteRule(),
    type: nextType,
    payload: nextPayload,
    action: RuleAction.Route,
    outbound: outboundId,
  }
  const insertIdx = profile.value.route.rules.findIndex(
    (item) => item.type === RuleType.InsertionPoint,
  )
  if (insertIdx !== -1) profile.value.route.rules.splice(insertIdx + 1, 0, rule)
  else profile.value.route.rules.unshift(rule)
}

// --- Card 5: DNS Mode ---
const currentDnsPreset = computed(() => detectDnsPreset(profile.value.dns))
const dnsPresetOptions: Array<{
  value: App.DnsPreset
  labelKey: string
  descKey: string
}> = [
  {
    value: 'smart',
    labelKey: 'profileSimple.dnsPresets.smart',
    descKey: 'profileSimple.dnsPresets.smartDesc',
  },
  {
    value: 'fakeip',
    labelKey: 'profileSimple.dnsPresets.fakeip',
    descKey: 'profileSimple.dnsPresets.fakeipDesc',
  },
  {
    value: 'custom',
    labelKey: 'profileSimple.dnsPresets.custom',
    descKey: 'profileSimple.dnsPresets.customDesc',
  },
]
const handleSelectDnsPreset = (preset: App.DnsPreset) => {
  applyDnsPreset(profile.value, preset)
}
</script>

<template>
  <div class="simple-editor flex flex-col gap-12 pb-16">
    <!-- Card 1: Proxy Sources & Inbounds -->
    <Card :title="t('profileSimple.cardEntry')">
      <p class="text-12 text-muted mt-0 mb-12">{{ t('profileSimple.cardEntryDesc') }}</p>
      <div class="simple-grid">
        <div class="form-item">
          {{ t('profileSimple.primarySourcesSub') }}
          <Select
            v-model="selectedSubscriptionIds"
            :options="subscriptionOptions"
            multiple
            clearable
            :placeholder="t('common.none')"
          />
        </div>
        <div class="form-item">
          {{ t('profileSimple.primarySourcesGroup') }}
          <Select
            v-model="selectedNodeGroupIds"
            :options="nodeGroupOptions"
            multiple
            clearable
            :placeholder="t('common.none')"
          />
        </div>
        <div v-if="nodeGroupOptions.length" class="form-item">
          {{ t('profileSimple.primaryGroupMode') }}
          <Radio
            :model-value="primaryNodeGroupMode"
            :options="[
              { label: 'profileSimple.primaryGroupModeSubgroup', value: 'subgroup' },
              { label: 'profileSimple.primaryGroupModeFlatten', value: 'flatten' },
            ]"
            @update:model-value="handleChangePrimaryNodeGroupMode($event as 'subgroup' | 'flatten')"
          />
          <p v-if="primaryNodeGroupMode === 'subgroup'" class="text-12 text-muted mt-4 mb-0">
            {{ t('profileSimple.primaryGroupSubgroupHint') }}
          </p>
          <div v-if="selectedSubgroupItems.length" class="flex flex-wrap gap-6 mt-8">
            <Button
              v-for="item in selectedSubgroupItems"
              :key="item.groupId"
              :data-testid="`toggle-subgroup-behavior-${item.groupId}`"
              size="small"
              type="normal"
              @click="togglePrimarySubgroupBehavior(item.groupId)"
            >
              <span>{{ item.name }}</span>
              <Tag
                size="small"
                :color="item.behavior === 'auto' ? 'blue' : 'green'"
                class="ml-6"
              >
                {{
                  t(
                    item.behavior === 'auto'
                      ? 'nodeGroups.outletAuto'
                      : 'nodeGroups.outletManual',
                  )
                }}
              </Tag>
            </Button>
          </div>
        </div>
        <div v-if="primaryPreProxyGroupOptions.length" class="form-item">
          {{ t('profileSimple.primaryPreProxy') }}
          <div class="flex flex-wrap items-center gap-8">
            <Select
              v-model="primaryPreProxyGroupId"
              :options="[
                { label: t('nodeGroups.noPreProxy'), value: '' },
                ...primaryPreProxyGroupOptions,
              ]"
              clearable
            />
            <Radio
              v-if="primaryPreProxyGroupId"
              v-model="primaryPreProxyBehavior"
              :options="[
                { label: 'nodeGroups.outletManual', value: 'manual' },
                { label: 'nodeGroups.outletAuto', value: 'auto' },
              ]"
            />
          </div>
        </div>
        <div class="simple-inbounds flex flex-wrap items-center gap-16">
          <div v-if="mixedInbound" class="flex items-center gap-8">
            <Switch v-model="mixedInbound.enable" size="small" />
            <span class="text-13">{{ t('profileSimple.inboundMixed') }}</span>
            <Input
              v-if="mixedInbound.mixed"
              v-model="mixedInbound.mixed.listen.listen_port"
              type="number"
              size="small"
              class="port-input"
            />
          </div>
          <div v-if="tunInbound" class="flex items-center gap-8">
            <Switch v-model="tunInbound.enable" size="small" />
            <span class="text-13">{{ t('profileSimple.inboundTun') }}</span>
          </div>
        </div>
      </div>
    </Card>

    <!-- Card 2: Routing Preset & System Switches -->
    <Card :title="t('profileSimple.cardRouting')">
      <p class="text-12 text-muted mt-0 mb-12">{{ t('profileSimple.cardRoutingDesc') }}</p>
      <div class="preset-grid mb-12">
        <button
          v-for="item in ProfilePresetOptions"
          :key="item.value"
          type="button"
          class="preset-card"
          :class="{ 'is-active': currentPreset === item.value }"
          :data-preset="item.value"
          @click="handleSelectPreset(item.value)"
        >
          <div class="font-bold text-13 mb-4">{{ t(item.labelKey) }}</div>
          <div class="text-12 text-muted">{{ t(item.descKey) }}</div>
        </button>
      </div>
      <div class="text-12 text-muted mb-12">{{ t('profileSimple.presetSwitchHint') }}</div>

      <div v-if="fallbackOptions.length" class="form-item mb-12">
        {{ t('profileSimple.fallbackTarget') }}
        <Select v-model="fallbackTarget" :options="fallbackOptions" />
      </div>

      <Divider>{{ t('profileSimple.systemToggles') }}</Divider>
      <div class="toggles-grid">
        <label v-for="toggle in toggleItems" :key="toggle.key" class="toggle-item">
          <Switch
            :model-value="managedToggles[toggle.key]"
            size="small"
            @change="(val) => handleToggleManaged(toggle.key, Boolean(val))"
          />
          <span class="text-13">{{ t(toggle.labelKey) }}</span>
        </label>
      </div>
    </Card>

    <!-- Card 3: Quick Custom Rules (Direct / Proxy / Block) -->
    <Card :title="t('profileSimple.cardQuickRules')">
      <p class="text-12 text-muted mt-0 mb-12">{{ t('profileSimple.cardQuickRulesDesc') }}</p>
      <div class="quick-grid">
        <div class="quick-col">
          <div class="flex items-center justify-between mb-6">
            <span class="font-bold text-13">{{ t('profileSimple.quickDirect') }}</span>
            <Tag color="green" size="small">{{ quickCounts.direct }}</Tag>
          </div>
          <textarea
            v-model="quickDirectText"
            rows="5"
            class="quick-textarea w-full rounded-4 p-8 font-mono text-12"
            :placeholder="t('profileSimple.quickPlaceholder')"
            data-testid="quick-rules-direct"
            @blur="commitQuickRules"
            @input="commitQuickRules"
          />
        </div>
        <div class="quick-col">
          <div class="flex items-center justify-between mb-6">
            <span class="font-bold text-13">{{ t('profileSimple.quickProxy') }}</span>
            <Tag color="blue" size="small">{{ quickCounts.proxy }}</Tag>
          </div>
          <textarea
            v-model="quickProxyText"
            rows="5"
            class="quick-textarea w-full rounded-4 p-8 font-mono text-12"
            :placeholder="t('profileSimple.quickPlaceholder')"
            data-testid="quick-rules-proxy"
            @blur="commitQuickRules"
            @input="commitQuickRules"
          />
        </div>
        <div class="quick-col">
          <div class="flex items-center justify-between mb-6">
            <span class="font-bold text-13">{{ t('profileSimple.quickBlock') }}</span>
            <Tag color="red" size="small">{{ quickCounts.block }}</Tag>
          </div>
          <textarea
            v-model="quickBlockText"
            rows="5"
            class="quick-textarea w-full rounded-4 p-8 font-mono text-12"
            :placeholder="t('profileSimple.quickPlaceholder')"
            data-testid="quick-rules-block"
            @blur="commitQuickRules"
            @input="commitQuickRules"
          />
        </div>
      </div>
    </Card>

    <!-- Card 4: Business Service & Node-Group Routing -->
    <Card :title="t('profileSimple.cardServiceRules')">
      <template #extra>
        <div class="flex items-center gap-6">
          <Button size="small" type="text" @click="handleCleanupUnused">
            {{ t('profileSimple.cleanupUnused') }}
          </Button>
          <Button size="small" type="primary" icon="add" @click="openAddServiceRule">
            {{ t('profileSimple.addServiceRule') }}
          </Button>
        </div>
      </template>
      <p class="text-12 text-muted mt-0 mb-12">{{ t('profileSimple.cardServiceRulesDesc') }}</p>

      <div v-if="customServiceRules.length === 0" class="text-12 text-muted py-8">
        {{ t('profileSimple.noServiceRules') }}
      </div>
      <div v-else class="flex flex-col gap-6">
        <div
          v-for="rule in customServiceRules"
          :key="rule.id"
          class="service-rule-row flex flex-wrap items-center gap-8 p-8 rounded-6"
        >
          <Switch v-model="rule.enable" size="small" />
          <Tag size="small" color="cyan">{{ describeRulePayload(rule) }}</Tag>
          <span class="text-muted">→</span>
          <Tag size="small" color="blue">{{ describeRuleTarget(rule) }}</Tag>
          <div class="ml-auto flex items-center gap-2">
            <Button
              icon="edit"
              type="text"
              size="small"
              :data-testid="`edit-service-rule-${rule.id}`"
              :aria-label="t('common.edit')"
              @click="openEditServiceRule(rule)"
            />
            <Button
              icon="delete"
              icon-color="var(--danger-color)"
              type="text"
              size="small"
              :aria-label="t('common.delete')"
              @click="removeRuleById(rule.id)"
            />
          </div>
        </div>
      </div>

      <div v-if="otherAdvancedRulesCount > 0" class="mt-10 flex items-center gap-8 text-12 text-muted">
        <span>{{ t('profileSimple.advancedRulesSummary', [otherAdvancedRulesCount]) }}</span>
        <Button type="link" size="small" @click="emit('openAdvancedStep', 4)">
          {{ t('profileSimple.modeAdvanced') }}
        </Button>
      </div>
    </Card>

    <!-- Card 5: DNS Mode -->
    <Card :title="t('profileSimple.cardDns')">
      <template #extra>
        <Button type="link" size="small" @click="emit('openAdvancedStep', 5)">
          {{ t('profileSimple.openAdvancedDns') }}
        </Button>
      </template>
      <p class="text-12 text-muted mt-0 mb-12">{{ t('profileSimple.cardDnsDesc') }}</p>
      <div class="dns-grid">
        <button
          v-for="option in dnsPresetOptions"
          :key="option.value"
          type="button"
          class="preset-card"
          :class="{ 'is-active': currentDnsPreset === option.value }"
          :data-dns-preset="option.value"
          @click="handleSelectDnsPreset(option.value)"
        >
          <div class="font-bold text-13 mb-4">{{ t(option.labelKey) }}</div>
          <div class="text-12 text-muted">{{ t(option.descKey) }}</div>
        </button>
      </div>
    </Card>

    <!-- Quick Add / Edit Service Rule Modal -->
    <Modal
      v-model:open="showAddRuleModal"
      size="drawer"
      :on-ok="confirmAddServiceRule"
      :title="
        editingRuleId ? 'profileSimple.editServiceModalTitle' : 'profileSimple.addServiceModalTitle'
      "
    >
      <template v-if="editingNonRulesetType">
        <div class="form-item">
          {{ t('profileSimple.ruleMatch') }} ({{ editingNonRulesetType }})
          <Input v-model="editingNonRulesetPayload" data-testid="edit-service-rule-payload" />
        </div>
      </template>
      <template v-else>
        <div class="form-item">
          {{ t('profileSimple.serviceOrRuleset') }}
          <Radio
            v-model="addRuleSourceType"
            :options="[
              { label: 'profileSimple.commonServicesAutoRegister', value: 'preset' },
              ...(localRulesetOptions.length
                ? [{ label: 'profileSimple.localRulesetsAutoRegister', value: 'local' }]
                : []),
              ...(existingRulesetOptions.length
                ? [{ label: 'kernel.route.tab.rule_set', value: 'existing' }]
                : []),
            ]"
          />
        </div>
        <div v-if="addRuleSourceType === 'preset'" class="form-item">
          {{ t('profileSimple.serviceOrRuleset') }}
          <Select v-model="addRulePresetId" :options="servicePresetOptions" />
        </div>
        <div v-else-if="addRuleSourceType === 'local'" class="form-item">
          {{ t('router.rulesets') }}
          <Select v-model="addRuleLocalId" :options="localRulesetOptions" />
        </div>
        <div v-else class="form-item">
          {{ t('kernel.route.tab.rule_set') }}
          <Select v-model="addRuleExistingId" :options="existingRulesetOptions" />
        </div>
      </template>

      <div class="form-item">
        {{ t('profileSimple.ruleTarget') }}
        <Radio
          v-model="addRuleTargetType"
          :options="[
            ...(editingCustomOutboundId
              ? [
                  {
                    label:
                      profile.outbounds.find((o) => o.id === editingCustomOutboundId)?.tag ||
                      editingCustomOutboundId,
                    value: 'custom',
                  },
                ]
              : []),
            { label: 'profileSimple.targetProxy', value: 'proxy' },
            { label: 'profileSimple.targetDirect', value: 'direct' },
            { label: 'profileSimple.targetBlock', value: 'block' },
            ...(nodeGroupOptions.length
              ? [{ label: 'profileSimple.targetNodeGroup', value: 'nodeGroup' }]
              : []),
          ]"
        />
      </div>

      <template v-if="addRuleTargetType === 'nodeGroup'">
        <div class="form-item">
          {{ t('router.nodeGroups') }}
          <div class="flex flex-wrap items-center gap-8">
            <Select
              v-model="addRuleNodeGroupId"
              :options="nodeGroupOptions"
              @change="
                () => {
                  addRulePreProxyMode = 'inherit'
                  addRulePreProxyGroupId = ''
                }
              "
            />
            <Radio
              v-model="addRuleBehavior"
              :options="[
                { label: 'nodeGroups.outletManual', value: 'manual' },
                { label: 'nodeGroups.outletAuto', value: 'auto' },
              ]"
            />
          </div>
        </div>
        <div v-if="addRuleNodeGroupId && addRulePreProxyOptions.length" class="form-item">
          {{ t('nodeGroups.preProxyOutletMode') }}
          <div class="flex flex-col gap-8 w-full">
            <Select v-model="addRulePreProxyMode" :options="addRulePreProxyModeOptions" />
            <div
              v-if="
                addRulePreProxyMode === 'replace-group' || addRulePreProxyMode === 'stack-group'
              "
              class="flex flex-wrap items-center gap-8"
            >
              <Select
                v-model="addRulePreProxyGroupId"
                :options="addRulePreProxyOptions"
                :placeholder="t('nodeGroups.preProxy')"
              />
              <Radio
                v-model="addRulePreProxyBehavior"
                :options="[
                  { label: 'nodeGroups.outletManual', value: 'manual' },
                  { label: 'nodeGroups.outletAuto', value: 'auto' },
                ]"
              />
            </div>
          </div>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped lang="less">
.simple-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.port-input {
  width: 96px;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.dns-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.preset-card {
  text-align: left;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--surface-bg);
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;

  &:hover {
    border-color: var(--primary-color);
  }

  &.is-active {
    border-color: var(--primary-color);
    background: var(--accent-soft, color-mix(in srgb, var(--primary-color) 10%, transparent));
  }
}

.toggles-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 16px;
}

.toggle-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.quick-textarea {
  resize: vertical;
  border: 1px solid var(--border-color);
  background: var(--input-bg, var(--surface-bg));
  color: inherit;
  box-sizing: border-box;
}

.service-rule-row {
  border: 1px solid var(--border-color);
  background: var(--surface-bg);
}

@container (max-width: 900px) {
  .preset-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .quick-grid,
  .dns-grid,
  .simple-grid,
  .toggles-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
