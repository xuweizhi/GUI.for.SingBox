import { SystemDnsResolverTag } from '@/constant/kernel'
import * as Defaults from '@/constant/profile'
import {
  Inbound,
  Outbound,
  RuleAction,
  RuleActionReject,
  RulesetType,
  RuleType as RouteRuleType,
  DnsServer,
} from '@/enums/kernel'
import {
  useNodeGroupsStore,
  useProfilesStore,
  useRulesetsStore,
  useSubscribesStore,
} from '@/stores'

import { resolveNodeGroup } from './nodeGroup'
import { createTextMatcher, deepAssign, deepClone, sampleID } from './others'
import { getOutboundRole, getPrimaryProxyOutbound } from './outboundPolicy'

const supportedRuleTypes = [
  RouteRuleType.Inbound,
  RouteRuleType.Network,
  RouteRuleType.Protocol,
  RouteRuleType.Domain,
  RouteRuleType.DomainSuffix,
  RouteRuleType.DomainKeyword,
  RouteRuleType.DomainRegex,
  RouteRuleType.SourceIPCidr,
  RouteRuleType.IPCidr,
  RouteRuleType.SourcePort,
  RouteRuleType.SourcePortRange,
  RouteRuleType.Port,
  RouteRuleType.PortRange,
  RouteRuleType.ProcessName,
  RouteRuleType.ProcessPath,
  RouteRuleType.ProcessPathRegex,
  RouteRuleType.RuleSet,
  RouteRuleType.IpIsPrivate,
  RouteRuleType.IpAcceptAny,
  RouteRuleType.ClashMode,
]

// Fields edited separately from the matching criteria of an inline rule.
const routeOptionFields = [
  'override_address',
  'override_port',
  'network_strategy',
  'fallback_delay',
  'udp_disable_domain_unmapping',
  'udp_connect',
  'udp_timeout',
  'tls_fragment',
  'tls_fragment_fallback_delay',
  'tls_record_fragment',
  'tls_spoof',
  'tls_spoof_method',
]
const dnsOptionFields = [
  'strategy',
  'rewrite_ttl',
  'timeout',
  'disable_optimistic_cache',
  'remove_client_subnet',
]
const predefinedFields = ['rcode', 'answer', 'ns', 'extra']
const routeFields: Record<string, string[]> = {
  route: ['outbound'],
  reject: ['method'],
  sniff: ['sniffer'],
  resolve: ['strategy', 'server'],
  'route-options': routeOptionFields,
}
const dnsFields: Record<string, string[]> = {
  route: ['server', 'strategy', 'disable_cache', 'client_subnet'],
  reject: ['method'],
  'route-options': [...dnsOptionFields, 'disable_cache', 'client_subnet'],
  predefined: predefinedFields,
}
const actionJson = (raw: Recordable, fields: string[]) =>
  JSON.stringify(
    Object.fromEntries(fields.filter((key) => key in raw).map((key) => [key, raw[key]])),
    null,
    2,
  )
const matchJson = (raw: Recordable, fields: string[]) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(raw).filter(
        ([key]) => key !== 'action' && key !== 'invert' && !fields.includes(key),
      ),
    ),
    null,
    2,
  )

// A simple form rule is safe only when it can represent every native field.
const simpleRuleType = (raw: Recordable, dns: boolean) => {
  const hits = supportedRuleTypes.filter((key) => key in raw)
  if (hits.length !== 1) return RouteRuleType.Inline
  const type = hits[0]!
  const action = raw.action || RuleAction.Route
  const fields = dns ? dnsFields : routeFields
  const modeled = new Set(['action', 'invert', type, ...(fields[action] || [])])
  if (Object.keys(raw).some((key) => !modeled.has(key))) return RouteRuleType.Inline
  const values = Array.isArray(raw[type]) ? raw[type] : [raw[type]]
  if (type === RouteRuleType.Inbound && values.length !== 1) return RouteRuleType.Inline
  if (values.some((value: unknown) => typeof value === 'string' && value.includes(',')))
    return RouteRuleType.Inline
  return type
}

const buildTagIdMapping = (prefix: string, arr?: Recordable[]): Recordable<string> => {
  if (!arr) return {}
  return arr.reduce((p, c, i) => ((p[c.tag] = prefix + i), p), {})
}

const asList = (value: string | string[]) => (Array.isArray(value) ? value : [value])

const hasUnmodeledTargets = (config: Recordable, profile: App.Profile) => {
  const outboundTags = new Set(
    [
      ...profile.outbounds,
      ...(profile.native?.outbounds || []),
      ...(profile.native?.endpoints || []),
    ].map((entry) => entry.tag),
  )
  const dnsTags = new Set([
    SystemDnsResolverTag,
    ...profile.dns.servers.map((entry) => entry.tag),
    ...(profile.native?.dnsServers || [])
      .filter((entry) => !entry._gui_id)
      .map((entry) => entry.tag),
  ])
  const resolver = config.route?.default_domain_resolver
  const outboundRefs = [
    config.route?.final,
    config.experimental?.clash_api?.external_ui_download_detour,
    ...(config.route?.rules || []).map((rule: Recordable) => rule.outbound),
    ...(config.route?.rule_set || []).map((rule: Recordable) => rule.download_detour),
  ]
  const dnsRefs = [
    config.dns?.final,
    typeof resolver === 'string' ? resolver : resolver?.server,
    ...(config.dns?.rules || []).map((rule: Recordable) => rule.server),
    ...(config.route?.rules || []).map((rule: Recordable) => rule.server),
  ]
  return (
    outboundRefs.some((tag) => tag && !outboundTags.has(tag)) ||
    dnsRefs.some((tag) => tag && !dnsTags.has(tag))
  )
}

type RestoreProfileOptions = {
  profile?: App.Profile
  subscriptionIds?: string[]
  baseline?: Recordable
}

export const restoreProfile = (
  config: Recordable,
  name = sampleID(),
  options: RestoreProfileOptions = {},
): App.Profile => {
  const template = useProfilesStore().getProfileTemplate()

  const { profile, subscriptionIds, baseline } = options
  // A source/chain can only be reused when every generated dependency still matches.
  // Otherwise restore the edited graph as native entries, retaining the actual dial path.
  const preserveSources =
    !!profile &&
    !!baseline &&
    !hasUnmodeledTargets(config, profile) &&
    ['outbounds', 'endpoints'].every(
      (key) => JSON.stringify(config[key] || []) === JSON.stringify(baseline[key] || []),
    ) &&
    JSON.stringify(config.dns?.servers || []) === JSON.stringify(baseline.dns?.servers || [])
  const nativeGraph = !!baseline && !preserveSources
  const rawNodes = [...(config.outbounds || []), ...(config.endpoints || [])]
  const leafNodes = rawNodes.filter(
    (entry) => ![Outbound.Selector, Outbound.Urltest].includes(entry.type),
  )

  const InboundsIds = buildTagIdMapping('in-', config.inbounds)
  if (profile) {
    profile.inbounds.forEach((entry) => {
      if (entry.tag) InboundsIds[entry.tag] = entry.id
    })
  }
  const OutboundsIds = buildTagIdMapping('out-', rawNodes)
  leafNodes.forEach((entry) => {
    OutboundsIds[entry.tag] = entry.tag
  })
  if (preserveSources)
    profile!.outbounds.forEach((entry) => {
      OutboundsIds[entry.tag] = entry.id
    })
  const RouteRuleSetIds = buildTagIdMapping('ruleset-', config.route?.rule_set)
  if (profile) {
    profile.route.rule_set.forEach((entry) => {
      if (entry.tag) RouteRuleSetIds[entry.tag] = entry.id
    })
  }
  const DnsServersIds = buildTagIdMapping('dns-', config.dns?.servers)
  for (const entry of config.dns?.servers || []) {
    if (!entry.type || (preserveSources && entry.tag === SystemDnsResolverTag))
      DnsServersIds[entry.tag] = entry.tag
  }
  if (preserveSources)
    profile!.dns.servers.forEach((entry) => {
      DnsServersIds[entry.tag] = entry.id
    })
  const restoredOutbounds = preserveSources
    ? deepClone(profile!.outbounds)
    : restoreOutbounds(
        rawNodes,
        OutboundsIds,
        nativeGraph ? [] : profile?.outbounds || [],
        nativeGraph ? [] : subscriptionIds || [],
      )
  if (nativeGraph && profile) {
    for (const group of restoredOutbounds) {
      const original = profile.outbounds.find((entry) => entry.tag === group.tag)
      if (original) group.role = getOutboundRole(original)
    }
  }
  const originalPrimaryTag = profile?.outbounds.find(
    (outbound) => outbound.id === profile.primary_proxy_outbound,
  )?.tag
  const restoredPrimary =
    restoredOutbounds.find((outbound) => outbound.tag === originalPrimaryTag) ||
    getPrimaryProxyOutbound({ outbounds: restoredOutbounds })

  const rawPreserveRouteRules =
    preserveSources &&
    JSON.stringify(config.route?.rules || []) === JSON.stringify(baseline!.route?.rules || []) &&
    JSON.stringify(config.route?.rule_set || []) === JSON.stringify(baseline!.route?.rule_set || [])
  const rawPreserveDnsRules =
    preserveSources &&
    JSON.stringify(config.dns?.rules || []) === JSON.stringify(baseline!.dns?.rules || [])
  const hasQuickRules = Boolean(
    profile?.route.quick_rules &&
      (profile.route.quick_rules.direct.length ||
        profile.route.quick_rules.proxy.length ||
        profile.route.quick_rules.block.length),
  )
  // Keep quick_rules intact only when both route and DNS rules stayed untouched;
  // otherwise restore both from config so compiled quick rules are neither dropped nor duplicated.
  const preserveQuickRules = hasQuickRules && rawPreserveRouteRules && rawPreserveDnsRules
  const preserveRouteRules = hasQuickRules ? preserveQuickRules : rawPreserveRouteRules
  const preserveDnsRules = hasQuickRules ? preserveQuickRules : rawPreserveDnsRules

  const restoredInbounds = restoreInbounds(config.inbounds || [], InboundsIds)
  if (profile) {
    const activeTags = new Set(restoredInbounds.map((entry) => entry.tag))
    for (const originalInbound of profile.inbounds) {
      if (!originalInbound.enable && !activeTags.has(originalInbound.tag)) {
        restoredInbounds.push(deepClone(originalInbound))
      }
    }
  }

  return {
    id: profile?.id || sampleID(),
    name,
    ...(preserveRouteRules && profile?.preset ? { preset: profile.preset } : {}),
    native: preserveSources
      ? profile!.native
        ? deepClone(profile!.native)
        : undefined
      : {
          outbounds: deepClone(
            (config.outbounds || []).filter(
              (entry: Recordable) =>
                ![Outbound.Selector, Outbound.Urltest].includes(entry.type) &&
                (!profile ||
                  nativeGraph ||
                  restoredOutbounds.some((group) =>
                    group.outbounds.some(
                      (member) => member.type === 'Native' && member.id === entry.tag,
                    ),
                  )),
            ),
          ),
          endpoints: deepClone(
            (config.endpoints || []).filter(
              (entry: Recordable) =>
                !profile ||
                nativeGraph ||
                restoredOutbounds.some((group) =>
                  group.outbounds.some(
                    (member) => member.type === 'Native' && member.id === entry.tag,
                  ),
                ),
            ),
          ),
          dnsServers: (config.dns?.servers || []).map((server: Recordable) => ({
            ...deepClone(server),
            ...(server.type ? { _gui_id: DnsServersIds[server.tag] } : {}),
          })),
        },
    primary_proxy_outbound: restoredPrimary?.id,
    log: deepAssign(Defaults.DefaultLog(), config.log),
    experimental: restoreExperimental(config.experimental, OutboundsIds),
    inbounds: restoredInbounds,
    outbounds: restoredOutbounds,
    route: {
      rule_set: preserveRouteRules
        ? deepClone(profile!.route.rule_set)
        : restoreRouteRuleset(config.route?.rule_set || [], RouteRuleSetIds, OutboundsIds),
      rules: preserveRouteRules
        ? deepClone(profile!.route.rules)
        : restoreRouteRules(
            config.route?.rules || [],
            InboundsIds,
            OutboundsIds,
            RouteRuleSetIds,
            DnsServersIds,
          ),
      ...(preserveQuickRules && profile?.route.quick_rules
        ? { quick_rules: deepClone(profile.route.quick_rules) }
        : {}),
      auto_detect_interface:
        config.route?.auto_detect_interface ?? template.route.auto_detect_interface,
      find_process: config.route?.find_process ?? template.route.find_process,
      default_interface: config.route?.default_interface ?? template.route.default_interface,
      final: OutboundsIds[config.route?.final] ?? template.route.final,
      default_domain_resolver: {
        ...(typeof config.route?.default_domain_resolver === 'object'
          ? config.route.default_domain_resolver
          : {}),
        server:
          DnsServersIds[
            typeof config.route?.default_domain_resolver === 'string'
              ? config.route.default_domain_resolver
              : config.route?.default_domain_resolver?.server
          ] ?? template.route.default_domain_resolver.server,
        client_subnet:
          config.route?.default_domain_resolver?.client_subnet ??
          template.route.default_domain_resolver.client_subnet,
      },
    },
    dns: {
      ...(preserveDnsRules && profile?.dns.preset
        ? { preset: profile.dns.preset }
        : profile?.dns.preset
          ? { preset: 'custom' as const }
          : {}),
      disable_cache: config.dns?.disable_cache ?? template.dns.disable_cache,
      disable_expire: config.dns?.disable_expire ?? template.dns.disable_expire,
      independent_cache: config.dns?.independent_cache ?? template.dns.independent_cache,
      final: DnsServersIds[config.dns?.final] ?? template.dns.final,
      strategy: config.dns?.strategy ?? template.dns.strategy,
      client_subnet: config.dns?.client_subnet ?? template.dns.client_subnet,
      servers: preserveSources
        ? deepClone(profile!.dns.servers)
        : restoreDnsServers(config.dns?.servers || [], DnsServersIds, OutboundsIds),
      rules: preserveDnsRules
        ? deepClone(profile!.dns.rules)
        : restoreDnsRules(config.dns?.rules || [], InboundsIds, RouteRuleSetIds, DnsServersIds),
    },
    mixin: profile?.mixin || Defaults.DefaultMixin(),
    script: profile?.script || Defaults.DefaultScript(),
  }
}

const restoreExperimental = (raw: Recordable, OutboundsIds: Recordable): App.Experimental => {
  const template = Defaults.DefaultExperimental()
  const experimental = deepAssign(template, raw)
  if (raw?.cache_file?.store_rdrc !== undefined && raw.cache_file.store_dns === undefined)
    experimental.cache_file.store_dns = raw.cache_file.store_rdrc
  delete experimental.cache_file.store_rdrc
  delete experimental.cache_file.rdrc_timeout
  experimental.clash_api.external_ui_download_detour =
    OutboundsIds[raw?.clash_api?.external_ui_download_detour] || ''
  return experimental
}

const restoreInbounds = (inbounds: Recordable[], InboundsIds: Recordable): App.Inbound[] => {
  return inbounds.flatMap((raw) => {
    if (
      ![Inbound.Mixed, Inbound.Http, Inbound.Socks, Inbound.Tun, Inbound.Direct].includes(raw.type)
    ) {
      return []
    }
    const inbound: App.Inbound = {
      id: InboundsIds[raw.tag],
      tag: raw.tag,
      type: raw.type,
      enable: true,
    }
    if (raw.type === Inbound.Tun) {
      const template = Defaults.DefaultInboundTun()
      inbound.tun = {
        interface_name: raw.interface_name ?? template.interface_name,
        address: raw.address == null ? template.address : asList(raw.address),
        mtu: raw.mtu ?? template.mtu,
        auto_route: raw.auto_route ?? template.auto_route,
        strict_route: raw.strict_route ?? template.strict_route,
        route_address:
          raw.route_address == null ? template.route_address : asList(raw.route_address),
        route_exclude_address:
          raw.route_exclude_address == null
            ? template.route_exclude_address
            : asList(raw.route_exclude_address),
        endpoint_independent_nat: raw.endpoint_independent_nat ?? template.endpoint_independent_nat,
        stack: raw.stack ?? template.stack,
      }
    }
    if (raw.type === Inbound.Direct) {
      const template = Defaults.DefaultInboundDirect()
      inbound.direct = {
        listen: {
          listen: raw.listen ?? template.listen.listen,
          listen_port: raw.listen_port ?? template.listen.listen_port,
          tcp_fast_open: raw.tcp_fast_open ?? template.listen.tcp_fast_open,
          tcp_multi_path: raw.tcp_multi_path ?? template.listen.tcp_multi_path,
          udp_fragment: raw.udp_fragment ?? template.listen.udp_fragment,
        },
        network: raw.network ?? template.network,
      }
    }
    if ([Inbound.Mixed, Inbound.Http, Inbound.Socks].includes(raw.type)) {
      const template = Defaults.DefaultInboundMixed()
      inbound[raw.type as Exclude<Inbound, Inbound.Tun | Inbound.Direct>] = {
        listen: {
          listen: raw.listen ?? template.listen.listen,
          listen_port: raw.listen_port ?? template.listen.listen_port,
          tcp_fast_open: raw.tcp_fast_open ?? template.listen.tcp_fast_open,
          tcp_multi_path: raw.tcp_multi_path ?? template.listen.tcp_multi_path,
          udp_fragment: raw.udp_fragment ?? template.listen.udp_fragment,
        },
        users:
          raw.users?.map((user: any) => user.username + ':' + (user.password ?? '')) ??
          template.users,
      }
    }
    return inbound
  })
}

const restoreOutbounds = (
  outbounds: Recordable[],
  OutboundsIds: Recordable,
  originalOutbounds: App.Outbound[],
  subscriptionIds: string[],
): App.Outbound[] => {
  const subscribesStore = useSubscribesStore()
  const nodeGroupsStore = useNodeGroupsStore()

  const subscriptionCache = new Map<string, App.Subscription>()
  const proxyToSubMap = new Map<string, { sub: string; id: string }>()
  const originalOutboundMap = new Map<string, App.Outbound>()

  const groupTags = new Set(
    outbounds
      .filter((o: Recordable) => [Outbound.Selector, Outbound.Urltest].includes(o.type))
      .map((o: Recordable) => o.tag),
  )
  const leafTags = new Set(
    outbounds
      .filter((outbound) => ![Outbound.Selector, Outbound.Urltest].includes(outbound.type))
      .map((outbound) => outbound.tag),
  )

  subscriptionIds.forEach((id) => {
    const sub = subscribesStore.getSubscribeById(id)
    if (sub) {
      subscriptionCache.set(id, sub)
      sub.proxies.forEach((proxy) => {
        const candidates = [
          proxy.tag,
          `${proxy.tag} [${sub.name}]`,
          ...[...leafTags].filter((tag) => tag.startsWith(`${proxy.tag} [${sub.name} `)),
        ]
        const runtimeTag = candidates.find((tag) => leafTags.has(tag) && !proxyToSubMap.has(tag))
        if (runtimeTag) proxyToSubMap.set(runtimeTag, { sub: id, id: proxy.id })
      })
    }
  })

  originalOutbounds.forEach((outbound) => {
    originalOutboundMap.set(outbound.tag, outbound)
  })

  return outbounds.flatMap((raw) => {
    if (![Outbound.Selector, Outbound.Urltest].includes(raw.type)) {
      return []
    }
    const outbound = Defaults.DefaultOutbound()
    outbound.id = OutboundsIds[raw.tag]
    outbound.tag = raw.tag
    outbound.type = raw.type
    const native = { ...raw }
    for (const field of [
      'type',
      'tag',
      'outbounds',
      'default',
      'url',
      'interval',
      'tolerance',
      'interrupt_exist_connections',
    ])
      delete native[field]
    if (Object.keys(native).length) outbound.native = native

    let newOutbounds: App.Proxy[] = []

    raw.outbounds?.forEach((tag: string) => {
      const isBuiltIn = [Outbound.Direct, Outbound.Block].includes(tag as Outbound)
      if (isBuiltIn) {
        newOutbounds.push({ id: tag, type: 'Built-in', tag })
      } else if (groupTags.has(tag)) {
        const id = OutboundsIds[tag]
        if (id) {
          newOutbounds.push({ id, type: 'Built-in', tag })
        }
      } else {
        const proxy = proxyToSubMap.get(tag)
        if (proxy) {
          newOutbounds.push({ id: proxy.id, type: proxy.sub, tag })
        } else if (leafTags.has(tag)) {
          newOutbounds.push({ id: tag, type: 'Native', tag })
        }
      }
    })

    const originalGroup = originalOutboundMap.get(outbound.tag)
    if (originalGroup) {
      outbound.role = getOutboundRole(originalGroup)
      outbound.icon = originalGroup.icon
      outbound.hidden = originalGroup.hidden
      outbound.include = originalGroup.include
      outbound.exclude = originalGroup.exclude
      outbound.source_node_group = originalGroup.source_node_group
      if (originalGroup.source_node_group_role)
        outbound.source_node_group_role = originalGroup.source_node_group_role
      if (originalGroup.pre_proxy_override) outbound.pre_proxy_override = true

      const currentNonBuiltInIds = new Set(
        newOutbounds.filter((v) => v.type !== 'Built-in').map((v) => v.id),
      )
      const isTagMatching = createTextMatcher(originalGroup.include, originalGroup.exclude)

      originalGroup.outbounds
        .filter((member) => member.type === 'NodeGroup')
        .forEach((member) => {
          const group = nodeGroupsStore.getNodeGroupById(member.id)
          if (!group) return
          const resolvedIds = resolveNodeGroup(group, subscribesStore.subscribes)
            .nodes.filter((node) => isTagMatching(node.proxy.tag))
            .map((node) => node.proxy.id)
          const isSafelyRepresented =
            resolvedIds.length > 0 && resolvedIds.every((id) => currentNonBuiltInIds.has(id))
          if (!isSafelyRepresented) return

          const idSet = new Set(resolvedIds)
          newOutbounds = newOutbounds.filter(
            (candidate) => candidate.type === 'Built-in' || !idSet.has(candidate.id),
          )
          newOutbounds.push({ id: group.id, type: 'NodeGroup', tag: group.name })
          resolvedIds.forEach((id) => currentNonBuiltInIds.delete(id))
        })

      subscriptionIds.forEach((id) => {
        const sub = subscriptionCache.get(id)
        if (sub) {
          const matchedProxies = sub.proxies.filter((proxy) => isTagMatching(proxy.tag))

          const isAllMatched =
            matchedProxies.length > 0 &&
            matchedProxies.every((proxy) => currentNonBuiltInIds.has(proxy.id))

          if (isAllMatched) {
            const matchedIds = new Set(matchedProxies.map((p) => p.id))
            newOutbounds = newOutbounds.filter(
              (v) => v.type === 'Built-in' || !matchedIds.has(v.id),
            )
            newOutbounds.push({ id: sub.id, type: 'Subscription', tag: sub.name })

            matchedIds.forEach((matchedId) => currentNonBuiltInIds.delete(matchedId))
          }
        }
      })
    }

    if (raw.default) {
      const index = newOutbounds.findIndex((member) => member.tag === raw.default)
      if (index > 0) newOutbounds.unshift(...newOutbounds.splice(index, 1))
    }
    outbound.outbounds = newOutbounds

    if ('interrupt_exist_connections' in raw) {
      outbound.interrupt_exist_connections = raw.interrupt_exist_connections
    }
    if (Outbound.Urltest === raw.type) {
      if ('url' in raw) {
        outbound.url = raw.url
      }
      if ('interval' in raw) {
        outbound.interval = raw.interval
      }
      if ('tolerance' in raw) {
        outbound.tolerance = raw.tolerance
      }
    }
    return outbound
  })
}

const restoreRouteRuleset = (
  rulesets: Recordable[],
  RouteRuleSetIds: Recordable,
  OutboundsIds: Recordable,
): App.ProfileRuleSet[] => {
  const rulesetsStore = useRulesetsStore()
  return rulesets.flatMap((raw) => {
    const ruleset = Defaults.DefaultRouteRuleset()
    ruleset.id = RouteRuleSetIds[raw.tag]
    ruleset.type = raw.type
    ruleset.tag = raw.tag

    if (raw.type === RulesetType.Inline) {
      if ('rules' in raw) {
        ruleset.rules = JSON.stringify(raw.rules, null, 2)
      }
    } else if (raw.type === RulesetType.Local) {
      if ('path' in raw) {
        const r = rulesetsStore.rulesets.find((v) => v.path === raw.path.replace('../', 'data/'))
        if (r) {
          ruleset.path = r.id
        } else {
          ruleset.path = raw.path
          ruleset.native_path = raw.path
        }
      }
      if ('format' in raw) {
        ruleset.format = raw.format
      }
    } else if (raw.type === RulesetType.Remote) {
      if ('format' in raw) {
        ruleset.format = raw.format
      }
      if ('url' in raw) {
        ruleset.url = raw.url
      }
      if ('download_detour' in raw) {
        ruleset.download_detour = OutboundsIds[raw.download_detour]
      }
      if ('update_interval' in raw) {
        ruleset.update_interval = raw.update_interval
      }
    }
    return ruleset
  })
}

const restoreRouteRules = (
  rules: Recordable[],
  InboundsIds: Recordable,
  OutboundsIds: Recordable,
  RouteRuleSetIds: Recordable,
  DnsServersIds: Recordable,
): App.Rule[] => {
  return rules.flatMap((raw, i) => {
    const rule = Defaults.DefaultRouteRule()

    rule.id = 'rule-' + i
    rule.action = raw.action || RuleAction.Route

    rule.type = simpleRuleType(raw, false)

    if (rule.type === RouteRuleType.Inline) {
      rule.payload = matchJson(raw, routeFields[rule.action] || [])
    } else if (rule.type === RouteRuleType.Inbound) {
      rule.payload = InboundsIds[raw[rule.type]]
    } else if (rule.type === RouteRuleType.RuleSet) {
      const rs = Array.isArray(raw[rule.type]) ? raw[rule.type] : [raw[rule.type]]
      rule.payload = rs.map((tag: string) => RouteRuleSetIds[tag]).join(',')
    } else {
      rule.payload = Array.isArray(raw[rule.type])
        ? raw[rule.type].join(',')
        : String(raw[rule.type])
    }

    if (RuleAction.Route === rule.action) {
      rule.outbound = OutboundsIds[raw.outbound]
    } else if (RuleAction.Reject === rule.action) {
      rule.outbound = 'method' in raw && raw.method ? raw.method : RuleActionReject.Default
    } else if (RuleAction.RouteOptions === rule.action) {
      rule.outbound = actionJson(raw, routeOptionFields)
    } else if (RuleAction.Sniff === rule.action) {
      if ('sniffer' in raw) {
        rule.sniffer = Array.isArray(raw.sniffer) ? raw.sniffer : [raw.sniffer]
      }
    } else if (RuleAction.Resolve === rule.action) {
      if ('strategy' in raw) {
        rule.strategy = raw.strategy
      }
      if ('server' in raw) {
        rule.server = DnsServersIds[raw.server]
      }
    }
    if ('invert' in raw) {
      rule.invert = raw.invert
    }
    return rule
  })
}

const restoreDnsServers = (
  servers: Recordable[],
  DnsServersIds: Recordable,
  OutboundsIds: Recordable,
): App.DnsServerConfig[] => {
  return servers.flatMap((raw) => {
    if (!raw.type) return []
    const server = Defaults.DefaultDnsServer()
    server.id = DnsServersIds[raw.tag]
    server.tag = raw.tag
    server.type = raw.type
    if (
      [
        DnsServer.Local,
        DnsServer.Tcp,
        DnsServer.Udp,
        DnsServer.Tls,
        DnsServer.Quic,
        DnsServer.Https,
        DnsServer.H3,
        DnsServer.Dhcp,
      ].includes(raw.type)
    ) {
      if (raw.type === DnsServer.Dhcp && 'interface' in raw) server.interface = raw.interface
      if ('detour' in raw) {
        server.detour = OutboundsIds[raw.detour]
      }
      if ('domain_resolver' in raw) {
        server.domain_resolver =
          DnsServersIds[
            typeof raw.domain_resolver === 'string'
              ? raw.domain_resolver
              : raw.domain_resolver?.server
          ]
      }
      if (
        [
          DnsServer.Tcp,
          DnsServer.Udp,
          DnsServer.Tls,
          DnsServer.Quic,
          DnsServer.Https,
          DnsServer.H3,
        ].includes(raw.type)
      ) {
        if ('server' in raw) {
          server.server = raw.server
        }
        if ('server_port' in raw) {
          server.server_port = raw.server_port
        }
        if ([DnsServer.Https, DnsServer.H3].includes(raw.type)) {
          if ('path' in raw) {
            server.path = raw.path
          }
        }
      }
    } else if (DnsServer.Hosts === server.type) {
      if ('path' in raw) {
        server.hosts_path = asList(raw.path)
      }
      if ('predefined' in raw) {
        server.predefined = Object.entries<string[] | string>(raw.predefined).reduce(
          (p, [key, value]) => {
            p[key] = Array.isArray(value) ? value.join(',') : value
            return p
          },
          {} as Recordable,
        )
      }
    } else if (DnsServer.FakeIP === server.type) {
      if ('inet4_range' in raw) {
        server.inet4_range = raw.inet4_range
      }
      if ('inet6_range' in raw) {
        server.inet6_range = raw.inet6_range
      }
    }
    return server
  })
}

const restoreDnsRules = (
  rules: Recordable[],
  InboundsIds: Recordable,
  RouteRuleSetIds: Recordable,
  DnsServersIds: Recordable,
): App.DnsRule[] => {
  return rules.flatMap((raw: Recordable, i) => {
    const rule = Defaults.DefaultDnsRule()
    rule.id = 'rule-' + i
    rule.action = raw.action || RuleAction.Route

    rule.type = simpleRuleType(raw, true)

    if (rule.type === RouteRuleType.Inline) {
      rule.payload = matchJson(raw, dnsFields[rule.action] || [])
    } else if (rule.type === RouteRuleType.Inbound) {
      rule.payload = InboundsIds[raw[rule.type]]
    } else if (rule.type === RouteRuleType.RuleSet) {
      const rs = Array.isArray(raw[rule.type]) ? raw[rule.type] : [raw[rule.type]]
      rule.payload = rs.map((tag: string) => RouteRuleSetIds[tag]).join(',')
    } else {
      rule.payload = Array.isArray(raw[rule.type])
        ? raw[rule.type].join(',')
        : String(raw[rule.type])
    }

    if (RuleAction.Route === rule.action) {
      if ('server' in raw) {
        rule.server = DnsServersIds[raw.server]
      }
      if ('strategy' in raw) {
        rule.strategy = raw.strategy
      }
    } else if (RuleAction.Reject === rule.action) {
      rule.server = 'method' in raw && raw.method ? raw.method : RuleActionReject.Default
    } else if (rule.action === RuleAction.RouteOptions || rule.action === RuleAction.Predefined) {
      rule.server = actionJson(
        raw,
        rule.action === RuleAction.Predefined ? predefinedFields : dnsOptionFields,
      )
    }
    if (rule.action === RuleAction.Route || rule.action === RuleAction.RouteOptions) {
      if ('disable_cache' in raw) {
        rule.disable_cache = raw.disable_cache
      }
      if ('client_subnet' in raw) {
        rule.client_subnet = raw.client_subnet
      }
    }
    if ('invert' in raw) {
      rule.invert = raw.invert
    }
    return rule
  })
}
