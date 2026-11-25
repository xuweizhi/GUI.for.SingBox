import { isSubscriptionEndpoint } from './subscriptionConfig'

interface PreviousProxyIdentity {
  id: string
  tag: string
  type: string
  outbound?: Recordable
  used: boolean
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value as Recordable)
    .filter((key) => key !== 'tag' && !key.startsWith('__'))
    .sort()
    .reduce<Recordable>((result, key) => {
      result[key] = canonicalValue((value as Recordable)[key])
      return result
    }, {})
}

const fingerprint = (outbound?: Recordable) =>
  outbound ? JSON.stringify(canonicalValue(outbound)) : ''

const endpointKey = (outbound?: Recordable) => {
  if (!outbound) return ''
  const type = String(outbound.type || '')
  if (isSubscriptionEndpoint(outbound)) {
    if (type === 'wireguard' && Array.isArray(outbound.peers)) {
      const peers = outbound.peers
        .map((peer: Recordable) =>
          peer.address && peer.port ? `${String(peer.address).toLowerCase()}:${peer.port}` : '',
        )
        .filter(Boolean)
        .sort()
      if (peers.length) return `endpoint\u0000${type}\u0000${peers.join('\u0000')}`
    }
    if (type === 'tailscale' && outbound.state_directory) {
      return `endpoint\u0000${type}\u0000${outbound.state_directory}`
    }
  }
  const server = String(outbound.server || '')
  const port = String(outbound.server_port || outbound.port || '')
  return type && server && port ? `${type}\u0000${server.toLowerCase()}\u0000${port}` : ''
}

export const reconcileSubscriptionProxyIds = (
  previousMetadata: App.Subscription['proxies'],
  previousOutbounds: Recordable[],
  nextOutbounds: Recordable[],
  createId: () => string,
): App.Subscription['proxies'] => {
  const metadataQueues = new Map<string, App.Subscription['proxies']>()
  previousMetadata.forEach((proxy) => {
    const queue = metadataQueues.get(proxy.tag) || []
    queue.push(proxy)
    metadataQueues.set(proxy.tag, queue)
  })

  const previous: PreviousProxyIdentity[] = []
  previousOutbounds.forEach((outbound) => {
    const tag = String(outbound.tag || '')
    const metadata = metadataQueues.get(tag)?.shift()
    if (!metadata) return
    previous.push({ ...metadata, outbound, used: false })
  })
  metadataQueues.forEach((queue) => {
    queue.forEach((metadata) => previous.push({ ...metadata, used: false }))
  })

  // Reserve strong matches across the entire update before considering weaker keys.
  const matches = new Map<number, PreviousProxyIdentity>()
  const matchBy = (
    oldKey: (candidate: PreviousProxyIdentity) => string,
    newKey: (node: Recordable) => string,
  ) => {
    const candidates = new Map<string, PreviousProxyIdentity | null>()
    for (const candidate of previous) {
      if (candidate.used) continue
      const key = oldKey(candidate)
      if (key) candidates.set(key, candidates.has(key) ? null : candidate)
    }
    const indices = new Map<string, number | null>()
    nextOutbounds.forEach((node, index) => {
      if (matches.has(index)) return
      const key = newKey(node)
      if (key) indices.set(key, indices.has(key) ? null : index)
    })
    for (const [key, index] of indices) {
      const candidate = candidates.get(key)
      if (index === null || !candidate) continue
      matches.set(index, candidate)
      candidate.used = true
    }
  }
  matchBy(
    (c) => c.id,
    (node) => String(node.__id_in_gui || ''),
  )
  matchBy((c) => fingerprint(c.outbound), fingerprint)
  matchBy((c) => endpointKey(c.outbound), endpointKey)
  matchBy(
    (c) => c.tag,
    (node) => String(node.tag || ''),
  )

  return nextOutbounds.map((outbound, index) => {
    return {
      id: matches.get(index)?.id || createId(),
      tag: String(outbound.tag || ''),
      type: String(outbound.type || ''),
      ...(isSubscriptionEndpoint(outbound) ? { kind: 'endpoint' as const } : {}),
    }
  })
}
