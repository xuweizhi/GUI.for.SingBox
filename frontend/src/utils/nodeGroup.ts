export interface ResolvedNodeGroupNode {
  subscription: App.Subscription
  proxy: App.Subscription['proxies'][number]
  key: string
  match?: {
    field: App.NodeGroupMatchField
    value: string
  }
}

export type NodeGroupIssue =
  | {
      type: 'missing-subscription'
      subscription_id: string
      node_id?: string
      label: string
    }
  | {
      type: 'missing-node'
      subscription_id: string
      node_id: string
      label: string
    }
  | {
      type: 'invalid-filter'
      field: 'include' | 'exclude'
      expression: string
    }

export interface NodeGroupResolution {
  nodes: ResolvedNodeGroupNode[]
  issues: NodeGroupIssue[]
}

export interface NodeGroupDependency {
  profileId: string
  profileName: string
  outboundId: string
  outboundName: string
  viaGroupName?: string
}

export interface NodeGroupGraphIssue {
  type: 'missing-pre-proxy' | 'pre-proxy-cycle'
  groupId: string
  targetId?: string
  chain: string[]
}

export interface NodeGroupPreProxyHop {
  id: string
  name: string
  behavior?: App.NodeGroupOutletBehavior
}

export interface NodeGroupPreProxyChain {
  /** Transport order from entry upstream to target node group. */
  hops: NodeGroupPreProxyHop[]
  error?: 'missing' | 'cycle'
  missingId?: string
}

export const collectNodeGroupReachableIds = (
  rootIds: Iterable<string>,
  nodeGroups: Pick<App.NodeGroup, 'id' | 'pre_proxy_group_id'>[],
): Set<string> => {
  const byId = new Map(nodeGroups.map((group) => [group.id, group]))
  const visited = new Set<string>()
  const queue = [...rootIds]
  while (queue.length) {
    const current = queue.shift()!
    if (!current || visited.has(current)) continue
    visited.add(current)
    const next = byId.get(current)?.pre_proxy_group_id
    if (next && !visited.has(next)) queue.push(next)
  }
  return visited
}

export const findNodeGroupGraphIssues = (
  nodeGroups: Pick<App.NodeGroup, 'id' | 'pre_proxy_group_id'>[],
): NodeGroupGraphIssue[] => {
  const issues: NodeGroupGraphIssue[] = []
  const byId = new Map(nodeGroups.map((group) => [group.id, group]))

  nodeGroups.forEach((group) => {
    if (group.pre_proxy_group_id && !byId.has(group.pre_proxy_group_id)) {
      issues.push({
        type: 'missing-pre-proxy',
        groupId: group.id,
        targetId: group.pre_proxy_group_id,
        chain: [group.id, group.pre_proxy_group_id],
      })
    }
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
        issues.push({ type: 'pre-proxy-cycle', groupId: id, chain })
      }
      return
    }
    if (visited.has(id)) return

    visited.add(id)
    active.add(id)
    stack.push(id)
    const next = byId.get(id)?.pre_proxy_group_id
    if (next && byId.has(next)) visit(next)
    stack.pop()
    active.delete(id)
  }

  nodeGroups.forEach((group) => visit(group.id))
  return issues
}

export const wouldCreateNodeGroupCycle = (
  groupId: string,
  candidatePreProxyId: string,
  nodeGroups: Pick<App.NodeGroup, 'id' | 'pre_proxy_group_id'>[],
): boolean => {
  if (!candidatePreProxyId) return false
  if (candidatePreProxyId === groupId) return true
  const byId = new Map(nodeGroups.map((group) => [group.id, group]))
  const visited = new Set<string>([groupId])
  let current: string | undefined = candidatePreProxyId
  while (current) {
    if (visited.has(current)) return true
    visited.add(current)
    current = byId.get(current)?.pre_proxy_group_id
  }
  return false
}

export const resolveNodeGroupPreProxyChain = (
  groupId: string,
  nodeGroups: Pick<App.NodeGroup, 'id' | 'name' | 'pre_proxy_group_id' | 'pre_proxy_behavior'>[],
): NodeGroupPreProxyChain => {
  const byId = new Map(nodeGroups.map((group) => [group.id, group]))
  const hops: NodeGroupPreProxyHop[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = groupId
  let behaviorForCurrent: App.NodeGroupOutletBehavior | undefined

  while (currentId) {
    if (visited.has(currentId)) {
      return { hops, error: 'cycle' }
    }
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) {
      return { hops, error: 'missing', missingId: currentId }
    }
    hops.unshift({
      id: current.id,
      name: current.name || current.id,
      ...(behaviorForCurrent ? { behavior: behaviorForCurrent } : {}),
    })
    behaviorForCurrent = current.pre_proxy_behavior === 'auto' ? 'auto' : 'manual'
    currentId = current.pre_proxy_group_id || undefined
  }
  return { hops }
}

export const getNodeGroupPreProxyDependents = (
  groupId: string,
  nodeGroups: App.NodeGroup[],
): App.NodeGroup[] => nodeGroups.filter((group) => group.pre_proxy_group_id === groupId)

export const nodeGroupNodeKey = (subscriptionId: string, nodeId: string) =>
  `${subscriptionId}\u0000${nodeId}`

export const getNodeGroupRuntimeNames = (
  resolution: NodeGroupResolution,
  runtimeNames: string[],
  subscriptions: App.Subscription[] = [],
) => {
  const names = new Set<string>()
  const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const isChainSuffix = (suffix: string) => /^ \[via [\s\S]+\](?: [1-9]\d*)?$/.test(suffix)
  const knownTags = new Set([
    ...subscriptions.flatMap((subscription) => subscription.proxies.map((proxy) => proxy.tag)),
    ...resolution.nodes.flatMap(({ subscription, proxy }) => [
      proxy.tag,
      ...(subscription.proxies || []).map((candidate) => candidate.tag),
    ]),
  ])
  const literalBases = new Map<string, string | undefined>(
    runtimeNames.map((name) => {
      if (knownTags.has(name)) return [name, name]
      // Search suffix boundaries from right to left so a longer literal tag wins
      // over a shorter node whose generated name happens to share its prefix.
      let boundary = name.lastIndexOf(' [via ')
      while (boundary >= 0) {
        const base = name.slice(0, boundary)
        if (knownTags.has(base) && isChainSuffix(name.slice(boundary))) return [name, base]
        boundary = boundary > 0 ? name.lastIndexOf(' [via ', boundary - 1) : -1
      }
      return [name, undefined]
    }),
  )
  resolution.nodes.forEach(({ subscription, proxy }) => {
    // Recognize both legacy "[Provider 2]" and "[Provider] 2" aliases, without
    // conflating "Provider" with "Provider Extra". Match literal tags first:
    // a user may legitimately name a node "Node [via Office]".
    const qualified = new RegExp(
      `^${escapePattern(proxy.tag)} \\[${escapePattern(subscription.name)}(?: [1-9]\\d*)?\\](?: [1-9]\\d*)?`,
    )
    const qualifiedNames: string[] = []
    const unqualifiedNames: string[] = []
    runtimeNames.forEach((name) => {
      const literalBase = literalBases.get(name)
      if (literalBase && literalBase !== proxy.tag) return
      if (name === proxy.tag) {
        unqualifiedNames.push(name)
        return
      }
      const alias = name.match(qualified)?.[0]
      if (alias && (name === alias || isChainSuffix(name.slice(alias.length)))) {
        qualifiedNames.push(name)
      } else if (name.startsWith(proxy.tag) && isChainSuffix(name.slice(proxy.tag.length))) {
        unqualifiedNames.push(name)
      }
    })
    // Legacy runtime names cannot identify the source of an unqualified duplicate.
    // Keep the established preference for subscription-qualified names.
    for (const name of qualifiedNames.length ? qualifiedNames : unqualifiedNames) names.add(name)
  })
  return names
}

const compileFilter = (
  expression: string,
  field: 'include' | 'exclude',
  issues: NodeGroupIssue[],
) => {
  if (!expression) return null
  try {
    return new RegExp(expression, 'i')
  } catch {
    issues.push({ type: 'invalid-filter', field, expression })
    return undefined
  }
}

const getMatchValue = (
  field: App.NodeGroupMatchField,
  subscription: App.Subscription,
  proxy: App.Subscription['proxies'][number],
) => {
  switch (field) {
    case 'name':
      return proxy.tag
    case 'protocol':
      return proxy.type
    case 'subscription':
      return subscription.name
    default:
      // Keep the original concatenation, including separators, for existing filters.
      return `${subscription.name} ${proxy.tag} ${proxy.type}`
  }
}

export const resolveNodeGroup = (
  group: App.NodeGroup,
  subscriptions: App.Subscription[],
): NodeGroupResolution => {
  const issues: NodeGroupIssue[] = []
  const nodes: ResolvedNodeGroupNode[] = []
  const seen = new Set<string>()
  const subscriptionsById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription]),
  )

  const addNode = (
    subscription: App.Subscription,
    proxy: App.Subscription['proxies'][number],
    match?: ResolvedNodeGroupNode['match'],
  ) => {
    const key = nodeGroupNodeKey(subscription.id, proxy.id)
    if (seen.has(key)) return
    seen.add(key)
    nodes.push({ subscription, proxy, key, ...(match ? { match } : {}) })
  }

  if (group.mode === 'manual') {
    group.members.forEach((member) => {
      const subscription = subscriptionsById.get(member.subscription_id)
      if (!subscription) {
        issues.push({
          type: 'missing-subscription',
          subscription_id: member.subscription_id,
          node_id: member.node_id,
          label: member.last_known_tag || member.node_id,
        })
        return
      }
      const proxy = subscription.proxies.find((candidate) => candidate.id === member.node_id)
      if (!proxy) {
        issues.push({
          type: 'missing-node',
          subscription_id: member.subscription_id,
          node_id: member.node_id,
          label: member.last_known_tag || member.node_id,
        })
        return
      }
      addNode(subscription, proxy)
    })
    return { nodes, issues }
  }

  const include = compileFilter(group.include, 'include', issues)
  const exclude = compileFilter(group.exclude, 'exclude', issues)
  if (typeof include === 'undefined' || typeof exclude === 'undefined') {
    return { nodes: [], issues }
  }

  const sourceIds =
    group.source_scope === 'selected'
      ? new Set(group.subscription_ids)
      : new Set(subscriptions.map((subscription) => subscription.id))

  if (group.source_scope === 'selected') {
    group.subscription_ids.forEach((id) => {
      if (!subscriptionsById.has(id)) {
        issues.push({
          type: 'missing-subscription',
          subscription_id: id,
          label: id,
        })
      }
    })
  }

  const matchField = group.match_field ?? 'all'
  for (const subscription of subscriptions) {
    if (subscription.disabled || !sourceIds.has(subscription.id)) continue
    for (const proxy of subscription.proxies) {
      const text = getMatchValue(matchField, subscription, proxy)
      if (include && !include.test(text)) continue
      if (exclude?.test(text)) continue
      addNode(subscription, proxy, { field: matchField, value: text })
      if (group.max_nodes > 0 && nodes.length >= group.max_nodes) return { nodes, issues }
    }
  }

  return { nodes, issues }
}

export const getNodeGroupDependencies = (
  groupId: string,
  profiles: App.Profile[],
  nodeGroups: Pick<App.NodeGroup, 'id' | 'name' | 'pre_proxy_group_id'>[] = [],
): NodeGroupDependency[] => {
  const byId = new Map(nodeGroups.map((group) => [group.id, group]))
  return profiles.flatMap((profile) =>
    profile.outbounds.flatMap((outbound) => {
      if (outbound.outbounds.some((member) => member.type === 'NodeGroup' && member.id === groupId)) {
        return [
          {
            profileId: profile.id,
            profileName: profile.name,
            outboundId: outbound.id,
            outboundName: outbound.tag,
          },
        ]
      }
      if (!nodeGroups.length || outbound.pre_proxy_override) return []
      for (const member of outbound.outbounds) {
        if (member.type !== 'NodeGroup') continue
        const reachable = collectNodeGroupReachableIds([member.id], nodeGroups)
        if (reachable.has(groupId)) {
          return [
            {
              profileId: profile.id,
              profileName: profile.name,
              outboundId: outbound.id,
              outboundName: outbound.tag,
              viaGroupName: byId.get(member.id)?.name || member.tag || member.id,
            },
          ]
        }
      }
      return []
    }),
  )
}

export const removeNodeGroupReferences = (groupId: string, profiles: App.Profile[]) => {
  let removed = 0
  profiles.forEach((profile) => {
    const emptiedGeneratedIds = new Set<string>()
    profile.outbounds.forEach((outbound) => {
      const next = outbound.outbounds.filter((member) => {
        const match = member.type === 'NodeGroup' && member.id === groupId
        if (match) removed += 1
        return !match
      })
      if (next.length !== outbound.outbounds.length) outbound.outbounds = next
      if (outbound.source_node_group === groupId) {
        delete outbound.source_node_group
        delete outbound.source_node_group_role
        if (outbound.outbounds.length === 0) emptiedGeneratedIds.add(outbound.id)
      }
    })
    if (emptiedGeneratedIds.size) {
      profile.outbounds = profile.outbounds.filter(
        (outbound) => !emptiedGeneratedIds.has(outbound.id),
      )
      profile.outbounds.forEach((outbound) => {
        if (outbound.pre_proxy && emptiedGeneratedIds.has(outbound.pre_proxy)) {
          outbound.pre_proxy = ''
        }
        outbound.outbounds = outbound.outbounds.filter(
          (member) => !(member.type === 'Built-in' && emptiedGeneratedIds.has(member.id)),
        )
      })
      if (profile.route?.rules) {
        profile.route.rules = profile.route.rules.filter(
          (rule) => !(rule.action === 'route' && emptiedGeneratedIds.has(rule.outbound)),
        )
      }
      if (profile.route && emptiedGeneratedIds.has(profile.route.final)) {
        profile.route.final = ''
      }
    }
  })
  return removed
}

/** Resolve structural dependencies, not just currently matched nodes: a rename,
 * enable/disable or a newly added subscription can change a dynamic group's matches. */
export const profileUsesSubscription = (
  profile: Pick<App.Profile, 'outbounds'>,
  subscriptionId: string,
  nodeGroups: App.NodeGroup[],
) => {
  const byId = new Map(nodeGroups.map((group) => [group.id, group]))
  const groupUsesSubscription = (group: App.NodeGroup) => {
    if (group.mode === 'manual')
      return group.members.some((node) => node.subscription_id === subscriptionId)
    return group.source_scope === 'all' || group.subscription_ids.includes(subscriptionId)
  }
  return profile.outbounds.some((outbound) =>
    outbound.outbounds.some((member) => {
      if (member.type === 'Subscription') return member.id === subscriptionId
      if (member.type === subscriptionId) return true
      if (member.type !== 'NodeGroup') return false
      const ids = outbound.pre_proxy_override
        ? new Set([member.id])
        : collectNodeGroupReachableIds([member.id], nodeGroups)
      for (const id of ids) {
        const group = byId.get(id)
        if (group && groupUsesSubscription(group)) return true
      }
      return false
    }),
  )
}
