export interface ResolvedNodeGroupNode {
  subscription: App.Subscription
  proxy: App.Subscription['proxies'][number]
  key: string
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
}

export const nodeGroupNodeKey = (subscriptionId: string, nodeId: string) =>
  `${subscriptionId}\u0000${nodeId}`

export const getNodeGroupRuntimeNames = (
  resolution: NodeGroupResolution,
  runtimeNames: string[],
) => {
  const available = new Set(runtimeNames)
  const names = new Set<string>()
  resolution.nodes.forEach(({ subscription, proxy }) => {
    const disambiguatedPrefix = `${proxy.tag} [${subscription.name}`
    const disambiguated = runtimeNames.find(
      (name) => name.startsWith(disambiguatedPrefix) && name.endsWith(']'),
    )
    if (disambiguated) names.add(disambiguated)
    else if (available.has(proxy.tag)) names.add(proxy.tag)
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

export const resolveNodeGroup = (
  group: App.NodeGroup,
  subscriptions: App.Subscription[],
): NodeGroupResolution => {
  const issues: NodeGroupIssue[] = []
  const nodes: ResolvedNodeGroupNode[] = []
  const seen = new Set<string>()
  const subscriptionsById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]))

  const addNode = (
    subscription: App.Subscription,
    proxy: App.Subscription['proxies'][number],
  ) => {
    const key = nodeGroupNodeKey(subscription.id, proxy.id)
    if (seen.has(key)) return
    seen.add(key)
    nodes.push({ subscription, proxy, key })
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

  for (const subscription of subscriptions) {
    if (subscription.disabled || !sourceIds.has(subscription.id)) continue
    for (const proxy of subscription.proxies) {
      const text = `${subscription.name} ${proxy.tag} ${proxy.type}`
      if (include && !include.test(text)) continue
      if (exclude?.test(text)) continue
      addNode(subscription, proxy)
      if (group.max_nodes > 0 && nodes.length >= group.max_nodes) return { nodes, issues }
    }
  }

  return { nodes, issues }
}

export const getNodeGroupDependencies = (
  groupId: string,
  profiles: App.Profile[],
): NodeGroupDependency[] =>
  profiles.flatMap((profile) =>
    profile.outbounds.flatMap((outbound) =>
      outbound.outbounds.some((member) => member.type === 'NodeGroup' && member.id === groupId)
        ? [
            {
              profileId: profile.id,
              profileName: profile.name,
              outboundId: outbound.id,
              outboundName: outbound.tag,
            },
          ]
        : [],
    ),
  )

export const removeNodeGroupReferences = (groupId: string, profiles: App.Profile[]) => {
  let removed = 0
  profiles.forEach((profile) => {
    profile.outbounds.forEach((outbound) => {
      const next = outbound.outbounds.filter((member) => {
        const match = member.type === 'NodeGroup' && member.id === groupId
        if (match) removed += 1
        return !match
      })
      if (next.length !== outbound.outbounds.length) outbound.outbounds = next
    })
  })
  return removed
}
