import { RuleAction } from '@/enums/kernel'

import { isValidIPv4, isValidIPv6 } from './is'

export interface ParsedQuickRuleBucket {
  domain: string[]
  domain_suffix: string[]
  domain_keyword: string[]
  ip_cidr: string[]
  process_name: string[]
  process_path: string[]
}

export const EmptyQuickRules = (): App.QuickRuleLists => ({
  direct: [],
  proxy: [],
  block: [],
})

export const normalizeQuickRules = (raw?: Partial<App.QuickRuleLists>): App.QuickRuleLists => ({
  direct: Array.isArray(raw?.direct) ? raw.direct.map((item) => String(item).trim()).filter(Boolean) : [],
  proxy: Array.isArray(raw?.proxy) ? raw.proxy.map((item) => String(item).trim()).filter(Boolean) : [],
  block: Array.isArray(raw?.block) ? raw.block.map((item) => String(item).trim()).filter(Boolean) : [],
})

export const splitQuickRuleLines = (text: string): string[] =>
  [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('//')),
    ),
  ]

const parseCidrOrIp = (value: string): string | undefined => {
  const slash = value.indexOf('/')
  if (slash !== -1) {
    const ip = value.slice(0, slash)
    const prefixText = value.slice(slash + 1)
    if (!/^\d+$/.test(prefixText)) return undefined
    const prefix = Number(prefixText)
    if (isValidIPv4(ip) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
      return `${ip}/${prefix}`
    }
    if (isValidIPv6(ip) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128) {
      return `${ip}/${prefix}`
    }
    return undefined
  }
  if (isValidIPv4(value)) return `${value}/32`
  if (isValidIPv6(value)) return `${value}/128`
  return undefined
}

const pushUnique = (list: string[], value: string) => {
  if (value && !list.includes(value)) list.push(value)
}

export const parseQuickRuleEntries = (entries: string[]): ParsedQuickRuleBucket => {
  const bucket: ParsedQuickRuleBucket = {
    domain: [],
    domain_suffix: [],
    domain_keyword: [],
    ip_cidr: [],
    process_name: [],
    process_path: [],
  }

  for (const raw of entries) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    const lower = line.toLowerCase()
    if (lower.startsWith('full:') || lower.startsWith('domain:')) {
      const value = line.slice(line.indexOf(':') + 1).trim()
      pushUnique(bucket.domain, value)
      continue
    }
    if (lower.startsWith('suffix:') || lower.startsWith('domain_suffix:')) {
      const value = line.slice(line.indexOf(':') + 1).trim().replace(/^\./, '')
      pushUnique(bucket.domain_suffix, value)
      continue
    }
    if (lower.startsWith('keyword:') || lower.startsWith('domain_keyword:')) {
      const value = line.slice(line.indexOf(':') + 1).trim()
      pushUnique(bucket.domain_keyword, value)
      continue
    }
    if (lower.startsWith('ip:') || lower.startsWith('ip_cidr:')) {
      const value = line.slice(line.indexOf(':') + 1).trim()
      pushUnique(bucket.ip_cidr, parseCidrOrIp(value) || value)
      continue
    }
    if (lower.startsWith('process_path:')) {
      pushUnique(bucket.process_path, line.slice('process_path:'.length).trim())
      continue
    }
    if (lower.startsWith('process:') || lower.startsWith('process_name:')) {
      const value = line.slice(line.indexOf(':') + 1).trim()
      if (value.includes('/') || value.includes('\\')) pushUnique(bucket.process_path, value)
      else pushUnique(bucket.process_name, value)
      continue
    }

    const cidr = parseCidrOrIp(line)
    if (cidr) {
      pushUnique(bucket.ip_cidr, cidr)
      continue
    }

    if (line.includes('/') || line.includes('\\')) {
      pushUnique(bucket.process_path, line)
      continue
    }

    // Strip optional leading dot for suffix matching.
    pushUnique(bucket.domain_suffix, line.replace(/^\./, ''))
  }

  return bucket
}

const ROUTE_FIELDS: Array<keyof ParsedQuickRuleBucket> = [
  'domain',
  'domain_suffix',
  'domain_keyword',
  'ip_cidr',
  'process_name',
  'process_path',
]

const DNS_FIELDS: Array<keyof ParsedQuickRuleBucket> = [
  'domain',
  'domain_suffix',
  'domain_keyword',
]

export const compileQuickRouteRules = (
  quickRules: App.QuickRuleLists | undefined,
  targets: { direct?: string; proxy?: string; block?: string },
): Recordable[] => {
  if (!quickRules) return []
  const normalized = normalizeQuickRules(quickRules)
  const rules: Recordable[] = []

  // Priority: block -> direct -> proxy
  const specs: Array<{ entries: string[]; outbound?: string; action: RuleAction }> = [
    {
      entries: normalized.block,
      outbound: targets.block,
      action: targets.block ? RuleAction.Route : RuleAction.Reject,
    },
    { entries: normalized.direct, outbound: targets.direct, action: RuleAction.Route },
    { entries: normalized.proxy, outbound: targets.proxy, action: RuleAction.Route },
  ]

  for (const spec of specs) {
    if (!spec.entries.length) continue
    if (spec.action === RuleAction.Route && !spec.outbound) continue
    const parsed = parseQuickRuleEntries(spec.entries)
    // Each match field becomes its own rule because multiple fields in a single sing-box rule are ANDed.
    for (const field of ROUTE_FIELDS) {
      const values = parsed[field]
      if (!values.length) continue
      const rule: Recordable = {
        action: spec.action,
        [field]: values.length === 1 ? values[0] : values,
      }
      if (spec.action === RuleAction.Route) rule.outbound = spec.outbound
      else rule.method = 'default'
      rules.push(rule)
    }
  }

  return rules
}

export const compileQuickDnsRules = (
  quickRules: App.QuickRuleLists | undefined,
  servers: { local?: string; remote?: string; fakeip?: string },
): Recordable[] => {
  if (!quickRules) return []
  const normalized = normalizeQuickRules(quickRules)
  const rules: Recordable[] = []

  if (normalized.direct.length && servers.local) {
    const parsed = parseQuickRuleEntries(normalized.direct)
    for (const field of DNS_FIELDS) {
      const values = parsed[field]
      if (!values.length) continue
      rules.push({
        action: RuleAction.Route,
        [field]: values.length === 1 ? values[0] : values,
        server: servers.local,
      })
    }
  }

  if (normalized.proxy.length && (servers.fakeip || servers.remote)) {
    const parsed = parseQuickRuleEntries(normalized.proxy)
    for (const field of DNS_FIELDS) {
      const values = parsed[field]
      if (!values.length) continue
      const matcher = values.length === 1 ? values[0] : values
      if (servers.fakeip) {
        rules.push({
          action: RuleAction.Route,
          [field]: matcher,
          query_type: ['A', 'AAAA'],
          server: servers.fakeip,
        })
      }
      if (servers.remote && servers.remote !== servers.fakeip) {
        rules.push({
          action: RuleAction.Route,
          [field]: matcher,
          server: servers.remote,
        })
      }
    }
  }

  return rules
}

export const quickRulePayloadToEntry = (payload: Record<string, any>): string | undefined => {
  if (typeof payload.domain === 'string' && payload.domain.trim()) {
    return `full:${payload.domain.trim()}`
  }
  if (typeof payload.domain_suffix === 'string' && payload.domain_suffix.trim()) {
    return payload.domain_suffix.trim().replace(/^\./, '')
  }
  if (typeof payload.domain_keyword === 'string' && payload.domain_keyword.trim()) {
    return `keyword:${payload.domain_keyword.trim()}`
  }
  if (typeof payload.ip_cidr === 'string' && payload.ip_cidr.trim()) {
    return payload.ip_cidr.trim()
  }
  if (typeof payload.process_path === 'string' && payload.process_path.trim()) {
    return payload.process_path.trim()
  }
  if (typeof payload.process_name === 'string' && payload.process_name.trim()) {
    return `process:${payload.process_name.trim()}`
  }
  return undefined
}
