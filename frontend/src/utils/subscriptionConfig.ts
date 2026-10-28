/** Subscription cache metadata must never reach the sing-box configuration. */
export const isSubscriptionEndpoint = (value: Recordable) => value?._gui_kind === 'endpoint'

export const stripSubscriptionMetadata = (value: Recordable): Recordable => {
  const next = { ...value }
  for (const key of ['_gui_kind', '__id__', '__tmp__id__', '__id_in_gui']) delete next[key]
  return next
}

const isRecord = (value: unknown): value is Recordable =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export const validateSubscriptionEntries = (entries: unknown): Recordable[] => {
  if (!Array.isArray(entries)) throw new Error('Subscription nodes must be an array')
  return entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.type !== 'string' || !entry.type.trim()) {
      throw new Error(`Subscription node ${index + 1} must have a protocol type`)
    }
    if (typeof entry.tag !== 'string' || !entry.tag.trim()) {
      throw new Error(`Subscription node ${index + 1} must have a non-empty tag`)
    }
    if (entry._gui_kind !== undefined && entry._gui_kind !== 'endpoint') {
      throw new Error(`Subscription node ${entry.tag} has an invalid endpoint marker`)
    }
    return { ...entry }
  })
}

/** Parse addresses entered by the user (or Clash proxy-server-nameserver). */
export const parseSubscriptionDnsAddresses = (addresses: string[]): Recordable[] =>
  [...new Set(addresses.map((address) => address.trim()).filter(Boolean))].map((address, index) => {
    const tag = `dns-${index + 1}`
    if (address === 'local' || address === 'local://') return { type: 'local', tag }
    const fail = () => new Error(`Invalid or unsupported subscription DNS address: ${address}`)
    if (/\s/.test(address)) throw fail()
    // Bare IPv6 addresses need brackets before URL parsing.
    const bare = !address.includes('://')
    const host =
      bare && address.split(':').length > 2 && !address.startsWith('[') ? `[${address}]` : address
    let url: URL
    try {
      url = new URL(bare ? `udp://${host}` : address)
    } catch {
      throw fail()
    }
    const type = url.protocol.slice(0, -1)
    if (
      !['udp', 'tcp', 'tls', 'quic', 'https', 'h3'].includes(type) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw fail()
    if (!['https', 'h3'].includes(type) && url.pathname && url.pathname !== '/') throw fail()
    const server = url.hostname.replace(/^\[|\]$/g, '')
    const port = url.port ? Number(url.port) : undefined
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw fail()
    const definition: Recordable = { type, tag, server }
    if (port !== undefined) definition.server_port = port
    if (type === 'https' || type === 'h3')
      definition.path = url.pathname && url.pathname !== '/' ? url.pathname : '/dns-query'
    return definition
  })

export interface SubscriptionConfig {
  /** Both normal outbounds and endpoints, with endpoints marked for cache persistence. */
  outbounds: Recordable[]
  importedDns?: NonNullable<App.Subscription['importedDns']>
}

export const extractSubscriptionConfig = (value: unknown): SubscriptionConfig => {
  if (Array.isArray(value)) return { outbounds: validateSubscriptionEntries(value) }
  if (!isRecord(value)) throw new Error('Not a valid subscription configuration')
  const entries: Recordable[] = []
  let found = false
  for (const kind of ['outbounds', 'endpoints'] as const) {
    if (value[kind] === undefined) continue
    found = true
    const nodes = validateSubscriptionEntries(value[kind])
    entries.push(
      ...nodes.map((entry) => (kind === 'endpoints' ? { ...entry, _gui_kind: 'endpoint' } : entry)),
    )
  }
  // Clash entries are converted after import; their name field becomes tag later.
  if (!found && value.proxies !== undefined) {
    if (!Array.isArray(value.proxies) || value.proxies.some((entry: unknown) => !isRecord(entry))) {
      throw new Error('Subscription proxies must be an array of objects')
    }
    entries.push(...value.proxies.map((entry: Recordable) => ({ ...entry })))
    found = true
  }
  if (!found) throw new Error('Subscription configuration has no outbounds or endpoints')

  let importedDns: SubscriptionConfig['importedDns']
  if (isRecord(value.dns) && value.dns.servers !== undefined) {
    if (
      !Array.isArray(value.dns.servers) ||
      value.dns.servers.some((server: unknown) => !isRecord(server))
    ) {
      throw new Error('Subscription DNS servers must be an array of objects')
    }
    const servers = value.dns.servers.map((server: Recordable, index: number) => ({
      ...server,
      tag: typeof server.tag === 'string' && server.tag ? server.tag : `dns-${index + 1}`,
    }))
    if (servers.length) {
      const routeResolver = value.route?.default_domain_resolver
      const resolver = typeof routeResolver === 'string' ? routeResolver : routeResolver?.server
      importedDns = {
        servers,
        resolver:
          typeof resolver === 'string' && resolver
            ? resolver
            : typeof value.dns.final === 'string' && value.dns.final
              ? value.dns.final
              : servers[0]!.tag,
      }
    }
  } else if (isRecord(value.dns) && value.dns['proxy-server-nameserver'] !== undefined) {
    const nameservers = value.dns['proxy-server-nameserver']
    const addresses = typeof nameservers === 'string' ? [nameservers] : nameservers
    if (!Array.isArray(addresses) || addresses.some((address) => typeof address !== 'string')) {
      throw new Error('Subscription proxy-server-nameserver must contain DNS addresses')
    }
    const servers = parseSubscriptionDnsAddresses(addresses)
    if (servers.length) importedDns = { servers, resolver: servers[0]!.tag }
  }
  return { outbounds: entries, ...(importedDns ? { importedDns } : {}) }
}

/** Show the standard sing-box shape in the editor, keeping endpoint fields intact. */
export const subscriptionConfigForEditing = (
  entries: Recordable[],
  importedDns?: App.Subscription['importedDns'],
): Recordable => ({
  outbounds: entries.filter((entry) => !isSubscriptionEndpoint(entry)),
  endpoints: entries.filter(isSubscriptionEndpoint).map((entry) => {
    const next = { ...entry }
    delete next._gui_kind
    return next
  }),
  ...(importedDns ? { dns: { servers: importedDns.servers, final: importedDns.resolver } } : {}),
})
