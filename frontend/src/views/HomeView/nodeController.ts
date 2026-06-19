import type { CoreApiProxy } from '@/types/kernel'

export type NodeMode = 'rule' | 'global' | 'direct'
export type ChainError = 'missing' | 'cycle'
export type DelayStatus = 'untested' | 'success' | 'failed'

export interface ProxyChain {
  chain: string[]
  leafName: string
  leaf?: CoreApiProxy
  delay: number | null
  error?: ChainError
}

export interface PrimaryNodeState extends ProxyChain {
  kind: 'group' | 'direct' | 'unavailable'
  groupName: string
  group?: CoreApiProxy
  readonly: boolean
}

export interface NodeListItem {
  name: string
  proxy?: CoreApiProxy
  delay: number | null
  delayStatus: DelayStatus
  originalIndex: number
  error?: string
}

type NodeProfile = Pick<IProfile, 'route' | 'outbounds'> | undefined

const latestDelay = (proxy?: CoreApiProxy) => {
  const history = proxy?.history || []
  return history.length ? history[history.length - 1]!.delay : null
}

const profileTagForId = (profile: NodeProfile, id: string) => {
  return profile?.outbounds.find((outbound) => outbound.id === id)?.tag || id
}

const hiddenTags = (profile: NodeProfile) => {
  return new Set(
    (profile?.outbounds || [])
      .filter((outbound) => outbound.hidden)
      .map((outbound) => outbound.tag),
  )
}

export const resolveProxyChain = (
  startName: string,
  proxies: Record<string, CoreApiProxy>,
): ProxyChain => {
  const chain: string[] = []
  const visited = new Set<string>()
  let currentName = startName

  while (currentName && chain.length <= Object.keys(proxies).length) {
    if (visited.has(currentName)) {
      return {
        chain,
        leafName: chain.at(-1) || startName,
        delay: null,
        error: 'cycle',
      }
    }

    visited.add(currentName)
    chain.push(currentName)
    const current = proxies[currentName]

    if (!current) {
      return { chain, leafName: currentName, delay: null, error: 'missing' }
    }

    if (!current.now) {
      const delay = latestDelay(current)
      return {
        chain,
        leafName: currentName,
        leaf: current,
        delay: delay && delay > 0 ? delay : null,
      }
    }

    currentName = current.now
  }

  return {
    chain,
    leafName: chain.at(-1) || startName,
    delay: null,
    error: 'cycle',
  }
}

const firstSelectorFrom = (
  startName: string,
  proxies: Record<string, CoreApiProxy>,
  excluded: Set<string>,
) => {
  const visited = new Set<string>()
  let currentName = startName

  while (currentName && !visited.has(currentName)) {
    visited.add(currentName)
    const current = proxies[currentName]
    if (!current) return
    if (current.type === 'Selector' && !excluded.has(current.name)) return current
    currentName = current.now || ''
  }
}

export const getVisibleGroups = (
  mode: NodeMode,
  profile: NodeProfile,
  proxies: Record<string, CoreApiProxy>,
) => {
  const hidden = hiddenTags(profile)
  const regular = Object.values(proxies).filter(
    (proxy) =>
      ['Selector', 'URLTest'].includes(proxy.type) &&
      proxy.name !== 'GLOBAL' &&
      !hidden.has(proxy.name),
  )
  const global = proxies.GLOBAL
  if (!global) return regular
  return mode === 'global' ? [global, ...regular] : [...regular, global]
}

export const resolvePrimaryNode = (
  mode: NodeMode,
  profile: NodeProfile,
  proxies: Record<string, CoreApiProxy>,
): PrimaryNodeState => {
  if (mode === 'direct') {
    return {
      kind: 'direct',
      groupName: 'direct',
      chain: ['direct'],
      leafName: 'direct',
      leaf: proxies.direct,
      delay: null,
      readonly: true,
    }
  }

  let group = mode === 'global' ? proxies.GLOBAL : undefined
  if (!group && mode === 'rule') {
    const routeTag = profileTagForId(profile, profile?.route.final || '')
    group = firstSelectorFrom(routeTag, proxies, hiddenTags(profile))
  }
  if (!group) {
    group = getVisibleGroups(mode, profile, proxies).find(
      (proxy) => proxy.type === 'Selector' && proxy.name !== 'GLOBAL',
    )
  }
  if (!group) {
    return {
      kind: 'unavailable',
      groupName: '',
      chain: [],
      leafName: '',
      delay: null,
      readonly: true,
    }
  }

  return {
    kind: 'group',
    groupName: group.name,
    group,
    readonly: false,
    ...resolveProxyChain(group.name, proxies),
  }
}

export const filterAndSortNodes = (
  group: CoreApiProxy,
  proxies: Record<string, CoreApiProxy>,
  query: string,
  sortByDelay: boolean,
  errors: Map<string, string>,
): NodeListItem[] => {
  const keyword = query.trim().toLocaleLowerCase()
  const nodes = (group.all || []).map((name, originalIndex) => {
    const proxy = proxies[name]
    const delay = latestDelay(proxy)
    const failed = errors.has(name) || (delay !== null && delay <= 0)
    return {
      name,
      proxy,
      delay: delay && delay > 0 ? delay : null,
      delayStatus: failed ? 'failed' : delay ? 'success' : 'untested',
      originalIndex,
      error: errors.get(name),
    } satisfies NodeListItem
  })

  const filtered = keyword
    ? nodes.filter((node) => node.name.toLocaleLowerCase().includes(keyword))
    : nodes
  if (!sortByDelay) return filtered

  return filtered.sort((a, b) => {
    if (a.delay !== null && b.delay !== null) {
      return a.delay - b.delay || a.originalIndex - b.originalIndex
    }
    if (a.delay !== null) return -1
    if (b.delay !== null) return 1
    return a.originalIndex - b.originalIndex
  })
}
