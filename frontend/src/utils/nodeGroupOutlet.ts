import { DefaultOutbound } from '@/constant/profile'
import { Outbound, RuleAction } from '@/enums/kernel'

export type NodeGroupOutletBehavior = 'manual' | 'auto'

export type NodeGroupOutletPreProxyOption =
  | { mode: 'inherit' }
  | { mode: 'none' }
  | {
      mode: 'replace'
      outboundId: string
      label?: string
    }
  | {
      mode: 'replace-group' | 'stack-group'
      group: Pick<App.NodeGroup, 'id' | 'name'>
      behavior: NodeGroupOutletBehavior
      behaviorLabel: string
    }

export interface EnsureNodeGroupOutletOptions {
  role?: 'outlet' | 'pre_proxy'
  preProxy?: NodeGroupOutletPreProxyOption
}

const uniqueOutboundTag = (outbounds: App.Outbound[], desired: string, currentId = '') => {
  const occupied = new Set(
    outbounds.filter((outbound) => outbound.id !== currentId).map((outbound) => outbound.tag),
  )
  if (!occupied.has(desired)) return desired
  let sequence = 2
  while (occupied.has(`${desired} (${sequence})`)) sequence += 1
  return `${desired} (${sequence})`
}

export const ensureNodeGroupOutlet = (
  outbounds: App.Outbound[],
  group: Pick<App.NodeGroup, 'id' | 'name'>,
  behavior: NodeGroupOutletBehavior,
  behaviorLabel: string,
  options: EnsureNodeGroupOutletOptions = {},
) => {
  const type = behavior === 'auto' ? Outbound.Urltest : Outbound.Selector
  const preProxy = options.preProxy ?? { mode: 'inherit' }
  let preProxyId = ''
  let preProxyOverride = false
  let preProxyLabel = ''

  if (preProxy.mode === 'none') {
    preProxyOverride = true
  } else if (preProxy.mode === 'replace') {
    preProxyId = preProxy.outboundId
    preProxyOverride = true
    preProxyLabel =
      preProxy.label ||
      outbounds.find((candidate) => candidate.id === preProxy.outboundId)?.tag ||
      ''
  } else if (preProxy.mode === 'replace-group' || preProxy.mode === 'stack-group') {
    const upstream = ensureNodeGroupOutlet(
      outbounds,
      preProxy.group,
      preProxy.behavior,
      preProxy.behaviorLabel,
      { role: 'pre_proxy' },
    )
    preProxyId = upstream.id
    preProxyOverride = preProxy.mode === 'replace-group'
    preProxyLabel = preProxy.group.name
  }

  let outbound = outbounds.find(
    (candidate) =>
      candidate.source_node_group === group.id &&
      candidate.type === type &&
      (candidate.pre_proxy || '') === preProxyId &&
      Boolean(candidate.pre_proxy_override) === preProxyOverride &&
      !candidate.include &&
      !candidate.exclude &&
      candidate.outbounds.length === 1 &&
      candidate.outbounds[0]?.type === 'NodeGroup' &&
      candidate.outbounds[0]?.id === group.id,
  )
  const isNew = !outbound
  if (!outbound) {
    outbound = DefaultOutbound()
    outbound.type = type
    outbounds.push(outbound)
  }

  if (isNew) {
    const baseDesired = `${group.name} · ${behaviorLabel}`
    const desired = preProxyLabel
      ? `${baseDesired} (${preProxyLabel})`
      : preProxy.mode === 'none'
        ? `${baseDesired} (Direct)`
        : baseDesired

    outbound.tag = uniqueOutboundTag(outbounds, desired, outbound.id)
    outbound.role = 'custom'
    outbound.hidden = false
  }
  outbound.source_node_group = group.id
  if (options.role && !outbound.source_node_group_role) outbound.source_node_group_role = options.role
  outbound.pre_proxy = preProxyId
  if (preProxyOverride) outbound.pre_proxy_override = true
  else delete outbound.pre_proxy_override
  outbound.outbounds = [{ id: group.id, tag: group.name, type: 'NodeGroup' }]
  return outbound
}

/** Remove generated node-group outlet strategies that are no longer referenced anywhere in the profile. */
export const pruneUnusedNodeGroupOutlets = (
  profile: Pick<App.Profile, 'outbounds' | 'route' | 'dns' | 'experimental' | 'primary_proxy_outbound'>,
): string[] => {
  const removed: string[] = []
  let changed = true
  while (changed) {
    changed = false
    const referenced = new Set<string>()
    if (profile.primary_proxy_outbound) referenced.add(profile.primary_proxy_outbound)
    if (profile.route.final) referenced.add(profile.route.final)
    if (profile.experimental?.clash_api?.external_ui_download_detour) {
      referenced.add(profile.experimental.clash_api.external_ui_download_detour)
    }
    profile.route.rules.forEach((rule) => {
      if (rule.action === RuleAction.Route && rule.outbound) referenced.add(rule.outbound)
    })
    profile.route.rule_set.forEach((rs) => {
      if (rs.download_detour) referenced.add(rs.download_detour)
    })
    profile.dns?.servers.forEach((server) => {
      if (server.detour) referenced.add(server.detour)
    })
    profile.outbounds.forEach((outbound) => {
      if (outbound.pre_proxy) referenced.add(outbound.pre_proxy)
      outbound.outbounds.forEach((member) => {
        if (member.type === 'Built-in') referenced.add(member.id)
      })
    })

    for (let i = profile.outbounds.length - 1; i >= 0; i--) {
      const candidate = profile.outbounds[i]!
      if (candidate.source_node_group && !referenced.has(candidate.id)) {
        profile.outbounds.splice(i, 1)
        removed.push(candidate.tag)
        changed = true
      }
    }
  }
  return removed
}
