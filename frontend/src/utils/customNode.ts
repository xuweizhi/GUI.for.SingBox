import { normalizeSubscriptionProxies } from '@/utils/subscriptionConvert'

export type CustomNodeProtocol =
  | 'socks'
  | 'http'
  | 'shadowsocks'
  | 'trojan'
  | 'vless'
  | 'vmess'
  | 'hysteria2'

export type CustomNodeTransport = '' | 'ws' | 'grpc' | 'http' | 'httpupgrade'

export interface CustomNodeDraft {
  protocol: CustomNodeProtocol
  tag: string
  server: string
  server_port: string | number
  username: string
  password: string
  uuid: string
  method: string
  socksVersion: '5' | '4' | '4a'
  flow: string
  alterId: number
  security: string
  tlsEnabled: boolean
  sni: string
  insecure: boolean
  utlsFingerprint: string
  realityPublicKey: string
  realityShortId: string
  transportType: CustomNodeTransport
  transportPath: string
  transportHost: string
  grpcServiceName: string
  obfsType: string
  obfsPassword: string
  extra?: Recordable
}

export type CustomNodeParseResult =
  | {
      ok: true
      draft: CustomNodeDraft
      missingFields: string[]
      rawOutbound?: Recordable
    }
  | {
      ok: false
      error: string
    }

export type CustomNodeBuildResult =
  | {
      ok: true
      outbound: Recordable
    }
  | {
      ok: false
      field: string
      error: string
    }

export const CustomNodeProtocolOptions: Array<{ label: string; value: CustomNodeProtocol }> = [
  { label: 'SOCKS5 / SOCKS4', value: 'socks' },
  { label: 'HTTP / HTTPS', value: 'http' },
  { label: 'Shadowsocks (SS)', value: 'shadowsocks' },
  { label: 'Trojan', value: 'trojan' },
  { label: 'VLESS', value: 'vless' },
  { label: 'VMess', value: 'vmess' },
  { label: 'Hysteria2', value: 'hysteria2' },
]

export const DefaultCustomNodeDraft = (
  protocol: CustomNodeProtocol = 'socks',
): CustomNodeDraft => ({
  protocol,
  tag: '',
  server: '',
  server_port: '',
  username: '',
  password: '',
  uuid: '',
  method: protocol === 'shadowsocks' ? 'aes-256-gcm' : '',
  socksVersion: '5',
  flow: '',
  alterId: 0,
  security: 'auto',
  tlsEnabled: protocol === 'trojan' || protocol === 'hysteria2',
  sni: '',
  insecure: false,
  utlsFingerprint: '',
  realityPublicKey: '',
  realityShortId: '',
  transportType: '',
  transportPath: '',
  transportHost: '',
  grpcServiceName: '',
  obfsType: '',
  obfsPassword: '',
})

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const decodeBase64Flexible = (input: string): string | null => {
  const normalized = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) return null
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

const stripBrackets = (host: string) =>
  host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

const parsePort = (raw: string | number | undefined): number | '' => {
  if (raw === undefined || raw === null || raw === '') return ''
  const num = Number(raw)
  return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : ''
}

const isTruthyParam = (value: string | null) =>
  value !== null && ['1', 'true', 'yes'].includes(value.trim().toLowerCase())

const normalizeTransport = (raw: string | null | undefined): CustomNodeTransport => {
  const val = (raw || '').trim().toLowerCase()
  if (val === 'ws' || val === 'websocket') return 'ws'
  if (val === 'grpc') return 'grpc'
  if (val === 'http' || val === 'h2') return 'http'
  if (val === 'httpupgrade') return 'httpupgrade'
  return ''
}

const suggestNodeTag = (draft: CustomNodeDraft): string => {
  const prefix =
    draft.protocol === 'socks'
      ? `SOCKS${draft.socksVersion}`
      : draft.protocol === 'http'
        ? draft.tlsEnabled
          ? 'HTTPS'
          : 'HTTP'
        : draft.protocol.toUpperCase()
  if (draft.server && draft.server_port) return `${prefix}-${draft.server}:${draft.server_port}`
  if (draft.server) return `${prefix}-${draft.server}`
  return prefix
}

export const getCustomNodeMissingFields = (draft: CustomNodeDraft): string[] => {
  const missing: string[] = []
  if (!draft.tag.trim()) missing.push('tag')
  if (!draft.server.trim()) missing.push('server')
  if (parsePort(draft.server_port) === '') missing.push('server_port')
  switch (draft.protocol) {
    case 'shadowsocks':
      if (!draft.method.trim()) missing.push('method')
      if (!draft.password) missing.push('password')
      break
    case 'trojan':
    case 'hysteria2':
      if (!draft.password) missing.push('password')
      break
    case 'vless':
    case 'vmess':
      if (!draft.uuid.trim()) missing.push('uuid')
      break
    case 'socks':
    case 'http':
      break
  }
  return missing
}

const parseStandardUrl = (raw: string): URL | null => {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

export const outboundToCustomNodeDraft = (outbound: Recordable): CustomNodeDraft | null => {
  const type = String(outbound?.type || '').toLowerCase()
  const supported: CustomNodeProtocol[] = [
    'socks',
    'http',
    'shadowsocks',
    'trojan',
    'vless',
    'vmess',
    'hysteria2',
  ]
  if (!supported.includes(type as CustomNodeProtocol)) return null

  const draft = DefaultCustomNodeDraft(type as CustomNodeProtocol)
  draft.tag = String(outbound.tag || '')
  draft.server = String(outbound.server || '')
  draft.server_port = parsePort(outbound.server_port)
  draft.username = String(outbound.username || '')
  draft.password = String(outbound.password || '')
  draft.uuid = String(outbound.uuid || '')
  draft.method = String(outbound.method || (type === 'shadowsocks' ? 'aes-256-gcm' : ''))
  if (type === 'socks') {
    const v = String(outbound.version || '5')
    draft.socksVersion = v === '4' || v === '4a' ? v : '5'
  }
  draft.flow = String(outbound.flow || '')
  draft.alterId = Number(outbound.alter_id || 0)
  draft.security = String(outbound.security || 'auto')

  const tls = outbound.tls
  if (tls && typeof tls === 'object') {
    draft.tlsEnabled = Boolean(tls.enabled)
    draft.sni = String(tls.server_name || '')
    draft.insecure = Boolean(tls.insecure)
    if (tls.utls?.fingerprint) draft.utlsFingerprint = String(tls.utls.fingerprint)
    if (tls.reality?.enabled) {
      draft.realityPublicKey = String(tls.reality.public_key || '')
      draft.realityShortId = String(tls.reality.short_id || '')
    }
  }

  const transport = outbound.transport
  if (transport && typeof transport === 'object') {
    draft.transportType = normalizeTransport(transport.type)
    draft.transportPath = String(transport.path || '')
    if (transport.type === 'ws') {
      draft.transportHost = String(transport.headers?.Host || transport.headers?.host || '')
    } else if (transport.type === 'http') {
      draft.transportHost = Array.isArray(transport.host)
        ? String(transport.host[0] || '')
        : String(transport.host || '')
    } else if (transport.type === 'httpupgrade') {
      draft.transportHost = String(transport.host || '')
    } else if (transport.type === 'grpc') {
      draft.grpcServiceName = String(transport.service_name || '')
    }
  }

  if (type === 'hysteria2' && outbound.obfs && typeof outbound.obfs === 'object') {
    draft.obfsType = String(outbound.obfs.type || '')
    draft.obfsPassword = String(outbound.obfs.password || '')
  }

  return draft
}

export const parseCustomNodeUri = (rawUri: string): CustomNodeParseResult => {
  const trimmed = rawUri.trim()
  if (!trimmed) {
    return { ok: false, error: 'subscribe.customNode.emptyUri' }
  }

  // Allow pasting a raw sing-box outbound JSON object too.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const draft = outboundToCustomNodeDraft(parsed)
      if (!draft) return { ok: false, error: 'subscribe.customNode.unsupportedProtocol' }
      return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft), rawOutbound: parsed }
    } catch {
      return { ok: false, error: 'subscribe.customNode.invalidUri' }
    }
  }

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
  if (!schemeMatch) {
    return { ok: false, error: 'subscribe.customNode.invalidUri' }
  }
  const scheme = schemeMatch[1]!.toLowerCase()

  // VMess JSON-in-base64 format
  if (scheme === 'vmess') {
    const encoded = trimmed.slice('vmess://'.length)
    const decoded = decodeBase64Flexible(encoded)
    if (!decoded) return { ok: false, error: 'subscribe.customNode.invalidUri' }
    try {
      const payload = JSON.parse(decoded)
      const draft = DefaultCustomNodeDraft('vmess')
      draft.tag = String(payload.ps || '').trim()
      draft.server = String(payload.add || '').trim()
      draft.server_port = parsePort(payload.port)
      draft.uuid = String(payload.id || '').trim()
      draft.alterId = Number(payload.aid || 0)
      draft.security = String(payload.scy || 'auto')
      draft.tlsEnabled = payload.tls === 'tls' || payload.tls === true
      draft.sni = String(payload.sni || payload.host || '').trim()
      draft.insecure = Boolean(payload.skipCertVerify)
      draft.utlsFingerprint = String(payload.fp || '').trim()
      draft.transportType = normalizeTransport(payload.net)
      draft.transportPath = String(payload.path || '').trim()
      draft.transportHost = String(payload.host || '').trim()
      if (draft.transportType === 'grpc') {
        draft.grpcServiceName = String(payload.path || '').trim()
      }
      if (!draft.tag) draft.tag = suggestNodeTag(draft)
      return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
    } catch {
      return { ok: false, error: 'subscribe.customNode.invalidUri' }
    }
  }

  // Shadowsocks (SIP002 or legacy base64)
  if (scheme === 'ss') {
    const bodyWithHash = trimmed.slice('ss://'.length)
    const hashIdx = bodyWithHash.indexOf('#')
    const tag = hashIdx !== -1 ? safeDecode(bodyWithHash.slice(hashIdx + 1)).trim() : ''
    const beforeHash = hashIdx !== -1 ? bodyWithHash.slice(0, hashIdx) : bodyWithHash
    const queryIdx = beforeHash.indexOf('?')
    const mainPart = queryIdx !== -1 ? beforeHash.slice(0, queryIdx) : beforeHash

    let method = ''
    let password = ''
    let server = ''
    let port: number | '' = ''

    const atIdx = mainPart.lastIndexOf('@')
    if (atIdx !== -1) {
      // SIP002: ss://BASE64(method:pass)@host:port or ss://method:pass@host:port
      const userInfoRaw = mainPart.slice(0, atIdx)
      const hostPortRaw = mainPart.slice(atIdx + 1)
      const decodedUser = userInfoRaw.includes(':')
        ? safeDecode(userInfoRaw)
        : decodeBase64Flexible(userInfoRaw) || safeDecode(userInfoRaw)
      const colonIdx = decodedUser.indexOf(':')
      if (colonIdx !== -1) {
        method = decodedUser.slice(0, colonIdx)
        password = decodedUser.slice(colonIdx + 1)
      }
      const parsedHost = parseStandardUrl(`http://${hostPortRaw}`)
      if (parsedHost) {
        server = stripBrackets(parsedHost.hostname)
        port = parsePort(parsedHost.port)
      }
    } else {
      // Legacy: ss://BASE64(method:pass@host:port)
      const decoded = decodeBase64Flexible(mainPart)
      if (!decoded) return { ok: false, error: 'subscribe.customNode.invalidUri' }
      const innerAt = decoded.lastIndexOf('@')
      if (innerAt === -1) return { ok: false, error: 'subscribe.customNode.invalidUri' }
      const userInfo = decoded.slice(0, innerAt)
      const hostPort = decoded.slice(innerAt + 1)
      const colonIdx = userInfo.indexOf(':')
      if (colonIdx !== -1) {
        method = userInfo.slice(0, colonIdx)
        password = userInfo.slice(colonIdx + 1)
      }
      const parsedHost = parseStandardUrl(`http://${hostPort}`)
      if (parsedHost) {
        server = stripBrackets(parsedHost.hostname)
        port = parsePort(parsedHost.port)
      }
    }

    const draft = DefaultCustomNodeDraft('shadowsocks')
    draft.tag = tag
    draft.server = server
    draft.server_port = port
    draft.method = method
    draft.password = password
    if (!draft.tag) draft.tag = suggestNodeTag(draft)
    return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
  }

  // Standard URL-like protocols: socks5/socks4/socks4a/socks, http/https, trojan, vless, hy2/hysteria2
  const normalizedUrlString = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, 'http://')
  const url = parseStandardUrl(normalizedUrlString)
  if (!url) {
    return { ok: false, error: 'subscribe.customNode.invalidUri' }
  }

  const tag = url.hash ? safeDecode(url.hash.slice(1)).trim() : ''
  const server = stripBrackets(url.hostname)
  const port = parsePort(url.port)
  const params = url.searchParams

  if (['socks', 'socks5', 'socks4', 'socks4a'].includes(scheme)) {
    const draft = DefaultCustomNodeDraft('socks')
    draft.socksVersion = scheme === 'socks4' ? '4' : scheme === 'socks4a' ? '4a' : '5'
    draft.server = server
    draft.server_port = port
    let username = safeDecode(url.username)
    let password = safeDecode(url.password)
    if (username && !password) {
      const decoded = decodeBase64Flexible(username)
      if (decoded && decoded.includes(':') && /^[\x20-\x7E]+$/.test(decoded)) {
        const idx = decoded.indexOf(':')
        username = decoded.slice(0, idx)
        password = decoded.slice(idx + 1)
      }
    }
    draft.username = username
    draft.password = password
    draft.tag = tag || suggestNodeTag(draft)
    return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
  }

  if (scheme === 'http' || scheme === 'https') {
    const draft = DefaultCustomNodeDraft('http')
    draft.server = server
    draft.server_port = port || (scheme === 'https' ? 443 : '')
    draft.username = safeDecode(url.username)
    draft.password = safeDecode(url.password)
    draft.tlsEnabled = scheme === 'https'
    draft.sni = params.get('sni') || ''
    draft.insecure = isTruthyParam(params.get('insecure') || params.get('allowInsecure'))
    draft.tag = tag || suggestNodeTag(draft)
    return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
  }

  if (scheme === 'trojan') {
    const draft = DefaultCustomNodeDraft('trojan')
    draft.server = server
    draft.server_port = port
    draft.password = safeDecode(url.username)
    draft.tlsEnabled = params.get('security') !== 'none'
    draft.sni = params.get('sni') || params.get('peer') || ''
    draft.insecure = isTruthyParam(params.get('allowInsecure') || params.get('insecure'))
    draft.utlsFingerprint = params.get('fp') || ''
    draft.transportType = normalizeTransport(params.get('type'))
    draft.transportPath = safeDecode(params.get('path') || '')
    draft.transportHost = params.get('host') || ''
    draft.grpcServiceName = params.get('serviceName') || ''
    draft.tag = tag || suggestNodeTag(draft)
    return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
  }

  if (scheme === 'vless') {
    const draft = DefaultCustomNodeDraft('vless')
    draft.server = server
    draft.server_port = port
    draft.uuid = safeDecode(url.username)
    draft.flow = params.get('flow') || ''
    const security = (params.get('security') || '').toLowerCase()
    draft.tlsEnabled = security === 'tls' || security === 'reality'
    draft.sni = params.get('sni') || ''
    draft.insecure = isTruthyParam(params.get('allowInsecure') || params.get('insecure'))
    draft.utlsFingerprint = params.get('fp') || ''
    if (security === 'reality') {
      draft.realityPublicKey = params.get('pbk') || ''
      draft.realityShortId = params.get('sid') || ''
    }
    draft.transportType = normalizeTransport(params.get('type'))
    draft.transportPath = safeDecode(params.get('path') || '')
    draft.transportHost = params.get('host') || ''
    draft.grpcServiceName = params.get('serviceName') || ''
    draft.tag = tag || suggestNodeTag(draft)
    return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
  }

  if (scheme === 'hy2' || scheme === 'hysteria2') {
    const draft = DefaultCustomNodeDraft('hysteria2')
    draft.server = server
    draft.server_port = port
    draft.password = url.password
      ? `${safeDecode(url.username)}:${safeDecode(url.password)}`
      : safeDecode(url.username)
    draft.tlsEnabled = true
    draft.sni = params.get('sni') || ''
    draft.insecure = isTruthyParam(params.get('insecure'))
    draft.obfsType = params.get('obfs') || ''
    draft.obfsPassword = params.get('obfs-password') || ''
    draft.tag = tag || suggestNodeTag(draft)
    return { ok: true, draft, missingFields: getCustomNodeMissingFields(draft) }
  }

  return { ok: false, error: 'subscribe.customNode.unsupportedProtocol' }
}

export const parseCustomNodeUriWithFallback = async (
  rawUri: string,
): Promise<CustomNodeParseResult> => {
  const direct = parseCustomNodeUri(rawUri)
  if (direct.ok) return direct
  const trimmed = rawUri.trim()
  if (!trimmed || !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return direct

  try {
    const normalized = await normalizeSubscriptionProxies([{ base64: trimmed }])
    const first = normalized[0]
    if (!first || typeof first !== 'object') return direct
    const draft = outboundToCustomNodeDraft(first)
    if (draft) {
      if (!draft.tag) draft.tag = suggestNodeTag(draft)
      return {
        ok: true,
        draft,
        missingFields: getCustomNodeMissingFields(draft),
        rawOutbound: first,
      }
    }
    return {
      ok: true,
      draft: {
        ...DefaultCustomNodeDraft('socks'),
        tag: String(first.tag || ''),
        server: String(first.server || ''),
        server_port: parsePort(first.server_port),
        extra: first,
      },
      missingFields: !first.tag ? ['tag'] : [],
      rawOutbound: first,
    }
  } catch {
    return direct
  }
}

export const buildSingBoxOutbound = (draft: CustomNodeDraft): CustomNodeBuildResult => {
  const tag = draft.tag.trim()
  if (!tag) return { ok: false, field: 'tag', error: 'workspace.required' }

  // Passthrough for exotic protocols parsed via fallback converter
  if (draft.extra && typeof draft.extra === 'object' && draft.extra.type && draft.extra.type !== draft.protocol) {
    return { ok: true, outbound: { ...draft.extra, tag } }
  }

  const server = draft.server.trim()
  if (!server) return { ok: false, field: 'server', error: 'workspace.required' }

  const port = parsePort(draft.server_port)
  if (port === '') {
    return { ok: false, field: 'server_port', error: 'subscribe.customNode.invalidPort' }
  }

  const outbound: Recordable = {
    type: draft.protocol,
    tag,
    server,
    server_port: port,
  }

  switch (draft.protocol) {
    case 'socks':
      outbound.version = draft.socksVersion || '5'
      if (draft.username) outbound.username = draft.username
      if (draft.password) outbound.password = draft.password
      break
    case 'http':
      if (draft.username) outbound.username = draft.username
      if (draft.password) outbound.password = draft.password
      break
    case 'shadowsocks':
      if (!draft.method.trim()) return { ok: false, field: 'method', error: 'workspace.required' }
      if (!draft.password) return { ok: false, field: 'password', error: 'workspace.required' }
      outbound.method = draft.method.trim()
      outbound.password = draft.password
      break
    case 'trojan':
      if (!draft.password) return { ok: false, field: 'password', error: 'workspace.required' }
      outbound.password = draft.password
      break
    case 'vless':
      if (!draft.uuid.trim()) return { ok: false, field: 'uuid', error: 'workspace.required' }
      outbound.uuid = draft.uuid.trim()
      if (draft.flow.trim()) outbound.flow = draft.flow.trim()
      break
    case 'vmess':
      if (!draft.uuid.trim()) return { ok: false, field: 'uuid', error: 'workspace.required' }
      outbound.uuid = draft.uuid.trim()
      outbound.security = draft.security.trim() || 'auto'
      outbound.alter_id = Number.isFinite(draft.alterId) ? Math.max(0, Math.floor(draft.alterId)) : 0
      break
    case 'hysteria2':
      if (!draft.password) return { ok: false, field: 'password', error: 'workspace.required' }
      outbound.password = draft.password
      if (draft.obfsType.trim()) {
        outbound.obfs = {
          type: draft.obfsType.trim(),
          ...(draft.obfsPassword ? { password: draft.obfsPassword } : {}),
        }
      }
      break
  }

  // TLS / Reality configuration
  const supportsTls = ['http', 'trojan', 'vless', 'vmess', 'hysteria2'].includes(draft.protocol)
  if (supportsTls && (draft.tlsEnabled || draft.protocol === 'hysteria2')) {
    const tls: Recordable = { enabled: true }
    if (draft.sni.trim()) tls.server_name = draft.sni.trim()
    if (draft.insecure) tls.insecure = true
    if (draft.utlsFingerprint.trim()) {
      tls.utls = { enabled: true, fingerprint: draft.utlsFingerprint.trim() }
    }
    if (draft.protocol === 'vless' && draft.realityPublicKey.trim()) {
      tls.reality = {
        enabled: true,
        public_key: draft.realityPublicKey.trim(),
        ...(draft.realityShortId.trim() ? { short_id: draft.realityShortId.trim() } : {}),
      }
    }
    outbound.tls = tls
  }

  // Transport configuration
  const supportsTransport = ['trojan', 'vless', 'vmess'].includes(draft.protocol)
  if (supportsTransport && draft.transportType) {
    if (draft.transportType === 'ws') {
      const transport: Recordable = { type: 'ws' }
      if (draft.transportPath.trim()) transport.path = draft.transportPath.trim()
      if (draft.transportHost.trim()) transport.headers = { Host: draft.transportHost.trim() }
      outbound.transport = transport
    } else if (draft.transportType === 'grpc') {
      const transport: Recordable = { type: 'grpc' }
      if (draft.grpcServiceName.trim()) transport.service_name = draft.grpcServiceName.trim()
      outbound.transport = transport
    } else if (draft.transportType === 'http') {
      const transport: Recordable = { type: 'http' }
      if (draft.transportHost.trim()) transport.host = [draft.transportHost.trim()]
      if (draft.transportPath.trim()) transport.path = draft.transportPath.trim()
      outbound.transport = transport
    } else if (draft.transportType === 'httpupgrade') {
      const transport: Recordable = { type: 'httpupgrade' }
      if (draft.transportHost.trim()) transport.host = draft.transportHost.trim()
      if (draft.transportPath.trim()) transport.path = draft.transportPath.trim()
      outbound.transport = transport
    }
  }

  return { ok: true, outbound }
}
