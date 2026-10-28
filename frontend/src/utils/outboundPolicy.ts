import { DefaultOutboundIds, DefaultOutboundRoleById } from '@/constant/outbound'
import { Outbound, RuleAction } from '@/enums/kernel'

export interface OutboundGraphIssue {
  type: 'missing' | 'missing-node-group' | 'cycle' | 'reserved-tag'
  groupId: string
  targetId?: string
  chain: string[]
}

export interface ConfiguredOutboundChain {
  ids: string[]
  labels: string[]
  error?: 'missing' | 'cycle'
}

export const getOutboundRole = (outbound?: Pick<App.Outbound, 'id' | 'role'>) =>
  outbound?.role || DefaultOutboundRoleById[outbound?.id || ''] || 'custom'

export const getOutboundRoleLabel = (role: App.OutboundRole) => `kernel.outbounds.role.${role}`

export const isOutboundGroup = (outbound?: Pick<App.Outbound, 'type'>) =>
  !!outbound && [Outbound.Selector, Outbound.Urltest].includes(outbound.type as Outbound)

export const getPrimaryProxyOutbound = (
  profile: Pick<App.Profile, 'outbounds' | 'primary_proxy_outbound'> | undefined,
) => {
  if (!profile) return

  const selectable = profile.outbounds.filter(isOutboundGroup)
  const selected = selectable.find(
    (outbound) =>
      outbound.id === profile.primary_proxy_outbound &&
      !['direct', 'block', 'fallback', 'global'].includes(getOutboundRole(outbound)),
  )
  if (selected) return selected

  return (
    selectable.find((outbound) => outbound.id === DefaultOutboundIds.Select) ||
    selectable.find((outbound) => getOutboundRole(outbound) === 'proxy') ||
    selectable.find(
      (outbound) => !['direct', 'block', 'fallback', 'global'].includes(getOutboundRole(outbound)),
    )
  )
}

const outboundReferences = (outbound: App.Outbound, allIds: Set<string>) => [
  ...outbound.outbounds
    .filter((member) => member.type === 'Built-in' && allIds.has(member.id))
    .map((member) => member.id),
  ...(outbound.pre_proxy ? [outbound.pre_proxy] : []),
]

export const findOutboundGraphIssues = (
  outbounds: App.Outbound[],
  nodeGroups: Pick<App.NodeGroup, 'id'>[] = [],
): OutboundGraphIssue[] => {
  const issues: OutboundGraphIssue[] = []
  const ids = new Set(outbounds.map((outbound) => outbound.id))
  const byId = new Map(outbounds.map((outbound) => [outbound.id, outbound]))
  const nodeGroupIds = new Set(nodeGroups.map((group) => group.id))

  outbounds.forEach((outbound) => {
    if ([Outbound.Direct, Outbound.Block].includes(outbound.tag as Outbound)) {
      issues.push({ type: 'reserved-tag', groupId: outbound.id, chain: [outbound.id] })
    }
    if (outbound.pre_proxy && !byId.has(outbound.pre_proxy)) {
      issues.push({
        type: 'missing',
        groupId: outbound.id,
        targetId: outbound.pre_proxy,
        chain: [outbound.id, outbound.pre_proxy],
      })
    }
    outbound.outbounds.forEach((member) => {
      if (
        member.type === 'Built-in' &&
        ![Outbound.Direct, Outbound.Block].includes(member.id as Outbound) &&
        !ids.has(member.id)
      ) {
        issues.push({
          type: 'missing',
          groupId: outbound.id,
          targetId: member.id,
          chain: [outbound.id, member.id],
        })
      } else if (member.type === 'NodeGroup' && !nodeGroupIds.has(member.id)) {
        issues.push({
          type: 'missing-node-group',
          groupId: outbound.id,
          targetId: member.id,
          chain: [outbound.id, member.id],
        })
      }
    })
  })

  const visited = new Set<string>()
  const active = new Set<string>()
  const stack: string[] = []
  const seenCycles = new Set<string>()

  const visit = (id: string) => {
    if (active.has(id)) {
      const start = stack.indexOf(id)
      const chain = [...stack.slice(start), id]
      const key = [...new Set(chain)].sort().join('|')
      if (!seenCycles.has(key)) {
        seenCycles.add(key)
        issues.push({ type: 'cycle', groupId: id, chain })
      }
      return
    }
    if (visited.has(id)) return

    visited.add(id)
    active.add(id)
    stack.push(id)
    const outbound = byId.get(id)
    if (outbound) {
      outboundReferences(outbound, ids).forEach(visit)
    }
    stack.pop()
    active.delete(id)
  }

  outbounds.forEach((outbound) => visit(outbound.id))
  return issues
}

export const resolveConfiguredOutboundChain = (
  startId: string,
  outbounds: App.Outbound[],
): ConfiguredOutboundChain => {
  const byId = new Map(outbounds.map((outbound) => [outbound.id, outbound]))
  const ids: string[] = []
  const labels: string[] = []
  const visited = new Set<string>()
  let currentId = startId

  while (currentId) {
    if (visited.has(currentId)) {
      ids.push(currentId)
      labels.push(byId.get(currentId)?.tag || currentId)
      return { ids, labels, error: 'cycle' }
    }
    visited.add(currentId)

    const current = byId.get(currentId)
    ids.push(currentId)
    labels.push(current?.tag || currentId)
    if (!current) return { ids, labels, error: 'missing' }

    const first = current.outbounds[0]
    if (!first) return { ids, labels }
    if (!byId.has(first.id)) {
      ids.push(first.id)
      labels.push(first.tag || first.id)
      return { ids, labels }
    }
    currentId = first.id
  }

  return { ids, labels }
}

export const getOutboundReferenceCount = (
  profile: Pick<App.Profile, 'route'> & { dns?: App.Dns },
  outboundId: string,
) => {
  const routeRules = profile.route.rules.filter(
    (rule) => rule.enable && rule.action === RuleAction.Route && rule.outbound === outboundId,
  ).length
  const routeFinal = profile.route.final === outboundId ? 1 : 0
  const ruleSetDownloads = profile.route.rule_set.filter(
    (ruleset) => ruleset.download_detour === outboundId,
  ).length
  const dnsServers =
    profile.dns?.servers.filter((server) => server.detour === outboundId).length || 0
  return { routeRules, routeFinal, ruleSetDownloads, dnsServers }
}

export const setInitialOutboundTarget = (
  outbound: App.Outbound,
  targetId: string,
  targetTag = targetId,
) => {
  const index = outbound.outbounds.findIndex((member) => member.id === targetId)
  if (index === 0) return
  if (index > 0) {
    const [target] = outbound.outbounds.splice(index, 1)
    outbound.outbounds.unshift(target!)
    return
  }

  outbound.outbounds.unshift({
    id: targetId,
    tag: targetTag,
    type: 'Built-in',
  })
}

export const getOutboundChainLabels = (chain: string[], outbounds: App.Outbound[]) => {
  const byId = new Map(outbounds.map((outbound) => [outbound.id, outbound.tag]))
  return chain.map((id) => byId.get(id) || id)
}
