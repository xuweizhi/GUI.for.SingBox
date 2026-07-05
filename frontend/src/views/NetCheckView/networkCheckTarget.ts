export interface ParsedNetworkCheckTarget {
  input: string
  requestUrl: string
  requestHost: string
  tcpHost: string
  tcpPort: number
  displayHost: string
  dnsLookupHost: string
  targetKind: 'domain' | 'ip'
}

const stripIpv6Brackets = (host: string): string => host.replace(/^\[|\]$/g, '')

const isIpLiteral = (host: string): boolean => {
  const normalizedHost = stripIpv6Brackets(host)

  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalizedHost)) {
    return normalizedHost.split('.').every((segment) => {
      const value = Number(segment)
      return value >= 0 && value <= 255
    })
  }

  return normalizedHost.includes(':')
}

export const parseNetworkCheckTarget = (raw: string): ParsedNetworkCheckTarget => {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('netCheck.invalidTarget')
  }

  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(withScheme)
    if (!url.hostname) {
      throw new Error('netCheck.invalidTarget')
    }

    const targetKind = isIpLiteral(url.hostname) ? 'ip' : 'domain'
    const tcpHost = stripIpv6Brackets(url.hostname)

    return {
      input: trimmed,
      requestUrl: url.toString(),
      requestHost: url.hostname,
      tcpHost,
      tcpPort: Number(url.port || (url.protocol === 'http:' ? 80 : 443)),
      displayHost: tcpHost,
      dnsLookupHost: targetKind === 'ip' ? '' : url.hostname,
      targetKind,
    }
  } catch {
    throw new Error('netCheck.invalidTarget')
  }
}
