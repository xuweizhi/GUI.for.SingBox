import { DefaultOutboundIds } from '@/constant/outbound'
import {
  DefaultDnsServers,
  DefaultFakeIPDnsRule,
  DefaultRouteRule,
  DefaultRouteRuleset,
} from '@/constant/profile'
import { CommonServiceRulesetPresets } from '@/constant/profilePresets'
import {
  ClashMode,
  DnsServer,
  Inbound,
  Outbound,
  RuleAction,
  RuleActionReject,
  RulesetFormat,
  RulesetType,
  RuleType,
  Strategy,
} from '@/enums/kernel'

import { deepClone, sampleID } from './others'
import { getOutboundRole, getPrimaryProxyOutbound, setInitialOutboundTarget } from './outboundPolicy'

export type ManagedToggleKey =
  | 'tunSniff'
  | 'hijackDns'
  | 'clashModes'
  | 'blockAds'
  | 'blockQuic'
  | 'directPrivate'
  | 'directIcmp'

export interface ManagedToggleStates {
  tunSniff: boolean
  hijackDns: boolean
  clashModes: boolean
  blockAds: boolean
  blockQuic: boolean
  directPrivate: boolean
  directIcmp: boolean
}

const RULESET_URL_BY_TAG: Record<string, string> = {
  'Category-Ads':
    'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/category-ads-all.srs',
  'GeoSite-Private':
    'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/private.srs',
  'GeoIP-Private':
    'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/private.srs',
  'GeoSite-CN': 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/cn.srs',
  'GeoIP-CN': 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/cn.srs',
  'GeoLocation-!CN':
    'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-!cn.srs',
}

const findRoleOutbound = (outbounds: App.Outbound[], role: App.OutboundRole) =>
  outbounds.find((outbound) => getOutboundRole(outbound) === role)

const rulesetTagForPayload = (ruleSet: App.ProfileRuleSet[], id: string) =>
  ruleSet.find((item) => item.id === id)?.tag || id

export const detectManagedRuleKey = (
  rule: App.Rule,
  profile: Pick<App.Profile, 'inbounds' | 'outbounds' | 'route'>,
): App.ManagedRuleKey | undefined => {
  if (rule.managed_key) return rule.managed_key
  if (rule.type === RuleType.InsertionPoint) return undefined

  if (rule.type === RuleType.Inbound && rule.action === RuleAction.Sniff && !rule.invert) {
    const inbound = profile.inbounds.find((item) => item.id === rule.payload)
    if (inbound?.type === Inbound.Tun || rule.payload === 'tun-in') return 'tun-sniff'
  }
  if (
    rule.type === RuleType.Protocol &&
    !rule.invert &&
    rule.payload.toLowerCase() === 'dns' &&
    rule.action === RuleAction.HijackDNS
  ) {
    return 'hijack-dns'
  }
  if (rule.type === RuleType.ClashMode && !rule.invert && rule.action === RuleAction.Route) {
    if (rule.payload === ClashMode.Direct) return 'clash-direct'
    if (rule.payload === ClashMode.Global) return 'clash-global'
  }
  if (
    rule.type === RuleType.Network &&
    !rule.invert &&
    rule.payload.toLowerCase() === 'icmp' &&
    rule.action === RuleAction.Route
  ) {
    return 'icmp-direct'
  }
  if (rule.type === RuleType.Protocol && !rule.invert && rule.payload.toLowerCase() === 'quic') {
    if (rule.action === RuleAction.Reject) return 'quic-block'
    if (rule.action === RuleAction.Route) {
      const target = profile.outbounds.find((o) => o.id === rule.outbound)
      if (target && (getOutboundRole(target) === 'block' || target.type === Outbound.Block)) {
        return 'quic-block'
      }
      if (rule.outbound === Outbound.Block) return 'quic-block'
    }
  }
  if (rule.type === RuleType.RuleSet && !rule.invert && !rule.payload.includes(',')) {
    const tag = rulesetTagForPayload(profile.route.rule_set, rule.payload).toLowerCase()
    if (tag === 'category-ads' || tag.includes('category-ads')) return 'ads-block'
    if (tag === 'geosite-private') return 'private-geosite'
    if (tag === 'geoip-private') return 'private-geoip'
  }
  return undefined
}

export const isSystemManagedRule = (
  rule: App.Rule,
  profile: Pick<App.Profile, 'inbounds' | 'outbounds' | 'route'>,
): boolean => Boolean(detectManagedRuleKey(rule, profile))

export const ensureProfileRuleset = (
  ruleSets: App.ProfileRuleSet[],
  spec:
    | { kind: 'local'; id: string; tag: string; format: App.RuleSet['format'] }
    | {
        kind: 'remote'
        url: string
        tag: string
        format: App.RuleSet['format']
        downloadDetour?: string
      },
): App.ProfileRuleSet => {
  const existing =
    spec.kind === 'local'
      ? ruleSets.find((item) => item.type === RulesetType.Local && item.path === spec.id)
      : ruleSets.find((item) => item.type === RulesetType.Remote && item.url === spec.url)
  if (existing) return existing

  const usedTags = new Set(ruleSets.map((item) => item.tag))
  let tag = spec.tag
  let seq = 2
  while (usedTags.has(tag)) tag = `${spec.tag}-${seq++}`

  const created: App.ProfileRuleSet =
    spec.kind === 'local'
      ? {
          ...DefaultRouteRuleset(),
          type: RulesetType.Local,
          tag,
          format: spec.format,
          path: spec.id,
        }
      : {
          ...DefaultRouteRuleset(),
          type: RulesetType.Remote,
          tag,
          format: spec.format,
          url: spec.url,
          download_detour: spec.downloadDetour || '',
        }

  ruleSets.push(created)
  return created
}

const collectInlineRulesetTags = (node: unknown, tags: Set<string>) => {
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  const rs = record.rule_set
  if (typeof rs === 'string' && rs) tags.add(rs)
  else if (Array.isArray(rs)) {
    rs.forEach((item) => {
      if (typeof item === 'string' && item) tags.add(item)
    })
  }
  if (Array.isArray(record.rules)) {
    record.rules.forEach((child) => collectInlineRulesetTags(child, tags))
  }
}

export const pruneUnusedProfileRulesets = (
  profile: Pick<App.Profile, 'route' | 'dns'>,
): string[] => {
  const usedIds = new Set<string>()
  const usedTags = new Set<string>()
  const collect = (rules: Array<{ type: string; payload: string }>) => {
    rules.forEach((rule) => {
      if (rule.type === RuleType.RuleSet && rule.payload) {
        rule.payload.split(',').forEach((id) => id && usedIds.add(id))
      } else if (rule.type === RuleType.Inline && rule.payload) {
        try {
          collectInlineRulesetTags(JSON.parse(rule.payload), usedTags)
        } catch {
          // Ignore malformed inline JSON during pruning.
        }
      }
    })
  }
  collect(profile.route.rules)
  collect(profile.dns?.rules || [])

  const removed: string[] = []
  for (let i = profile.route.rule_set.length - 1; i >= 0; i--) {
    const rs = profile.route.rule_set[i]!
    if (!usedIds.has(rs.id) && !usedTags.has(rs.tag)) {
      profile.route.rule_set.splice(i, 1)
      removed.push(rs.tag)
    }
  }
  return removed
}

const ensureBuiltinRemoteRuleset = (profile: App.Profile, tag: string) => {
  const url =
    RULESET_URL_BY_TAG[tag] ||
    CommonServiceRulesetPresets.find((item) => item.tag === tag)?.url ||
    ''
  const direct = findRoleOutbound(profile.outbounds, 'direct')?.id || ''
  return ensureProfileRuleset(profile.route.rule_set, {
    kind: 'remote',
    url,
    tag,
    format: RulesetFormat.Binary,
    downloadDetour: direct,
  })
}

const findRuleByManagedKey = (profile: App.Profile, key: App.ManagedRuleKey) =>
  profile.route.rules.find((rule) => detectManagedRuleKey(rule, profile) === key)

export const getManagedToggleStates = (profile: App.Profile): ManagedToggleStates => {
  const isOn = (key: App.ManagedRuleKey) => Boolean(findRuleByManagedKey(profile, key)?.enable)
  return {
    tunSniff: isOn('tun-sniff'),
    hijackDns: isOn('hijack-dns'),
    clashModes: isOn('clash-direct') || isOn('clash-global'),
    blockAds: isOn('ads-block'),
    blockQuic: isOn('quic-block'),
    directPrivate: isOn('private-geosite') || isOn('private-geoip'),
    directIcmp: isOn('icmp-direct'),
  }
}

const PREAMBLE_ORDER: App.ManagedRuleKey[] = [
  'tun-sniff',
  'hijack-dns',
  'clash-direct',
  'clash-global',
]

const resolveDirectOutboundRef = (profile: App.Profile): string | undefined =>
  findRoleOutbound(profile.outbounds, 'direct')?.id ||
  profile.outbounds.find((o) => o.type === Outbound.Direct)?.id ||
  profile.native?.outbounds?.find((o) => o.type === Outbound.Direct)?.tag

const resolveBlockOutboundRef = (profile: App.Profile): string | undefined =>
  findRoleOutbound(profile.outbounds, 'block')?.id ||
  profile.outbounds.find((o) => o.type === Outbound.Block)?.id ||
  profile.native?.outbounds?.find((o) => o.type === Outbound.Block)?.tag

const resolveGlobalOutboundRef = (profile: App.Profile): string | undefined =>
  findRoleOutbound(profile.outbounds, 'global')?.id ||
  getPrimaryProxyOutbound(profile)?.id ||
  profile.outbounds[0]?.id

const insertRuleForManagedKey = (
  profile: App.Profile,
  rule: App.Rule,
  key: App.ManagedRuleKey,
) => {
  const preambleRank = PREAMBLE_ORDER.indexOf(key)
  if (preambleRank !== -1) {
    // Insert before the first existing rule whose preamble rank is strictly greater, or before InsertionPoint.
    let insertIdx = profile.route.rules.length
    for (let i = 0; i < profile.route.rules.length; i++) {
      const candidate = profile.route.rules[i]!
      if (candidate.type === RuleType.InsertionPoint) {
        insertIdx = i
        break
      }
      const candidateKey = detectManagedRuleKey(candidate, profile)
      const candidateRank = candidateKey ? PREAMBLE_ORDER.indexOf(candidateKey) : -1
      if (candidateRank === -1 || candidateRank > preambleRank) {
        insertIdx = i
        break
      }
    }
    profile.route.rules.splice(insertIdx, 0, rule)
    return
  }

  const insertionIdx = profile.route.rules.findIndex((item) => item.type === RuleType.InsertionPoint)
  if (insertionIdx === -1) {
    profile.route.rules.push(rule)
    return
  }
  profile.route.rules.splice(insertionIdx + 1, 0, rule)
}

export const setManagedToggle = (
  profile: App.Profile,
  toggle: ManagedToggleKey,
  enabled: boolean,
) => {
  const directId = resolveDirectOutboundRef(profile)
  const blockId = resolveBlockOutboundRef(profile)
  const globalId = resolveGlobalOutboundRef(profile)
  const tunId = profile.inbounds.find((item) => item.type === Inbound.Tun)?.id || 'tun-in'

  const makeBlockAction = (): Pick<App.Rule, 'action' | 'outbound'> =>
    blockId
      ? { action: RuleAction.Route, outbound: blockId }
      : { action: RuleAction.Reject, outbound: RuleActionReject.Default }

  const setSingle = (key: App.ManagedRuleKey, factory: () => App.Rule | undefined) => {
    const existing = findRuleByManagedKey(profile, key)
    if (existing) {
      existing.enable = enabled
      existing.managed_key = key
      return
    }
    if (!enabled) return
    const created = factory()
    if (!created) return
    insertRuleForManagedKey(profile, { ...created, managed_key: key, enable: true }, key)
  }

  switch (toggle) {
    case 'tunSniff':
      setSingle('tun-sniff', () => ({
        ...DefaultRouteRule(),
        type: RuleType.Inbound,
        payload: tunId,
        action: RuleAction.Sniff,
      }))
      break
    case 'hijackDns':
      setSingle('hijack-dns', () => ({
        ...DefaultRouteRule(),
        type: RuleType.Protocol,
        payload: 'dns',
        action: RuleAction.HijackDNS,
      }))
      break
    case 'clashModes':
      setSingle('clash-direct', () =>
        directId
          ? {
              ...DefaultRouteRule(),
              type: RuleType.ClashMode,
              payload: ClashMode.Direct,
              action: RuleAction.Route,
              outbound: directId,
            }
          : undefined,
      )
      setSingle('clash-global', () =>
        globalId
          ? {
              ...DefaultRouteRule(),
              type: RuleType.ClashMode,
              payload: ClashMode.Global,
              action: RuleAction.Route,
              outbound: globalId,
            }
          : undefined,
      )
      break
    case 'directIcmp':
      setSingle('icmp-direct', () =>
        directId
          ? {
              ...DefaultRouteRule(),
              type: RuleType.Network,
              payload: 'icmp',
              action: RuleAction.Route,
              outbound: directId,
            }
          : undefined,
      )
      break
    case 'blockQuic':
      setSingle('quic-block', () => ({
        ...DefaultRouteRule(),
        type: RuleType.Protocol,
        payload: 'quic',
        ...makeBlockAction(),
      }))
      break
    case 'blockAds':
      setSingle('ads-block', () => {
        const rs = ensureBuiltinRemoteRuleset(profile, 'Category-Ads')
        return {
          ...DefaultRouteRule(),
          type: RuleType.RuleSet,
          payload: rs.id,
          ...makeBlockAction(),
        }
      })
      break
    case 'directPrivate':
      setSingle('private-geosite', () => {
        if (!directId) return undefined
        const rs = ensureBuiltinRemoteRuleset(profile, 'GeoSite-Private')
        return {
          ...DefaultRouteRule(),
          type: RuleType.RuleSet,
          payload: rs.id,
          action: RuleAction.Route,
          outbound: directId,
        }
      })
      setSingle('private-geoip', () => {
        if (!directId) return undefined
        const rs = ensureBuiltinRemoteRuleset(profile, 'GeoIP-Private')
        return {
          ...DefaultRouteRule(),
          type: RuleType.RuleSet,
          payload: rs.id,
          action: RuleAction.Route,
          outbound: directId,
        }
      })
      break
  }
}

const isPresetGeoRule = (rule: App.Rule, ruleSet: App.ProfileRuleSet[]) => {
  if (rule.type !== RuleType.RuleSet || rule.invert || rule.payload.includes(',')) return false
  const tag = rulesetTagForPayload(ruleSet, rule.payload).toLowerCase()
  return tag === 'geosite-cn' || tag === 'geoip-cn' || tag === 'geolocation-!cn'
}

export const detectProfilePreset = (profile: App.Profile): App.ProfilePreset => {
  if (profile.preset) return profile.preset
  const tags = new Set(
    profile.route.rules
      .filter((r) => r.enable && r.type === RuleType.RuleSet)
      .map((r) => rulesetTagForPayload(profile.route.rule_set, r.payload).toLowerCase()),
  )
  const hasCn = tags.has('geosite-cn') || tags.has('geoip-cn')
  const hasNotCn = tags.has('geolocation-!cn')
  const fallback = findRoleOutbound(profile.outbounds, 'fallback')
  const direct = findRoleOutbound(profile.outbounds, 'direct')
  const finalIsDirect =
    profile.route.final === direct?.id ||
    (profile.route.final === fallback?.id && fallback?.outbounds[0]?.id === direct?.id)

  if (hasCn) return 'bypass-cn'
  if (hasNotCn && finalIsDirect) return 'proxy-list'
  if (!hasCn && !hasNotCn && !finalIsDirect) return 'global'
  return 'minimal'
}

/** Apply a routing preset while preserving user custom rules, quick_rules, and custom outbounds. */
export const applyProfilePreset = (profile: App.Profile, preset: App.ProfilePreset) => {
  profile.preset = preset
  const primary = getPrimaryProxyOutbound(profile)
  const direct = findRoleOutbound(profile.outbounds, 'direct')
  const fallback = findRoleOutbound(profile.outbounds, 'fallback')

  // Remove only the previous preset's CN / !CN geo rules; keep custom user rules intact.
  profile.route.rules = profile.route.rules.filter(
    (rule) => !isPresetGeoRule(rule, profile.route.rule_set),
  )

  const directId = resolveDirectOutboundRef(profile)
  const proxyId = primary?.id || profile.outbounds[0]?.id || DefaultOutboundIds.Select

  if (preset === 'bypass-cn') {
    if (directId) {
      const gsCn = ensureBuiltinRemoteRuleset(profile, 'GeoSite-CN')
      const giCn = ensureBuiltinRemoteRuleset(profile, 'GeoIP-CN')
      profile.route.rules.push(
        { ...DefaultRouteRule(), type: RuleType.RuleSet, payload: gsCn.id, outbound: directId },
        { ...DefaultRouteRule(), type: RuleType.RuleSet, payload: giCn.id, outbound: directId },
      )
    }
    const notCn = ensureBuiltinRemoteRuleset(profile, 'GeoLocation-!CN')
    profile.route.rules.push({
      ...DefaultRouteRule(),
      type: RuleType.RuleSet,
      payload: notCn.id,
      outbound: proxyId,
    })
    if (fallback && primary) {
      setInitialOutboundTarget(fallback, primary.id, primary.tag)
      profile.route.final = fallback.id
    } else {
      profile.route.final = proxyId
    }
  } else if (preset === 'proxy-list') {
    const notCn = ensureBuiltinRemoteRuleset(profile, 'GeoLocation-!CN')
    profile.route.rules.push({
      ...DefaultRouteRule(),
      type: RuleType.RuleSet,
      payload: notCn.id,
      outbound: proxyId,
    })
    if (fallback && direct) {
      setInitialOutboundTarget(fallback, direct.id, direct.tag)
      profile.route.final = fallback.id
    } else if (directId) {
      profile.route.final = directId
    }
  } else if (preset === 'global') {
    if (fallback && primary) {
      setInitialOutboundTarget(fallback, primary.id, primary.tag)
      profile.route.final = fallback.id
    } else {
      profile.route.final = proxyId
    }
  } else {
    // minimal: keep only system rules + private direct + user rules, final defaults to proxy
    if (fallback && primary) {
      setInitialOutboundTarget(fallback, primary.id, primary.tag)
      profile.route.final = fallback.id
    } else {
      profile.route.final = proxyId
    }
  }

  // Ensure DNS stays aligned if using a managed DNS preset.
  if (profile.dns.preset && profile.dns.preset !== 'custom') {
    applyDnsPreset(profile, profile.dns.preset)
  }
}

export const detectDnsPreset = (dns: App.Dns): App.DnsPreset => {
  if (dns.preset) return dns.preset
  const fakeIpEnabled = dns.rules.some(
    (rule) =>
      rule.enable &&
      rule.type === RuleType.Inline &&
      (rule.payload.includes('__is_fake_ip') ||
        dns.servers.find((s) => s.id === rule.server)?.type === DnsServer.FakeIP),
  )
  if (fakeIpEnabled) return 'fakeip'
  return 'custom'
}

export const applyDnsPreset = (profile: App.Profile, preset: App.DnsPreset) => {
  profile.dns.preset = preset
  if (preset === 'custom') return

  const primaryProxyId =
    getPrimaryProxyOutbound(profile)?.id || profile.outbounds[0]?.id || DefaultOutboundIds.Select
  const ensureServer = (id: string, fallbackFactory: () => App.DnsServerConfig) => {
    let server = profile.dns.servers.find((item) => item.id === id || item.tag === id)
    if (!server) {
      server = fallbackFactory()
      profile.dns.servers.push(server)
    }
    return server
  }
  const defaults = DefaultDnsServers()
  const byDefaultId = (id: string) => deepClone(defaults.find((server) => server.id === id)!)

  const localResolver = ensureServer('Local-DNS-Resolver', () =>
    byDefaultId('Local-DNS-Resolver'),
  )
  const localDns = ensureServer('Local-DNS', () => byDefaultId('Local-DNS'))
  localDns.domain_resolver = localResolver.id
  const remoteResolver = ensureServer('Remote-DNS-Resolver', () =>
    byDefaultId('Remote-DNS-Resolver'),
  )
  const remoteDns = ensureServer('Remote-DNS', () => byDefaultId('Remote-DNS'))
  remoteDns.detour = primaryProxyId
  remoteDns.domain_resolver = remoteResolver.id
  remoteResolver.detour = primaryProxyId

  const fakeIp = ensureServer('Fake-IP', () => byDefaultId('Fake-IP'))

  const routePreset = profile.preset || 'bypass-cn'
  const skipGeoDns = routePreset === 'global' || routePreset === 'minimal'
  const isProxyList = routePreset === 'proxy-list'

  const rules: App.DnsRule[] = [
    {
      id: sampleID(),
      type: RuleType.ClashMode,
      enable: true,
      payload: ClashMode.Direct,
      action: RuleAction.Route,
      server: localDns.id,
      invert: false,
      strategy: Strategy.Default,
      disable_cache: false,
      client_subnet: '',
    },
    {
      id: sampleID(),
      type: RuleType.ClashMode,
      enable: true,
      payload: ClashMode.Global,
      action: RuleAction.Route,
      server: remoteDns.id,
      invert: false,
      strategy: Strategy.Default,
      disable_cache: false,
      client_subnet: '',
    },
    {
      id: RuleType.InsertionPoint,
      type: RuleType.InsertionPoint,
      enable: true,
      payload: '',
      action: RuleAction.Route,
      server: '',
      invert: false,
      strategy: Strategy.Default,
      disable_cache: false,
      client_subnet: '',
    },
  ]

  if (!skipGeoDns && !isProxyList) {
    const gsCn = ensureBuiltinRemoteRuleset(profile, 'GeoSite-CN')
    rules.push({
      id: sampleID(),
      type: RuleType.RuleSet,
      enable: true,
      payload: gsCn.id,
      action: RuleAction.Route,
      server: localDns.id,
      invert: false,
      strategy: Strategy.Default,
      disable_cache: false,
      client_subnet: '',
    })
  }

  rules.push({
    id: sampleID(),
    type: RuleType.Inline,
    enable: preset === 'fakeip',
    payload: JSON.stringify(DefaultFakeIPDnsRule(), null, 2),
    action: RuleAction.Route,
    server: fakeIp.id,
    invert: false,
    strategy: Strategy.Default,
    disable_cache: false,
    client_subnet: '',
  })

  if (!skipGeoDns) {
    const notCn = ensureBuiltinRemoteRuleset(profile, 'GeoLocation-!CN')
    rules.push({
      id: sampleID(),
      type: RuleType.RuleSet,
      enable: true,
      payload: notCn.id,
      action: RuleAction.Route,
      server: remoteDns.id,
      invert: false,
      strategy: Strategy.Default,
      disable_cache: false,
      client_subnet: '',
    })
  }

  profile.dns.rules = rules
  profile.dns.final = isProxyList ? localDns.id : remoteDns.id
  if (preset === 'fakeip') {
    profile.experimental.cache_file.store_fakeip = true
  }
}
