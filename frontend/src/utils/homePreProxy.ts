import { DefaultOutbound } from '@/constant/profile'
import { Outbound, RuleAction } from '@/enums/kernel'
import { ensureNodeGroupOutlet, pruneUnusedNodeGroupOutlets, type NodeGroupOutletBehavior } from '@/utils/nodeGroupOutlet'
import { findOutboundGraphIssues, getPrimaryProxyOutbound } from '@/utils/outboundPolicy'
import { resolveProxyChain } from '@/views/HomeView/nodeController'

import type { CoreApiProxy } from '@/types/kernel'

export const HOME_PRE_PROXY_OUTBOUND_ID = 'outbound-home-pre-proxy'

export interface ActivePreProxyState {
  groupName: string
  group?: CoreApiProxy
  status: 'none' | 'direct' | 'active'
  nodeName: string
  canHotSwitch: boolean
  configuredOnPrimary: boolean
  configuredOutboundId: string
  isManagedHomePreProxy: boolean
  hasDirectOption: boolean
}

const VIA_SUFFIX_RE = / \[via ([^\]]+)\](?: [1-9]\d*)?$/

export const stripViaSuffix = (tag: string): string => tag.replace(VIA_SUFFIX_RE, '')

export const extractViaGroupName = (
  tag: string | undefined,
  proxies: Record<string, CoreApiProxy>,
): string | undefined => {
  if (!tag) return undefined
  const match = tag.match(VIA_SUFFIX_RE)
  const candidate = match?.[1]
  return candidate && proxies[candidate] ? candidate : undefined
}

export const resolveActivePreProxyState = (
  profile: Pick<App.Profile, 'outbounds' | 'primary_proxy_outbound'> | undefined,
  proxies: Record<string, CoreApiProxy>,
  activeLeafName?: string,
): ActivePreProxyState => {
  const primary = getPrimaryProxyOutbound(profile)
  const configuredOutboundId = primary?.pre_proxy || ''
  const configuredOutbound = configuredOutboundId
    ? profile?.outbounds.find((item) => item.id === configuredOutboundId)
    : undefined

  let group: CoreApiProxy | undefined
  if (configuredOutbound && proxies[configuredOutbound.tag]) {
    group = proxies[configuredOutbound.tag]
  } else {
    const viaTag = extractViaGroupName(activeLeafName, proxies)
    if (viaTag) group = proxies[viaTag]
  }

  const configuredOnPrimary = Boolean(configuredOutboundId && configuredOutbound)
  const isManagedHomePreProxy = configuredOutboundId === HOME_PRE_PROXY_OUTBOUND_ID

  if (!group) {
    return {
      groupName: configuredOutbound?.tag || '',
      group: undefined,
      status: 'none',
      nodeName: '',
      canHotSwitch: false,
      configuredOnPrimary,
      configuredOutboundId,
      isManagedHomePreProxy,
      hasDirectOption: false,
    }
  }

  const canHotSwitch = group.type === 'Selector'
  const hasDirectOption = canHotSwitch && Boolean(group.all?.includes('direct'))

  if (group.now === 'direct') {
    return {
      groupName: group.name,
      group,
      status: 'direct',
      nodeName: '',
      canHotSwitch,
      configuredOnPrimary,
      configuredOutboundId,
      isManagedHomePreProxy,
      hasDirectOption,
    }
  }

  const resolved = resolveProxyChain(group.now || '', proxies)
  if (resolved.leaf?.type === 'Direct') {
    return {
      groupName: group.name,
      group,
      status: 'direct',
      nodeName: '',
      canHotSwitch,
      configuredOnPrimary,
      configuredOutboundId,
      isManagedHomePreProxy,
      hasDirectOption,
    }
  }

  return {
    groupName: group.name,
    group,
    status: resolved.leafName ? 'active' : 'none',
    nodeName: resolved.leafName || group.now || '',
    canHotSwitch,
    configuredOnPrimary,
    configuredOutboundId,
    isManagedHomePreProxy,
    hasDirectOption,
  }
}

const uniqueOutboundTag = (outbounds: App.Outbound[], desired: string, currentId = '') => {
  const occupied = new Set(
    outbounds.filter((item) => item.id !== currentId).map((item) => item.tag),
  )
  if (!occupied.has(desired)) return desired
  let seq = 2
  while (occupied.has(`${desired} (${seq})`)) seq += 1
  return `${desired} (${seq})`
}

const isOutboundReferenced = (
  profile: Pick<App.Profile, 'outbounds' | 'route' | 'dns' | 'experimental' | 'primary_proxy_outbound'>,
  outboundId: string,
) => {
  if (profile.primary_proxy_outbound === outboundId) return true
  if (profile.route.final === outboundId) return true
  if (profile.experimental?.clash_api?.external_ui_download_detour === outboundId) return true
  if (profile.route.rules.some((r) => r.action === RuleAction.Route && r.outbound === outboundId)) {
    return true
  }
  if (profile.route.rule_set.some((rs) => rs.download_detour === outboundId)) return true
  if (profile.dns?.servers.some((s) => s.detour === outboundId)) return true
  return profile.outbounds.some(
    (o) =>
      o.pre_proxy === outboundId ||
      o.outbounds.some((m) => m.type === 'Built-in' && m.id === outboundId),
  )
}

const pruneUnusedManagedHomePreProxy = (profile: App.Profile) => {
  const idx = profile.outbounds.findIndex((o) => o.id === HOME_PRE_PROXY_OUTBOUND_ID)
  if (idx !== -1 && !isOutboundReferenced(profile, HOME_PRE_PROXY_OUTBOUND_ID)) {
    profile.outbounds.splice(idx, 1)
  }
  pruneUnusedNodeGroupOutlets(profile)
}

const assertPrimarySupportsPreProxy = (primary: App.Outbound) => {
  const hasDirectOrBlock = primary.outbounds.some(
    (member) =>
      member.type === 'Built-in' &&
      [Outbound.Direct, Outbound.Block].includes(member.id as Outbound),
  )
  if (hasDirectOrBlock) {
    throw new Error('home.nodes.preProxyDirectMemberConflict')
  }
}

export const applyHomePreProxyNode = (
  profile: App.Profile,
  options: {
    subscriptions: Pick<App.Subscription, 'id' | 'name' | 'disabled'>[]
    preProxyLabel: string
    targetSubscriptionId?: string
    nodeGroups?: Pick<App.NodeGroup, 'id' | 'pre_proxy_group_id'>[]
  },
): { preProxyTag: string } => {
  const primary = getPrimaryProxyOutbound(profile)
  if (!primary) throw new Error('home.nodes.noSelectableNode')
  assertPrimarySupportsPreProxy(primary)

  const enabledSubs = options.subscriptions.filter(
    (sub) => !sub.disabled || sub.id === options.targetSubscriptionId,
  )
  const members: App.Proxy[] = [
    { id: Outbound.Direct, tag: Outbound.Direct, type: 'Built-in' },
    ...enabledSubs.map((sub) => ({ id: sub.id, tag: sub.name, type: 'Subscription' })),
  ]
  if (enabledSubs.length === 0 && profile.native?.outbounds?.length) {
    profile.native.outbounds
      .filter((entry) => !['direct', 'block', 'dns'].includes(entry.type))
      .forEach((entry) => {
        members.push({ id: entry.tag, tag: entry.tag, type: 'Native' })
      })
  }

  let managed = profile.outbounds.find((o) => o.id === HOME_PRE_PROXY_OUTBOUND_ID)
  if (!managed) {
    managed = {
      ...DefaultOutbound(),
      id: HOME_PRE_PROXY_OUTBOUND_ID,
      tag: uniqueOutboundTag(profile.outbounds, options.preProxyLabel),
      type: Outbound.Selector,
      role: 'custom',
      source_node_group_role: 'pre_proxy',
      hidden: false,
      outbounds: members,
    }
    profile.outbounds.push(managed)
  } else {
    managed.type = Outbound.Selector
    managed.source_node_group_role = 'pre_proxy'
    managed.hidden = false
    managed.outbounds = members
  }

  primary.pre_proxy = managed.id
  pruneUnusedNodeGroupOutlets(profile)

  const issues = findOutboundGraphIssues(profile.outbounds, options.nodeGroups || [])
  if (issues.some((issue) => issue.type === 'cycle')) {
    throw new Error('kernel.outbounds.cycle')
  }

  return { preProxyTag: managed.tag }
}

export const applyHomePreProxyNodeGroup = (
  profile: App.Profile,
  group: Pick<App.NodeGroup, 'id' | 'name'>,
  behavior: NodeGroupOutletBehavior,
  behaviorLabel: string,
  nodeGroups: Pick<App.NodeGroup, 'id' | 'pre_proxy_group_id'>[] = [],
): { preProxyTag: string } => {
  const primary = getPrimaryProxyOutbound(profile)
  if (!primary) throw new Error('home.nodes.noSelectableNode')
  assertPrimarySupportsPreProxy(primary)

  const upstream = ensureNodeGroupOutlet(profile.outbounds, group, behavior, behaviorLabel, {
    role: 'pre_proxy',
  })
  if (upstream.id === primary.id) {
    throw new Error('kernel.outbounds.cycle')
  }
  primary.pre_proxy = upstream.id
  pruneUnusedManagedHomePreProxy(profile)

  const issues = findOutboundGraphIssues(profile.outbounds, nodeGroups)
  if (issues.some((issue) => issue.type === 'cycle')) {
    throw new Error('kernel.outbounds.cycle')
  }

  return { preProxyTag: upstream.tag }
}

export const clearHomePreProxy = (profile: App.Profile) => {
  const primary = getPrimaryProxyOutbound(profile)
  if (!primary) return
  primary.pre_proxy = ''
  pruneUnusedManagedHomePreProxy(profile)
}

export const findRuntimeNodeTag = (
  groupAll: string[] | undefined,
  desiredTag: string,
  subscriptionName?: string,
): string | undefined => {
  if (!groupAll?.length || !desiredTag) return undefined
  if (groupAll.includes(desiredTag)) return desiredTag
  if (subscriptionName) {
    const qualified = `${desiredTag} [${subscriptionName}]`
    if (groupAll.includes(qualified)) return qualified
  }
  return groupAll.find((candidate) => stripViaSuffix(candidate) === desiredTag)
}

export const findRestoredExitNodeTag = (
  groupAll: string[] | undefined,
  previousExitTag: string,
  newPreProxyTag: string,
): string | undefined => {
  if (!groupAll?.length || !previousExitTag) return undefined
  const base = stripViaSuffix(previousExitTag)
  if (newPreProxyTag) {
    const exactChained = `${base} [via ${newPreProxyTag}]`
    if (groupAll.includes(exactChained)) return exactChained
  } else if (groupAll.includes(base)) {
    return base
  }
  return groupAll.find((candidate) => stripViaSuffix(candidate) === base)
}
