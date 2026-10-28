import { parse } from 'yaml'

import { ReadFile, WriteFile } from '@/bridge'
import {
  CoreConfigFilePath,
  HeadlessDefaultRoutingMark,
  LegacyDefaultDomainResolverTags,
  SystemDnsResolverTag,
} from '@/constant/kernel'
import { Branch } from '@/enums/app'
import {
  DnsServer,
  Inbound,
  Outbound,
  RuleAction,
  RulesetType,
  RuleType,
  Strategy,
} from '@/enums/kernel'
import {
  useAppSettingsStore,
  useNodeGroupsStore,
  usePluginsStore,
  useRulesetsStore,
  useSubscribesStore,
} from '@/stores'
import {
  deepAssign,
  deepClone,
  APP_TITLE,
  createTextMatcher,
  isValidIPv4,
  isValidIPv6,
  resolveNodeGroup,
} from '@/utils'

import { findOutboundGraphIssues } from './outboundPolicy'
import {
  extractSubscriptionConfig,
  isSubscriptionEndpoint,
  stripSubscriptionMetadata,
  parseSubscriptionDnsAddresses,
} from './subscriptionConfig'

const _generateRule = (
  rule: App.Rule | App.DnsRule,
  rule_set: App.ProfileRuleSet[],
  inbounds: App.Inbound[],
) => {
  const getInbound = (id: string) => inbounds.find((v) => v.id === id)?.tag
  const getRuleset = (id: string) => rule_set.find((v) => v.id === id)?.tag

  const extra: Recordable = { action: rule.action, invert: rule.invert ? true : undefined }
  if (rule.type === RuleType.Inline) {
    deepAssign(extra, JSON.parse(rule.payload))
  } else if (rule.type === RuleType.RuleSet) {
    extra[rule.type] = rule.payload.split(',').map((id) => getRuleset(id))
  } else if (rule.type === RuleType.Inbound) {
    extra[rule.type] = getInbound(rule.payload)
  } else if ([RuleType.IpIsPrivate, RuleType.IpAcceptAny].includes(rule.type as any)) {
    extra[rule.type] = rule.payload === 'true'
  } else if (rule.type === RuleType.ClashMode) {
    extra[rule.type] = rule.payload
  } else {
    extra[rule.type] = String(rule.payload)
      .split(',')
      .map((val) => {
        if ([RuleType.Port, RuleType.SourcePort].includes(rule.type as any)) {
          return Number(val)
        }
        return val
      })
    if (extra[rule.type].length === 1) {
      extra[rule.type] = extra[rule.type][0]
    }
  }
  return extra
}

const generateExperimental = (experimental: App.Experimental, outbounds: App.Outbound[]) => {
  const getOutbound = (id: string) => outbounds.find((v) => v.id === id)?.tag
  return {
    clash_api: {
      ...experimental.clash_api,
      external_ui_download_detour: getOutbound(experimental.clash_api.external_ui_download_detour),
    },
    cache_file: {
      ...experimental.cache_file,
      store_rdrc: undefined,
    },
  }
}

const generateInbounds = (inbounds: App.Inbound[]) => {
  return inbounds.flatMap((inbound) => {
    if (!inbound.enable) return []
    if (inbound.type !== Inbound.Tun && inbound.type !== Inbound.Direct) {
      const users = inbound[inbound.type]!.users.map((user) => {
        const separator = user.indexOf(':')
        return {
          username: separator === -1 ? user : user.slice(0, separator),
          password: separator === -1 ? '' : user.slice(separator + 1),
        }
      })
      return {
        type: inbound.type,
        tag: inbound.tag,
        ...inbound[inbound.type]!.listen,
        users: users.length > 0 ? users : undefined,
      }
    }
    if (inbound.type === Inbound.Direct) {
      return {
        type: inbound.type,
        tag: inbound.tag,
        ...inbound.direct!.listen,
        ...(inbound.direct!.network ? { network: inbound.direct!.network } : {}),
      }
    }
    if (inbound.type === Inbound.Tun) {
      return {
        type: inbound.type,
        tag: inbound.tag,
        ...inbound.tun!,
        route_address: inbound.tun!.route_address?.length ? inbound.tun!.route_address : undefined,
        route_exclude_address: inbound.tun!.route_exclude_address?.length
          ? inbound.tun!.route_exclude_address
          : undefined,
      }
    }
  })
}

const generateOutbounds = async (
  outbounds: App.Outbound[],
  dns: Recordable,
  native: App.Profile['native'] = {},
  nativeRouteRoots: string[] = [],
) => {
  const result: Recordable[] = []
  const subscribesStore = useSubscribesStore()
  const nodeGroupsStore = useNodeGroupsStore()
  const graphIssue = findOutboundGraphIssues(outbounds, nodeGroupsStore.nodeGroups)[0]
  if (graphIssue) {
    const labels = graphIssue.chain.map((id) => outbounds.find((o) => o.id === id)?.tag || id)
    throw new Error(`Invalid strategy references (${graphIssue.type}): ${labels.join(' → ')}`)
  }
  const byId = new Map(outbounds.map((outbound) => [outbound.id, outbound]))
  const subscriptionCache = new Map<
    string,
    {
      name: string
      proxies: Recordable[]
      subscription: App.Subscription
      dnsTags: Map<string, string>
      dnsSource: Recordable[]
      resolver?: string
      manual: boolean
      importedDnsTags: Set<string>
    }
  >()
  const proxiesByTag = new Map<string, Recordable>()
  const runtimeTags = new WeakMap<Recordable, string>()
  const endpointTags = new Set<string>()
  const builtInProxiesSet = new Set<string>()
  const usedRuntimeTags = new Set<string>([Outbound.Direct, Outbound.Block])
  const usedDnsTags = new Set<string>(dns.servers.map((server: Recordable) => server.tag))
  const profileDnsTags = new Set(usedDnsTags)
  const activeRegistrations = new Set<string>()
  const uniqueTag = (preferred: string, used: Set<string>) => {
    let tag = preferred
    let index = 2
    while (used.has(tag)) tag = `${preferred} ${index++}`
    used.add(tag)
    return tag
  }
  outbounds.forEach((outbound) => {
    if (!outbound.tag) throw new Error('Outbound tag cannot be empty')
    if (outbounds.some((other) => other !== outbound && other.tag === outbound.tag)) {
      throw new Error(`Duplicate outbound tag: ${outbound.tag}`)
    }
    usedRuntimeTags.add(outbound.tag)
  })
  for (const entry of [...(native.outbounds || []), ...(native.endpoints || [])]) {
    if (proxiesByTag.has(entry.tag) || outbounds.some((outbound) => outbound.tag === entry.tag))
      throw new Error(`Duplicate native outbound tag: ${entry.tag}`)
    usedRuntimeTags.add(entry.tag)
    proxiesByTag.set(entry.tag, deepClone(entry))
  }
  native.endpoints?.forEach((entry) => endpointTags.add(entry.tag))

  const getSubscriptionProxies = async (subscriptionId: string) => {
    if (!subscriptionCache.has(subscriptionId)) {
      const subscription = subscribesStore.getSubscribeById(subscriptionId)
      if (!subscription) throw new Error(`Subscription not found: ${subscriptionId}`)
      const extracted = extractSubscriptionConfig(JSON.parse(await ReadFile(subscription.path)))
      const parsed = extracted.outbounds
      if (parsed.some((proxy) => !proxy || typeof proxy.tag !== 'string' || !proxy.tag.trim())) {
        throw new Error(`Invalid subscription data: ${subscription.name || subscriptionId}`)
      }
      if (new Set(parsed.map((proxy) => proxy.tag)).size !== parsed.length) {
        throw new Error(
          `Duplicate node tags in subscription: ${subscription.name || subscriptionId}`,
        )
      }
      const manual = !!subscription.outboundDns?.some((address) => address.trim())
      const imported = subscription.importedDns || extracted.importedDns
      const source = subscription.preferOutboundDns
        ? manual
          ? parseSubscriptionDnsAddresses(subscription.outboundDns!)
          : imported?.servers || []
        : []
      const dnsTags = new Map<string, string>()
      source.forEach((server) => {
        if (typeof server.tag !== 'string' || !server.tag || dnsTags.has(server.tag)) {
          throw new Error(`Invalid or duplicate DNS tag in subscription: ${subscription.name}`)
        }
        dnsTags.set(server.tag, uniqueTag(`sub:${subscriptionId}:${server.tag}`, usedDnsTags))
      })
      subscriptionCache.set(subscriptionId, {
        name: subscription.name || subscriptionId,
        proxies: parsed,
        subscription,
        dnsSource: source,
        importedDnsTags: new Set((imported?.servers || []).map((server) => server.tag)),
        dnsTags,
        manual,
        resolver: source.length
          ? manual
            ? source[0]!.tag
            : imported?.resolver || source[0]!.tag
          : undefined,
      })
    }
    return subscriptionCache.get(subscriptionId)!
  }

  const registerDns = async (subscriptionId: string, sourceTag: string): Promise<string> => {
    const subscription = await getSubscriptionProxies(subscriptionId)
    const tag = subscription.dnsTags.get(sourceTag)
    const source = subscription.dnsSource.find((server) => server.tag === sourceTag)
    if (
      (!tag || !source) &&
      profileDnsTags.has(sourceTag) &&
      !subscription.importedDnsTags.has(sourceTag)
    )
      return sourceTag
    if (!tag || !source)
      throw new Error(`DNS "${sourceTag}" not found in subscription ${subscription.name}`)
    const key = `dns:${tag}`
    if (activeRegistrations.has(key))
      throw new Error(`Circular subscription DNS dependency: ${subscription.name} / ${sourceTag}`)
    if (dns.servers.some((server: Recordable) => server.tag === tag)) return tag
    activeRegistrations.add(key)
    const server = deepClone(source)
    server.tag = tag
    await rewriteDnsReferences(server, subscriptionId)
    if (server.detour) server.detour = await registerDependency(subscriptionId, server.detour)
    if (server.endpoint) server.endpoint = await registerDependency(subscriptionId, server.endpoint)
    if (
      server.server &&
      !isValidIPv4(server.server) &&
      !isValidIPv6(server.server) &&
      !server.domain_resolver
    ) {
      server.domain_resolver =
        dns.servers.find((entry: Recordable) => entry.type === DnsServer.Local)?.tag ||
        SystemDnsResolverTag
    }
    dns.servers.push(server)
    activeRegistrations.delete(key)
    return tag
  }
  const rewriteDnsReferences = async (entry: Recordable, subscriptionId: string) => {
    for (const field of ['domain_resolver', 'address_resolver']) {
      const reference = entry[field]
      if (typeof reference === 'string' && reference)
        entry[field] = await registerDns(subscriptionId, reference)
      else if (reference?.server)
        entry[field] = { ...reference, server: await registerDns(subscriptionId, reference.server) }
    }
  }
  const registerDependency = async (subscriptionId: string, tag: string): Promise<string> => {
    const subscription = await getSubscriptionProxies(subscriptionId)
    const proxy = subscription.proxies.find((entry) => entry.tag === tag)
    if (proxy) return registerProxy(proxy, subscriptionId)
    if ([Outbound.Direct, Outbound.Block].includes(tag as Outbound)) {
      builtInProxiesSet.add(tag)
      return tag
    }
    // Manually authored nodes may deliberately reference an existing profile strategy.
    if (
      outbounds.some((entry) => entry.tag === tag) ||
      [...(native.outbounds || []), ...(native.endpoints || [])].some((entry) => entry.tag === tag)
    )
      return tag
    throw new Error(`Referenced node "${tag}" not found in subscription ${subscription.name}`)
  }
  const registerProxy = async (proxy: Recordable, subscriptionId: string): Promise<string> => {
    const subscription = await getSubscriptionProxies(subscriptionId)
    const key = `node:${subscriptionId}:${proxy.tag}`
    if (activeRegistrations.has(key))
      throw new Error(`Circular node/DNS dependency: ${subscription.name} / ${proxy.tag}`)
    const existing = runtimeTags.get(proxy)
    if (existing) return existing
    activeRegistrations.add(key)
    let tag = proxy.tag
    if (usedRuntimeTags.has(tag)) {
      tag = `${proxy.tag} [${subscription.name}]`
      let sequence = 2
      while (usedRuntimeTags.has(tag)) tag = `${proxy.tag} [${subscription.name} ${sequence++}]`
    }
    usedRuntimeTags.add(tag)
    const runtime = stripSubscriptionMetadata(deepClone(proxy))
    runtime.tag = tag
    if (proxy.detour) runtime.detour = await registerDependency(subscriptionId, proxy.detour)
    if (Array.isArray(proxy.outbounds)) {
      runtime.outbounds = []
      for (const member of proxy.outbounds)
        runtime.outbounds.push(await registerDependency(subscriptionId, member))
    }
    if (proxy.default) runtime.default = await registerDependency(subscriptionId, proxy.default)
    // Subscription resolver references must never leak into unrelated profile DNS namespaces.
    if (!subscription.subscription.preferOutboundDns || !subscription.dnsSource.length) {
      for (const field of ['domain_resolver', 'address_resolver']) {
        const reference = runtime[field]
        const tag = typeof reference === 'string' ? reference : reference?.server
        if (tag && (subscription.importedDnsTags.has(tag) || !profileDnsTags.has(tag)))
          delete runtime[field]
      }
    } else if (subscription.manual) {
      delete runtime.domain_resolver
      delete runtime.address_resolver
    } else {
      await rewriteDnsReferences(runtime, subscriptionId)
    }
    const needsResolver =
      (runtime.server && !isValidIPv4(runtime.server) && !isValidIPv6(runtime.server)) ||
      runtime.peers?.some(
        (peer: Recordable) =>
          peer.address && !isValidIPv4(peer.address) && !isValidIPv6(peer.address),
      )
    if (needsResolver && !runtime.domain_resolver && subscription.resolver) {
      runtime.domain_resolver = await registerDns(subscriptionId, subscription.resolver)
    }
    if (isSubscriptionEndpoint(proxy)) endpointTags.add(tag)
    runtimeTags.set(proxy, tag)
    proxiesByTag.set(tag, runtime)
    activeRegistrations.delete(key)
    return tag
  }
  const registerSubscriptionNode = async (
    subscriptionId: string,
    nodeId: string,
    lastKnownTag: string,
  ) => {
    const subscription = await getSubscriptionProxies(subscriptionId)
    const metadata = subscription.subscription.proxies.find((candidate) => candidate.id === nodeId)
    const proxy = subscription.proxies.find(
      (candidate) => candidate.tag === (metadata?.tag || lastKnownTag),
    )
    if (!proxy)
      throw new Error(
        `Proxy "${lastKnownTag || nodeId}" not found in subscription ${subscription.name}`,
      )
    return { proxy, runtimeTag: await registerProxy(proxy, subscriptionId) }
  }

  for (const outbound of outbounds) {
    const runtime: Recordable = {
      ...deepClone(outbound.native || {}),
      type: outbound.type,
      tag: outbound.tag,
    }
    if (outbound.type === Outbound.Urltest) {
      runtime.url = outbound.url
      runtime.interval = outbound.interval
      runtime.tolerance = outbound.tolerance
    }
    if ([Outbound.Selector, Outbound.Urltest].includes(outbound.type as Outbound)) {
      runtime.interrupt_exist_connections = outbound.interrupt_exist_connections
      const members = new Set<string>()
      const emptySources: string[] = []
      const isTagMatching = createTextMatcher(outbound.include, outbound.exclude)
      for (const proxy of outbound.outbounds) {
        if (proxy.type === 'Built-in') {
          if ([Outbound.Direct, Outbound.Block].includes(proxy.id as Outbound)) {
            builtInProxiesSet.add(proxy.id)
            members.add(proxy.id)
          } else members.add(byId.get(proxy.id)!.tag)
        } else if (proxy.type === 'Native') {
          if (!proxiesByTag.has(proxy.id))
            throw new Error(`Native node not found: ${proxy.tag || proxy.id}`)
          members.add(proxy.id)
        } else if (proxy.type === 'NodeGroup') {
          const group = nodeGroupsStore.getNodeGroupById(proxy.id)
          if (!group) throw new Error(`Node group not found: ${proxy.tag || proxy.id}`)
          const resolution = resolveNodeGroup(group, subscribesStore.subscribes)
          let matched = 0
          for (const node of resolution.nodes) {
            const registered = await registerSubscriptionNode(
              node.subscription.id,
              node.proxy.id,
              node.proxy.tag,
            )
            if (!isTagMatching(registered.proxy.tag)) continue
            members.add(registered.runtimeTag)
            matched++
          }
          if (!matched) emptySources.push(`node group "${group.name}"`)
        } else {
          const subId = proxy.type === 'Subscription' ? proxy.id : proxy.type
          const subscription = await getSubscriptionProxies(subId)
          if (proxy.type === 'Subscription') {
            for (const node of subscription.proxies) {
              if (isTagMatching(node.tag)) members.add(await registerProxy(node, subId))
            }
          } else {
            const registered = await registerSubscriptionNode(subId, proxy.id, proxy.tag)
            if (isTagMatching(registered.proxy.tag)) members.add(registered.runtimeTag)
          }
        }
      }
      runtime.outbounds = [...members]
      if (outbound.outbounds.length && !members.size) {
        throw new Error(
          `Strategy "${outbound.tag}" has no valid runtime members. Check ${emptySources.join(', ') || 'its member sources'} and include/exclude filters.`,
        )
      }
    }
    result.push(runtime)
  }
  result.push(...Array.from(builtInProxiesSet).map((tag) => ({ type: tag, tag })))

  // A URL-test has no detour field. Each tested leaf gets its own upstream-specific
  // instance, and nested groups receive equivalent instances with rewritten members.
  const strategies = new Map(result.map((entry) => [entry.tag, entry]))
  const preProxyByTag = new Map(
    outbounds
      .filter((entry) => entry.pre_proxy)
      .map((entry) => [entry.tag, byId.get(entry.pre_proxy!)!.tag]),
  )
  const templates = new Map(
    [...strategies, ...proxiesByTag].map(([tag, entry]) => [tag, deepClone(entry)]),
  )
  const variants = new Map<string, string>()
  const origins = new Map<string, string>()
  const processed = new Set<string>()
  const processing = new Set<string>()
  const chain = (tag: string, inherited = ''): string => {
    const key = JSON.stringify([tag, inherited])
    if (processing.has(key)) throw new Error(`Circular runtime chain: ${tag}`)
    if (variants.has(key)) return variants.get(key)!
    const original = templates.get(tag)
    if (!original) throw new Error(`Runtime node not found: ${tag}`)
    if (processed.has(key)) return tag
    processing.add(key)
    let upstream = inherited
    const configured = preProxyByTag.get(tag)
    if (configured) upstream = chain(configured, inherited)
    let runtime = strategies.get(tag) || proxiesByTag.get(tag)!
    let runtimeTag = tag
    if (inherited) {
      runtimeTag = uniqueTag(`${tag} [via ${inherited}]`, usedRuntimeTags)
      runtime = deepClone(original)
      runtime.tag = runtimeTag
      variants.set(key, runtimeTag)
      origins.set(runtimeTag, origins.get(tag) || tag)
      if (endpointTags.has(tag)) endpointTags.add(runtimeTag)
      proxiesByTag.set(runtimeTag, runtime)
    }
    if (Array.isArray(runtime.outbounds)) {
      runtime.outbounds = runtime.outbounds.map((member: string) => chain(member, upstream))
      if (runtime.default) runtime.default = chain(runtime.default, upstream)
    } else if (upstream) {
      if (['direct', 'block', 'dns'].includes(runtime.type)) {
        throw new Error(
          `Node "${tag}" (${runtime.type}) cannot use pre-proxy "${upstream}". Remove it from the chained strategy.`,
        )
      }
      if (runtime.detour) {
        // Preserve an imported chain by applying the new upstream to its first hop.
        runtime.detour = chain(runtime.detour, upstream)
      } else runtime.detour = upstream
    }
    processing.delete(key)
    processed.add(key)
    return runtimeTag
  }
  // Always clone from immutable templates, independent of strategy ordering.
  for (const outbound of outbounds) chain(outbound.tag)
  const all = new Map([...strategies, ...proxiesByTag])
  const reachable = new Set<string>()
  const visiting = new Set<string>()
  const visit = (tag: string) => {
    if (visiting.has(tag)) throw new Error(`Circular runtime dependency: ${tag}`)
    if (reachable.has(tag)) return
    visiting.add(tag)
    const entry = all.get(tag)
    if (!entry) throw new Error(`Runtime node not found: ${tag}`)
    entry.outbounds?.forEach(visit)
    if (entry.detour) visit(entry.detour)
    visiting.delete(tag)
    reachable.add(tag)
  }
  result.forEach((entry) => visit(entry.tag))
  nativeRouteRoots.forEach((tag) => {
    if (all.has(tag)) visit(tag)
  })
  const referencedNative = new Set(
    outbounds.flatMap((entry) =>
      entry.outbounds.filter((member) => member.type === 'Native').map((member) => member.id),
    ),
  )
  native.outbounds?.forEach((entry) => {
    if (!referencedNative.has(entry.tag)) visit(entry.tag)
  })
  native.endpoints?.forEach((entry) => {
    if (!referencedNative.has(entry.tag)) visit(entry.tag)
  })
  dns.servers.forEach((entry: Recordable) => {
    if (all.has(entry.detour)) visit(entry.detour)
    if (all.has(entry.endpoint)) visit(entry.endpoint)
  })
  const instances = new Map<string, Recordable[]>()
  const endpoints: Recordable[] = []
  const generated = [...all.values()].filter((entry) => reachable.has(entry.tag))
  for (const entry of generated) {
    if (!endpointTags.has(entry.tag)) continue
    const origin = origins.get(entry.tag) || entry.tag
    const siblings = instances.get(origin) || []
    siblings.push(entry)
    instances.set(origin, siblings)
    if (siblings.length > 1 && (entry.type !== 'wireguard' || entry.system || entry.listen_port)) {
      throw new Error(
        `Endpoint "${origin}" needs multiple chain instances but shares state, an interface or a listening port. Use separate endpoint definitions for each chain.`,
      )
    }
    endpoints.push(entry)
  }
  return { outbounds: generated.filter((entry) => !endpointTags.has(entry.tag)), endpoints }
}

const generateRoute = (
  route: App.Route,
  inbounds: App.Inbound[],
  outbounds: App.Outbound[],
  dns: App.Dns,
  native?: App.Profile['native'],
) => {
  const getOutbound = (id: string) =>
    outbounds.find((v) => v.id === id)?.tag ||
    [...(native?.outbounds || []), ...(native?.endpoints || [])].find((entry) => entry.tag === id)
      ?.tag
  const getDnsServer = (id: string) => dns.servers.find((v) => v.id === id)?.tag
  const configuredDefaultResolver = dns.servers.find(
    (server) => server.id === route.default_domain_resolver.server,
  )
  const nativeResolverTag =
    dns.servers.find((server) => server.type === DnsServer.Local)?.tag || SystemDnsResolverTag
  const defaultDomainResolverTag =
    configuredDefaultResolver &&
    !LegacyDefaultDomainResolverTags.some((tag) => tag === configuredDefaultResolver.tag)
      ? configuredDefaultResolver.tag
      : nativeResolverTag
  const isInboundEnabled = (id: string) => inbounds.find((v) => v.id === id)?.enable

  const rulesetsStore = useRulesetsStore()

  const extra: Recordable = {}
  if (!route.auto_detect_interface) {
    extra.default_interface = route.default_interface
  }
  return {
    rules: route.rules.flatMap((rule) => {
      if (rule.type === RuleType.InsertionPoint || !rule.enable) {
        return []
      }
      if (rule.type === RuleType.Inbound && !isInboundEnabled(rule.payload)) {
        return []
      }
      const extra: Recordable = _generateRule(rule, route.rule_set, inbounds)

      if (rule.action === RuleAction.Route) {
        extra.outbound = getOutbound(rule.outbound)
      } else if (rule.action === RuleAction.RouteOptions) {
        deepAssign(extra, JSON.parse(rule.outbound))
      } else if (rule.action === RuleAction.Reject) {
        extra.method = rule.outbound
      } else if (rule.action === RuleAction.Sniff) {
        if (rule.sniffer.length) {
          extra.sniffer = rule.sniffer
        }
      } else if (rule.action === RuleAction.Resolve) {
        if (rule.strategy !== Strategy.Default) {
          extra.strategy = rule.strategy
        }
        extra.server = getDnsServer(rule.server)
      }
      if (rule.invert) {
        extra.invert = true
      }
      return extra
    }),
    rule_set: route.rule_set.map((ruleset) => {
      const extra: Recordable = {}
      if (ruleset.type === RuleType.Inline) {
        extra.rules = JSON.parse(ruleset.rules)
      } else if (ruleset.type === RulesetType.Local) {
        const _ruleset = rulesetsStore.getRulesetById(ruleset.path)
        extra.path = _ruleset
          ? _ruleset.path.replace('data/', '../')
          : ruleset.native_path === ruleset.path
            ? ruleset.native_path
            : undefined
        if (!extra.path) throw new Error(`Local rule-set not found: ${ruleset.tag || ruleset.path}`)
        extra.format = ruleset.format
      } else if (ruleset.type === RulesetType.Remote) {
        extra.url = ruleset.url
        extra.format = ruleset.format
        extra.download_detour = getOutbound(ruleset.download_detour)
        if (ruleset.update_interval) {
          extra.update_interval = ruleset.update_interval
        }
      }
      return {
        tag: ruleset.tag,
        type: ruleset.type,
        ...extra,
      }
    }),
    auto_detect_interface: route.auto_detect_interface,
    default_mark: HeadlessDefaultRoutingMark,
    find_process: route.find_process ? true : undefined,
    final: getOutbound(route.final),
    default_domain_resolver: {
      ...route.default_domain_resolver,
      server: defaultDomainResolverTag,
      client_subnet: route.default_domain_resolver.client_subnet || undefined,
    },
    ...extra,
  }
}

const generateDns = (
  dns: App.Dns,
  rule_set: App.ProfileRuleSet[],
  inbounds: App.Inbound[],
  outbounds: App.Outbound[],
  native?: App.Profile['native'],
) => {
  const getOutbound = (id: string) =>
    outbounds.find((v) => v.id === id) ||
    [...(native?.outbounds || []), ...(native?.endpoints || [])].find((entry) => entry.tag === id)
  const getDnsServer = (id: string) => dns.servers.find((v) => v.id === id)?.tag
  const extra: Recordable = {}
  if (dns.strategy !== Strategy.Default) {
    extra.strategy = dns.strategy
  }
  if (dns.client_subnet) {
    extra.client_subnet = dns.client_subnet
  }
  const servers: Recordable[] = dns.servers.flatMap((server) => {
    const extra: Recordable = {}
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
      ].includes(server.type as any)
    ) {
      if (server.detour) {
        const outbound = getOutbound(server.detour)
        if (outbound?.type !== Outbound.Direct) {
          extra.detour = outbound?.tag
        }
      }
      const needsDomainResolver =
        server.domain_resolver &&
        server.server &&
        !isValidIPv4(server.server) &&
        !isValidIPv6(server.server)
      needsDomainResolver && (extra.domain_resolver = getDnsServer(server.domain_resolver))
      if (
        [
          DnsServer.Tcp,
          DnsServer.Udp,
          DnsServer.Tls,
          DnsServer.Quic,
          DnsServer.Https,
          DnsServer.H3,
        ].includes(server.type as any)
      ) {
        server.server_port && (extra.server_port = Number(server.server_port))
        extra.server = server.server
        if ([DnsServer.Https, DnsServer.H3].includes(server.type as any)) {
          server.path && (extra.path = server.path)
        }
      }
    }
    if (server.type === DnsServer.Hosts) {
      extra.path = server.hosts_path.reduce((p, c) => p.concat(c.split(',')), [] as string[])
      extra.predefined = Object.entries(server.predefined).reduce(
        (p, [k, v]) => ({ ...p, [k]: v.split(',') }),
        {},
      )
    } else if (server.type === DnsServer.Dhcp) {
      server.interface && (extra.interface = server.interface)
    } else if (server.type === DnsServer.FakeIP) {
      server.inet4_range && (extra.inet4_range = server.inet4_range)
      server.inet6_range && (extra.inet6_range = server.inet6_range)
    }
    return {
      tag: server.tag,
      type: server.type,
      ...extra,
    }
  })
  if (!dns.servers.some((server) => server.type === DnsServer.Local)) {
    servers.unshift({ tag: SystemDnsResolverTag, type: DnsServer.Local })
  }

  return {
    servers,
    rules: dns.rules.flatMap((rule) => {
      if (rule.type === RuleType.InsertionPoint || !rule.enable) {
        return []
      }
      const extra: Recordable = _generateRule(rule, rule_set, inbounds)
      if (rule.type === RuleType.Inline && rule.payload.includes('__is_fake_ip')) {
        if (!dns.servers.find((v) => v.type === DnsServer.FakeIP)) {
          return []
        }
        delete extra.__is_fake_ip
      }
      if ([RuleAction.Route, RuleAction.RouteOptions].includes(rule.action as any)) {
        rule.disable_cache && (extra.disable_cache = rule.disable_cache)
        rule.client_subnet && (extra.client_subnet = rule.client_subnet)
        if (rule.action === RuleAction.Route) {
          extra.server = getDnsServer(rule.server)
          if (rule.strategy !== Strategy.Default) {
            extra.strategy = rule.strategy
          }
        }
      }
      if ([RuleAction.RouteOptions, RuleAction.Predefined].includes(rule.action as any)) {
        deepAssign(extra, JSON.parse(rule.server))
      }
      if (rule.action === RuleAction.Reject) {
        extra.method = rule.server
      }
      return extra
    }),
    disable_cache: dns.disable_cache,
    disable_expire: dns.disable_expire,
    independent_cache: dns.independent_cache,
    final: getDnsServer(dns.final),
    ...extra,
  }
}

export const generateDnsServerURL = (dnsServer: App.DnsServerConfig) => {
  const { type, server_port, path, server, interface: _interface } = dnsServer
  const formattedServer = isValidIPv6(server) && !server.startsWith('[') ? `[${server}]` : server
  let address = ''
  if (type == DnsServer.Https) {
    address = `https://${formattedServer}${server_port ? ':' + server_port : ''}${path ? path : ''}`
  } else if (type == DnsServer.H3) {
    address = `h3://${formattedServer}${server_port ? ':' + server_port : ''}${path ? path : ''}`
  } else if (type == DnsServer.Dhcp) {
    address = `dhcp://${_interface}`
  } else if (type == DnsServer.FakeIP) {
    address =
      'fake-ip://' +
      (dnsServer.inet4_range ? dnsServer.inet4_range : '') +
      (dnsServer.inet6_range ? (dnsServer.inet4_range ? ',' : '') + dnsServer.inet6_range : '')
  } else if (type === DnsServer.Hosts) {
    address = 'hosts'
  } else if (type === DnsServer.Local) {
    address = 'local'
  } else {
    address = `${type}://${formattedServer}${server_port ? ':' + server_port : ''}`
  }
  return address
}

const _adaptToStableBranch = (_: Recordable) => {}

type GenerateConfigOptions = {
  enableStableConfigCompat?: boolean
  enablePluginProcessing?: boolean
  enableMixinProcessing?: boolean
  enableScriptProcessing?: boolean
}

export const generateConfig = async (
  originalProfile: App.Profile,
  options: GenerateConfigOptions = {},
) => {
  if (typeof options === 'boolean') {
    options = { enableStableConfigCompat: options }
  }
  const appSettings = useAppSettingsStore()
  const isMainBranch = appSettings.app.kernel.branch === Branch.Main

  const {
    enableStableConfigCompat = isMainBranch,
    enablePluginProcessing = true,
    enableMixinProcessing = true,
    enableScriptProcessing = true,
  } = options

  const profile = deepClone(originalProfile)
  const dns = generateDns(
    profile.dns,
    profile.route.rule_set,
    profile.inbounds,
    profile.outbounds,
    profile.native,
  )
  // Native DNS definitions preserve protocol-specific fields unavailable in the form.
  for (const server of profile.native?.dnsServers || []) {
    const modeled = profile.dns.servers.find((entry) =>
      server._gui_id ? entry.id === server._gui_id : entry.tag === server.tag,
    )
    // A form-backed server was deleted; raw fields must not recreate it.
    if (server._gui_id && !modeled) continue
    const index = dns.servers.findIndex((entry) => entry.tag === (modeled?.tag || server.tag))
    if (index >= 0) {
      const generated = dns.servers[index]!
      const retained = deepClone(server)
      delete retained._gui_id
      for (const key of [
        'server',
        'server_port',
        'path',
        'domain_resolver',
        'detour',
        'interface',
        'inet4_range',
        'inet6_range',
        'predefined',
      ])
        delete retained[key]
      const merged = { ...retained, ...generated }
      if (typeof server.domain_resolver === 'object' && generated.domain_resolver) {
        merged.domain_resolver = { ...server.domain_resolver, server: generated.domain_resolver }
      }
      dns.servers[index] = merged
    } else {
      const retained = deepClone(server)
      delete retained._gui_id
      dns.servers.push(retained)
    }
  }
  const nativeRouteRoots = [
    profile.route.final,
    ...profile.route.rules
      .filter((rule) => rule.enable && rule.action === RuleAction.Route)
      .map((rule) => rule.outbound),
    ...profile.route.rule_set.map((ruleset) => ruleset.download_detour),
  ]
  const native = deepClone(profile.native || {})
  const dnsRenames = new Map<string, string | undefined>()
  for (const server of native.dnsServers || []) {
    if (server._gui_id)
      dnsRenames.set(
        server.tag,
        profile.dns.servers.find((entry) => entry.id === server._gui_id)?.tag,
      )
  }
  for (const node of [...(native.outbounds || []), ...(native.endpoints || [])]) {
    for (const field of ['domain_resolver', 'address_resolver']) {
      const reference = node[field]
      const tag = typeof reference === 'string' ? reference : reference?.server
      if (!dnsRenames.has(tag)) continue
      const renamed = dnsRenames.get(tag)
      if (!renamed) delete node[field]
      else node[field] = typeof reference === 'string' ? renamed : { ...reference, server: renamed }
    }
  }
  const generated = await generateOutbounds(profile.outbounds, dns, native, nativeRouteRoots)
  // step 1
  let config: Recordable = {
    log: profile.log,
    experimental: generateExperimental(profile.experimental, profile.outbounds),
    inbounds: generateInbounds(profile.inbounds),
    outbounds: generated.outbounds,
    ...(generated.endpoints.length ? { endpoints: generated.endpoints } : {}),
    route: generateRoute(
      profile.route,
      profile.inbounds,
      profile.outbounds,
      profile.dns,
      profile.native,
    ),
    dns,
  }

  // adapt to stable branch
  if (enableStableConfigCompat) {
    _adaptToStableBranch(config)
  }

  // step 2
  if (enablePluginProcessing) {
    const pluginsStore = usePluginsStore()
    config = await pluginsStore.onGenerateTrigger(config, originalProfile)
  }

  // step 3
  if (enableMixinProcessing) {
    const { priority, config: mixin } = originalProfile.mixin
    if (priority === 'mixin') {
      deepAssign(config, parse(mixin))
    } else if (priority === 'gui') {
      deepAssign(config, deepAssign(parse(mixin), config))
    }
  }

  // step 4
  if (enableScriptProcessing) {
    const fn = new window.AsyncFunction(
      'config',
      `${originalProfile.script.code}; return await onGenerate(config)`,
    )
    try {
      config = await fn(config)
    } catch (error: any) {
      throw error.message || error
    }

    if (typeof config !== 'object') {
      throw 'Wrong result'
    }
  }

  return config
}

export const generateConfigFile = async (
  profile: App.Profile,
  beforeWrite: (config: any) => Promise<any>,
  outputPath = CoreConfigFilePath,
) => {
  const header = `DO NOT EDIT - Generated by ${APP_TITLE}`

  const _config = await generateConfig(profile)
  const config = await beforeWrite(_config)

  config.experimental.cache_file.path = 'cache.db'

  await WriteFile(outputPath, JSON.stringify({ $schema: header, ...config }, null, 2))
}
