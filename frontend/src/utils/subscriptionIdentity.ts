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
  const server = String(outbound.server || '')
  const port = String(outbound.server_port || outbound.port || '')
  return type && server && port ? `${type}\u0000${server.toLowerCase()}\u0000${port}` : ''
}

const uniqueCandidate = (
  previous: PreviousProxyIdentity[],
  previousKey: (candidate: PreviousProxyIdentity) => string,
  nextKey: string,
  nextKeyCounts: Map<string, number>,
) => {
  if (!nextKey || nextKeyCounts.get(nextKey) !== 1) return
  const candidates = previous.filter((candidate) => !candidate.used && previousKey(candidate) === nextKey)
  return candidates.length === 1 ? candidates[0] : undefined
}

const countKeys = (outbounds: Recordable[], getKey: (outbound: Recordable) => string) => {
  const counts = new Map<string, number>()
  outbounds.forEach((outbound) => {
    const key = getKey(outbound)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  })
  return counts
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

  const knownIds = new Map(previous.map((candidate) => [candidate.id, candidate]))
  const fingerprintCounts = countKeys(nextOutbounds, fingerprint)
  const endpointCounts = countKeys(nextOutbounds, endpointKey)
  const tagCounts = countKeys(nextOutbounds, (outbound) => String(outbound.tag || ''))

  return nextOutbounds.map((outbound) => {
    const explicitId = String(outbound.__id_in_gui || '')
    let matched = explicitId ? knownIds.get(explicitId) : undefined
    if (matched?.used) matched = undefined

    matched ||= uniqueCandidate(
      previous,
      (candidate) => fingerprint(candidate.outbound),
      fingerprint(outbound),
      fingerprintCounts,
    )
    matched ||= uniqueCandidate(
      previous,
      (candidate) => endpointKey(candidate.outbound),
      endpointKey(outbound),
      endpointCounts,
    )
    matched ||= uniqueCandidate(
      previous,
      (candidate) => candidate.tag,
      String(outbound.tag || ''),
      tagCounts,
    )

    if (matched) matched.used = true
    return {
      id: matched?.id || createId(),
      tag: String(outbound.tag || ''),
      type: String(outbound.type || ''),
    }
  })
}
