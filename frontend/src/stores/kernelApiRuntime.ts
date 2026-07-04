import type { ProxyType } from '@/stores/kernelApi'

type RuntimeListen = {
  listen?: string
  listen_port?: number
}

type RuntimeInbound = {
  enable?: boolean
  type?: string
  listen?: string
  listen_port?: number
  users?: string[]
  mixed?: {
    listen: RuntimeListen
    users?: string[]
  }
  http?: {
    listen: RuntimeListen
    users?: string[]
  }
  socks?: {
    listen: RuntimeListen
    users?: string[]
  }
  tun?: {
    interface_name?: string
    stack?: string
  }
}

const normalizeProxyHost = (host: string) => {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1)
  }
  return host
}

const isRuntimeInboundEnabled = (inbound: RuntimeInbound | undefined) => {
  return !!inbound && inbound.enable !== false
}

const findRuntimeInbound = (inbounds: RuntimeInbound[], key: 'mixed' | 'http' | 'socks' | 'tun') => {
  return inbounds.find((inbound) => isRuntimeInboundEnabled(inbound) && !!inbound[key])
}

const getInboundListen = (inbound: RuntimeInbound | undefined, proxyType: ProxyType) => {
  if (!inbound) return { listen: '', port: 0 }

  const nested =
    proxyType === 'mixed'
      ? inbound.mixed?.listen
      : proxyType === 'http'
        ? inbound.http?.listen
        : inbound.socks?.listen

  return {
    listen: nested?.listen || inbound.listen || '',
    port: nested?.listen_port || inbound.listen_port || 0,
  }
}

const getInboundUsers = (inbound: RuntimeInbound | undefined, proxyType: ProxyType) => {
  if (!inbound) return []

  const nestedUsers =
    proxyType === 'mixed'
      ? inbound.mixed?.users
      : proxyType === 'http'
        ? inbound.http?.users
        : inbound.socks?.users

  return nestedUsers || inbound.users || []
}

export const resolveRuntimeInboundState = (inbounds: RuntimeInbound[]) => {
  const mixed = findRuntimeInbound(inbounds, 'mixed') || inbounds.find((inbound) => isRuntimeInboundEnabled(inbound) && inbound.type === 'mixed')
  const http = findRuntimeInbound(inbounds, 'http') || inbounds.find((inbound) => isRuntimeInboundEnabled(inbound) && inbound.type === 'http')
  const socks = findRuntimeInbound(inbounds, 'socks') || inbounds.find((inbound) => isRuntimeInboundEnabled(inbound) && inbound.type === 'socks')
  const tun = findRuntimeInbound(inbounds, 'tun')
  const mixedListen = getInboundListen(mixed, 'mixed')
  const httpListen = getInboundListen(http, 'http')
  const socksListen = getInboundListen(socks, 'socks')

  return {
    mixedPort: mixedListen.port,
    httpPort: httpListen.port,
    socksPort: socksListen.port,
    allowLan: [mixedListen.listen, httpListen.listen, socksListen.listen].some((address) => address === '0.0.0.0' || address === '::'),
    tunEnable: !!tun?.tun,
    tunDevice: tun?.tun?.interface_name || '',
    tunStack: tun?.tun?.stack || '',
  }
}

export const getProxyProfileOptionsFromRuntime = (inbounds: RuntimeInbound[], proxyType: ProxyType) => {
  const inboundTypeMap = {
    mixed: 'mixed',
    http: 'http',
    socks: 'socks',
  } satisfies Record<ProxyType, RuntimeInbound['type']>

  const inbound = inbounds.find(
    (item) => isRuntimeInboundEnabled(item) && item.type === inboundTypeMap[proxyType],
  )

  const { listen } = getInboundListen(inbound, proxyType)
  const auth = getInboundUsers(inbound, proxyType)[0]?.trim()
  const host = normalizeProxyHost((listen || '').trim())

  if (!auth) return { host, username: '', password: '' }

  const [username, ...passwordParts] = auth.split(':')

  return {
    host,
    username: username || '',
    password: passwordParts.join(':'),
  }
}
