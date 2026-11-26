import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
}))

vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { branch: 'main' } } }),
  usePluginsStore: () => ({ onGenerateTrigger: async (config: unknown) => config }),
  useProfilesStore: () => ({ getProfileTemplate: () => createProfile() }),
  useNodeGroupsStore: () => ({ nodeGroups: [], getNodeGroupById: () => undefined }),
  useRulesetsStore: () => ({ getRulesetById: () => undefined }),
  useSubscribesStore: () => ({ subscribes: [], getSubscribeById: () => undefined }),
}))

import {
  DefaultDns,
  DefaultExperimental,
  DefaultInbounds,
  DefaultLog,
  DefaultMixin,
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { RulesetFormat, RulesetType, RuleType } from '@/enums/kernel'
import { generateConfig } from '@/utils/generator'
import {
  applyDnsPreset,
  applyProfilePreset,
  detectManagedRuleKey,
  ensureProfileRuleset,
  getManagedToggleStates,
  pruneUnusedProfileRulesets,
  setManagedToggle,
} from '@/utils/managedRules'
import {
  compileQuickDnsRules,
  compileQuickRouteRules,
  parseQuickRuleEntries,
  quickRulePayloadToEntry,
} from '@/utils/quickRules'
import { restoreProfile } from '@/utils/restorer'

const createProfile = (): App.Profile => ({
  id: 'p-quick',
  name: 'Quick Test',
  primary_proxy_outbound: 'Select',
  log: DefaultLog(),
  experimental: DefaultExperimental(),
  inbounds: DefaultInbounds(),
  outbounds: DefaultOutbounds(),
  route: DefaultRoute(),
  dns: DefaultDns(),
  mixin: DefaultMixin(),
  script: DefaultScript(),
})

const configOptions = {
  enableStableConfigCompat: false,
  enablePluginProcessing: false,
  enableMixinProcessing: false,
  enableScriptProcessing: false,
}

describe('quick rules & simplified profile rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies domain, exact domain, keyword, IP/CIDR, and process entries accurately', () => {
    const parsed = parseQuickRuleEntries([
      '# comment line',
      '// another comment',
      'openai.com',
      '.claude.ai',
      'full:api.github.com',
      'keyword:corp-internal',
      '10.20.30.40',
      '192.168.0.0/16',
      '2001:db8::1',
      'process:curl',
      '/usr/local/bin/my-app',
    ])

    expect(parsed).toEqual({
      domain: ['api.github.com'],
      domain_suffix: ['openai.com', 'claude.ai'],
      domain_keyword: ['corp-internal'],
      ip_cidr: ['10.20.30.40/32', '192.168.0.0/16', '2001:db8::1/128'],
      process_name: ['curl'],
      process_path: ['/usr/local/bin/my-app'],
    })
  })

  it('emits separate sing-box rules per match field so rules are OR-effective instead of ANDed', () => {
    const routeRules = compileQuickRouteRules(
      {
        block: ['ads.example.com'],
        direct: ['corp.local', '10.0.0.0/8', 'process:ssh'],
        proxy: ['full:chat.openai.com', 'openai.com'],
      },
      { direct: 'Direct', proxy: 'Select', block: 'Block' },
    )

    // Each rule has only one match field + action + outbound
    for (const rule of routeRules) {
      const matchKeys = Object.keys(rule).filter(
        (key) => !['action', 'outbound', 'method'].includes(key),
      )
      expect(matchKeys).toHaveLength(1)
    }
    expect(routeRules[0]).toEqual({
      action: 'route',
      domain_suffix: 'ads.example.com',
      outbound: 'Block',
    })
    expect(routeRules).toContainEqual({
      action: 'route',
      ip_cidr: '10.0.0.0/8',
      outbound: 'Direct',
    })
    expect(routeRules).toContainEqual({
      action: 'route',
      domain: 'chat.openai.com',
      outbound: 'Select',
    })

    const dnsRules = compileQuickDnsRules(
      {
        block: ['ignored.block'],
        direct: ['corp.local', '10.0.0.0/8'],
        proxy: ['openai.com'],
      },
      { local: 'Local-DNS', remote: 'Remote-DNS' },
    )
    expect(dnsRules).toEqual([
      { action: 'route', domain_suffix: 'corp.local', server: 'Local-DNS' },
      { action: 'route', domain_suffix: 'openai.com', server: 'Remote-DNS' },
    ])
  })

  it('injects quick rules at InsertionPoint for both route and DNS and preserves them across untouched JSON roundtrip', async () => {
    const profile = createProfile()
    profile.route.quick_rules = {
      direct: ['my-lan.example'],
      proxy: ['openai.com'],
      block: ['tracker.example'],
    }
    profile.preset = 'bypass-cn'
    profile.dns.preset = 'smart'

    const config = await generateConfig(profile, configOptions)

    // Quick route rules appear after clash_mode (preamble) and before geo rules
    const clashGlobalIdx = config.route.rules.findIndex((r: Recordable) => r.clash_mode === 'global')
    const blockIdx = config.route.rules.findIndex(
      (r: Recordable) => r.domain_suffix === 'tracker.example',
    )
    const directIdx = config.route.rules.findIndex(
      (r: Recordable) => r.domain_suffix === 'my-lan.example',
    )
    const proxyIdx = config.route.rules.findIndex(
      (r: Recordable) => r.domain_suffix === 'openai.com',
    )
    const geoCnIdx = config.route.rules.findIndex(
      (r: Recordable) => Array.isArray(r.rule_set) && r.rule_set.includes('GeoSite-CN'),
    )
    expect(clashGlobalIdx).toBeGreaterThanOrEqual(0)
    expect(blockIdx).toBeGreaterThan(clashGlobalIdx)
    expect(directIdx).toBeGreaterThan(blockIdx)
    expect(proxyIdx).toBeGreaterThan(directIdx)
    expect(geoCnIdx).toBeGreaterThan(proxyIdx)

    // Quick DNS rules stay aligned with route quick rules
    expect(config.dns.rules).toContainEqual({
      action: 'route',
      domain_suffix: 'my-lan.example',
      server: 'Local-DNS',
    })
    expect(config.dns.rules).toContainEqual({
      action: 'route',
      domain_suffix: 'openai.com',
      server: 'Remote-DNS',
    })

    // Roundtrip without JSON edits preserves quick_rules & preset without duplicating rules
    const restored = restoreProfile(JSON.parse(JSON.stringify(config)), profile.name, {
      profile,
      baseline: config,
    })
    expect(restored.route.quick_rules).toEqual(profile.route.quick_rules)
    expect(restored.preset).toBe('bypass-cn')
    expect(restored.dns.preset).toBe('smart')
    const regenerated = await generateConfig(restored, configOptions)
    expect(regenerated.route.rules).toEqual(config.route.rules)
    expect(regenerated.dns.rules).toEqual(config.dns.rules)
  })

  it('toggles managed system rules, switches presets preserving user rules, and auto-registers/prunes rulesets', () => {
    const profile = createProfile()
    // Add a user custom rule before switching presets
    const customRuleset = ensureProfileRuleset(profile.route.rule_set, {
      kind: 'remote',
      url: 'https://example.com/openai.srs',
      tag: 'GeoSite-OpenAI',
      format: RulesetFormat.Binary,
    })
    // Calling again reuses the same ruleset without duplicate registration
    expect(
      ensureProfileRuleset(profile.route.rule_set, {
        kind: 'remote',
        url: 'https://example.com/openai.srs',
        tag: 'GeoSite-OpenAI',
        format: RulesetFormat.Binary,
      }),
    ).toBe(customRuleset)

    profile.route.rules.splice(5, 0, {
      id: 'user-ai',
      type: RuleType.RuleSet,
      enable: true,
      payload: customRuleset.id,
      invert: false,
      action: 'route' as any,
      outbound: 'Select',
      sniffer: [],
      strategy: 'default' as any,
      server: '',
    })

    const initialToggles = getManagedToggleStates(profile)
    expect(initialToggles.hijackDns).toBe(true)
    expect(initialToggles.blockQuic).toBe(true)
    setManagedToggle(profile, 'blockQuic', false)
    expect(getManagedToggleStates(profile).blockQuic).toBe(false)
    expect(detectManagedRuleKey(profile.route.rules[0]!, profile)).toBe('tun-sniff')

    applyProfilePreset(profile, 'global')
    expect(profile.preset).toBe('global')
    expect(profile.route.rules.some((r) => r.id === 'user-ai')).toBe(true)
    expect(profile.route.rules.some((r) => r.payload === 'GeoSite-CN')).toBe(false)

    // DNS preset fakeip enables Fake-IP rule and store_fakeip
    applyDnsPreset(profile, 'fakeip')
    expect(profile.dns.preset).toBe('fakeip')
    expect(profile.experimental.cache_file.store_fakeip).toBe(true)
    expect(profile.dns.rules.some((r) => r.enable && r.payload.includes('__is_fake_ip'))).toBe(true)

    // Unused rulesets (GeoIP-CN in global mode) are cleanly pruned
    const unused = ensureProfileRuleset(profile.route.rule_set, {
      kind: 'local',
      id: 'orphan-rs',
      tag: 'Orphan',
      format: RulesetFormat.Source,
    })
    expect(unused.type).toBe(RulesetType.Local)
    const pruned = pruneUnusedProfileRulesets(profile)
    expect(pruned).toContain('Orphan')
  })

  it('converts connection payloads into quick rule entries cleanly', () => {
    expect(quickRulePayloadToEntry({ domain: 'api.example.com' })).toBe('full:api.example.com')
    expect(quickRulePayloadToEntry({ domain_suffix: '.example.com' })).toBe('example.com')
    expect(quickRulePayloadToEntry({ ip_cidr: '1.1.1.1/32' })).toBe('1.1.1.1/32')
    expect(quickRulePayloadToEntry({ process_path: '/usr/bin/curl' })).toBe('/usr/bin/curl')
  })

  it('ignores malformed trailing-slash CIDRs and emits A/AAAA + fallback DNS rules in fakeip mode', () => {
    const parsed = parseQuickRuleEntries([
      '192.168.1.1/',
      '2001:db8::1/',
      '192.168.1.0/24',
      '10.0.0.1/abc',
    ])
    expect(parsed.ip_cidr).toEqual(['192.168.1.0/24'])

    const dnsRules = compileQuickDnsRules(
      {
        direct: ['corp.local'],
        proxy: ['openai.com'],
        block: [],
      },
      { local: 'Local-DNS', remote: 'Remote-DNS', fakeip: 'FakeIP-DNS' },
    )
    expect(dnsRules).toEqual([
      { action: 'route', domain_suffix: 'corp.local', server: 'Local-DNS' },
      {
        action: 'route',
        domain_suffix: 'openai.com',
        query_type: ['A', 'AAAA'],
        server: 'FakeIP-DNS',
      },
      { action: 'route', domain_suffix: 'openai.com', server: 'Remote-DNS' },
    ])
  })

  it('drops quick_rules consistently on asymmetric JSON edits and preserves disabled inbounds & ruleset IDs', async () => {
    const profile = createProfile()
    profile.route.quick_rules = {
      direct: ['my-lan.example'],
      proxy: ['openai.com'],
      block: [],
    }
    const config = await generateConfig(profile, configOptions)
    const edited = JSON.parse(JSON.stringify(config))
    edited.route.rules.push({ domain: 'manual-edit.example', action: 'route', outbound: 'Direct' })

    const restored = restoreProfile(edited, profile.name, {
      profile,
      baseline: config,
    })
    expect(restored.route.quick_rules).toBeUndefined()
    // Disabled tun-in inbound from the original profile is preserved
    expect(restored.inbounds.some((inbound) => inbound.tag === 'tun-in' && !inbound.enable)).toBe(
      true,
    )
    // Restored rule_set references are all valid string IDs (never null)
    const ruleSetRefs = restored.route.rules
      .filter((r) => r.type === RuleType.RuleSet)
      .map((r) => r.payload)
    expect(ruleSetRefs.length).toBeGreaterThan(0)
    expect(ruleSetRefs.every((p) => typeof p === 'string' && p.length > 0 && !p.includes('null'))).toBe(
      true,
    )
    // Regenerating does not duplicate quick DNS rules
    const regenerated = await generateConfig(restored, configOptions)
    const openaiDnsMatches = regenerated.dns.rules.filter(
      (r: Recordable) => r.domain_suffix === 'openai.com',
    )
    expect(openaiDnsMatches).toHaveLength(1)
  })

  it('avoids duplicate DNS server tags on restored profiles and keeps inline-referenced rulesets during prune', () => {
    const profile = createProfile()
    // Simulate restored profile where server IDs differ from canonical tags
    profile.dns.servers = profile.dns.servers.map((server, idx) => ({
      ...server,
      id: `restored-dns-${idx}`,
    }))
    applyDnsPreset(profile, 'fakeip')
    const tags = profile.dns.servers.map((s) => s.tag)
    expect(new Set(tags).size).toBe(tags.length)

    // Inline rule referencing a ruleset tag should protect that ruleset from pruning
    const inlineRs = ensureProfileRuleset(profile.route.rule_set, {
      kind: 'local',
      id: 'inline-protected-rs',
      tag: 'Inline-Protected',
      format: RulesetFormat.Source,
    })
    profile.route.rules.push({
      id: 'inline-rule',
      type: RuleType.Inline,
      enable: true,
      payload: JSON.stringify({ type: 'logical', mode: 'or', rules: [{ rule_set: [inlineRs.tag] }] }),
      invert: false,
      action: 'route' as any,
      outbound: 'Select',
      sniffer: [],
      strategy: 'default' as any,
      server: '',
    })
    const pruned = pruneUnusedProfileRulesets(profile)
    expect(pruned).not.toContain('Inline-Protected')
    expect(profile.route.rule_set.some((rs) => rs.tag === 'Inline-Protected')).toBe(true)
  })
})
