export interface RuntimeNodeDetails {
  kind: 'outbound' | 'endpoint'
  resolver?: string
  resolverAddress?: string
  via?: string
  // The actual transport order, starting with the upstream dial.
  chain: string[]
  incomplete: boolean
}

type RuntimeConfig = {
  outbounds?: Record<string, any>[]
  endpoints?: Record<string, any>[]
  dns?: { servers?: Record<string, any>[] }
  route?: { default_domain_resolver?: string | { server?: string } }
}

const resolverTag = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value || undefined
  if (value && typeof value === 'object' && 'server' in value) {
    return typeof value.server === 'string' ? value.server : undefined
  }
}

const resolverAddress = (server: Record<string, any> | undefined) => {
  if (!server) return undefined
  const address = server.server || server.address
  if (!address) return server.type || server.tag
  // DNS URLs can carry authentication. Diagnostics never expose userinfo.
  let display = String(address)
  try {
    const url = new URL(display)
    url.username = ''
    url.password = ''
    display = url.toString()
  } catch {
    // Native DNS server definitions store a hostname or IP rather than a URL.
  }
  return [server.type, display, server.server_port ? `:${server.server_port}` : '']
    .filter(Boolean)
    .join(' ')
}

export const resolveRuntimeNodeDetails = (
  config: RuntimeConfig,
  leafName: string,
  selections: Record<string, { now?: string }> = {},
): RuntimeNodeDetails | undefined => {
  const outbounds = Array.isArray(config.outbounds) ? config.outbounds : []
  const endpoints = Array.isArray(config.endpoints) ? config.endpoints : []
  const byTag = new Map([...outbounds, ...endpoints].map((node) => [node.tag, node]))
  const leaf = byTag.get(leafName)
  if (!leaf) return undefined

  const details: RuntimeNodeDetails = {
    kind: endpoints.includes(leaf) ? 'endpoint' : 'outbound',
    chain: [],
    incomplete: false,
  }
  const seen = new Set<string>()
  let current: string | undefined = leafName
  while (current) {
    if (seen.has(current)) {
      details.incomplete = true
      break
    }
    seen.add(current)
    const node = byTag.get(current)
    if (!node) {
      details.incomplete = true
      break
    }
    if (node.type === 'selector' || node.type === 'urltest') {
      // A configured first member is not necessarily the runtime selection.
      current = selections[current]?.now
      if (!current) details.incomplete = true
      continue
    }
    details.chain.unshift(current)
    if (typeof node.detour === 'string' && node.detour) {
      details.via ||= node.detour
      current = node.detour
      continue
    }
    break
  }

  // detour ignores local dial fields: do not mislabel the leaf's configured
  // resolver as active when the upstream proxy handles that connection.
  if (!details.via) {
    const servers = config.dns?.servers || []
    details.resolver =
      resolverTag(leaf.domain_resolver) ||
      resolverTag(config.route?.default_domain_resolver) ||
      (servers.length === 1 ? servers[0]?.tag : undefined)
    details.resolverAddress = resolverAddress(
      servers.find((server) => server.tag === details.resolver),
    )
  }
  return details
}
