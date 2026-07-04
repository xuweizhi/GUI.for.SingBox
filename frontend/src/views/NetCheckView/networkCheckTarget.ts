export interface ParsedNetworkCheckTarget {
  input: string
  requestUrl: string
  tcpHost: string
  tcpPort: number
  displayHost: string
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

    return {
      input: trimmed,
      requestUrl: url.toString(),
      tcpHost: url.hostname,
      tcpPort: Number(url.port || (url.protocol === 'http:' ? 80 : 443)),
      displayHost: url.hostname,
    }
  } catch {
    throw new Error('netCheck.invalidTarget')
  }
}
