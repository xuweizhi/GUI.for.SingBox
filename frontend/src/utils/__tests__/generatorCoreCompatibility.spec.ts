import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  subscriptions: [] as App.Subscription[],
  files: {} as Record<string, string>,
}))

vi.mock('@/bridge', () => ({
  ReadFile: async (path: string) => fixture.files[path],
  WriteFile: vi.fn(),
}))
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { branch: 'main' } } }),
  usePluginsStore: () => ({ onGenerateTrigger: async (config: unknown) => config }),
  useNodeGroupsStore: () => ({ nodeGroups: [], getNodeGroupById: () => undefined }),
  useRulesetsStore: () => ({ getRulesetById: () => undefined }),
  useSubscribesStore: () => ({
    subscribes: fixture.subscriptions,
    getSubscribeById: (id: string) => fixture.subscriptions.find((sub) => sub.id === id),
  }),
}))

import {
  DefaultDns,
  DefaultDnsServer,
  DefaultExperimental,
  DefaultLog,
  DefaultMixin,
  DefaultOutbound,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { DnsServer, Outbound } from '@/enums/kernel'
import { generateConfig } from '@/utils/generator'

// Opt in with installed binaries, never download or start a production core.
const binaries = (process.env.SING_BOX_TEST_BINARIES || '').split(delimiter).filter(Boolean)

describe.skipIf(binaries.length === 0)(
  'generated configuration against installed sing-box cores',
  () => {
    it('checks namespaced DNS, shared direct/chained leaves and WireGuard endpoints', async () => {
      const target = {
        ...DefaultOutbound(),
        id: 'target',
        tag: 'Landing',
        type: Outbound.Urltest,
        pre_proxy: 'relay',
      }
      const relay = { ...DefaultOutbound(), id: 'relay', tag: 'Relay' }
      const plain = { ...DefaultOutbound(), id: 'plain', tag: 'Unchained' }
      const wg = { ...DefaultOutbound(), id: 'wg', tag: 'WireGuard' }
      target.outbounds = [{ id: 'a', tag: 'A', type: 'Subscription' }]
      plain.outbounds = [{ id: 'a', tag: 'A', type: 'Subscription' }]
      relay.outbounds = [{ id: 'b', tag: 'B', type: 'Subscription' }]
      wg.outbounds = [{ id: 'wg-sub', tag: 'WG', type: 'Subscription' }]
      const dns = DefaultDns()
      const system = {
        ...DefaultDnsServer(),
        id: 'system',
        tag: 'System-DNS-Resolver',
        type: DnsServer.Local,
      }
      dns.servers = [system]
      dns.rules = []
      dns.final = system.id
      const route = DefaultRoute()
      route.rules = []
      route.rule_set = []
      route.final = target.id
      route.default_domain_resolver.server = system.id
      const experimental = DefaultExperimental()
      experimental.cache_file.enabled = false
      experimental.clash_api.external_controller = ''
      experimental.clash_api.external_ui_download_detour = ''
      const profile: App.Profile = {
        id: 'compatibility',
        name: 'Compatibility',
        log: DefaultLog(),
        experimental,
        inbounds: [],
        outbounds: [target, relay, plain, wg],
        route,
        dns,
        mixin: DefaultMixin(),
        script: DefaultScript(),
      }
      fixture.subscriptions = ['a', 'b', 'wg-sub'].map(
        (id) =>
          ({
            id,
            name: id,
            path: id,
            proxies: [],
            preferOutboundDns: true,
            importedDns: {
              servers: [
                { tag: 'provider', type: 'udp', server: id === 'a' ? '1.1.1.1' : '8.8.8.8' },
              ],
              resolver: 'provider',
            },
          }) as unknown as App.Subscription,
      )
      fixture.files.a = JSON.stringify([
        { type: 'socks', tag: 'Landing node', server: 'landing.invalid', server_port: 1080 },
      ])
      fixture.files.b = JSON.stringify([
        { type: 'socks', tag: 'Relay node', server: 'relay.invalid', server_port: 1080 },
      ])
      fixture.files['wg-sub'] = JSON.stringify([
        {
          _gui_kind: 'endpoint',
          type: 'wireguard',
          tag: 'WG node',
          address: ['10.20.30.2/32'],
          private_key: Buffer.alloc(32, 1).toString('base64'),
          peers: [
            {
              address: '192.0.2.1',
              port: 51820,
              public_key: Buffer.alloc(32, 2).toString('base64'),
              allowed_ips: ['0.0.0.0/0'],
            },
          ],
        },
      ])
      const config = await generateConfig(profile, {
        enableStableConfigCompat: false,
        enablePluginProcessing: false,
        enableMixinProcessing: false,
        enableScriptProcessing: false,
      })
      expect(config.endpoints).toHaveLength(1)
      expect(config.outbounds.some((node: Recordable) => node.detour === relay.tag)).toBe(true)
      expect(JSON.stringify(config)).not.toContain('_gui_kind')
      // Exercise hostname bootstrap, imported resolver dependencies and endpoint detour.
      fixture.subscriptions[0]!.outboundDns = ['h3://dns.example/dns-query']
      fixture.subscriptions[1]!.importedDns = {
        servers: [
          {
            tag: 'provider',
            type: 'tls',
            server: 'resolver.example',
            domain_resolver: 'bootstrap',
          },
          { tag: 'bootstrap', type: 'udp', server: '1.1.1.1' },
        ],
        resolver: 'provider',
      }
      wg.pre_proxy = relay.id
      const chainedEndpoint = await generateConfig(profile, {
        enableStableConfigCompat: false,
        enablePluginProcessing: false,
        enableMixinProcessing: false,
        enableScriptProcessing: false,
      })
      expect(chainedEndpoint.endpoints[0].detour).toBe(relay.tag)
      expect(chainedEndpoint.dns.servers.some((server: Recordable) => server.type === 'h3')).toBe(
        true,
      )
      const directory = mkdtempSync(join(tmpdir(), 'gui-core-compatibility-'))
      try {
        const path = join(directory, 'config.json')
        for (const generated of [config, chainedEndpoint]) {
          writeFileSync(path, JSON.stringify(generated, null, 2))
          for (const binary of binaries) {
            try {
              execFileSync(binary, ['check', '--disable-color', '-c', path, '-D', directory], {
                encoding: 'utf8',
                timeout: 30_000,
                stdio: ['ignore', 'pipe', 'pipe'],
              })
            } catch (error: any) {
              throw new Error(
                `${binary}: ${String(error.stderr || error.message)}\n${readFileSync(path, 'utf8')}`,
              )
            }
          }
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  },
)
