import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
}))

const mockAppSettingsStore = {
  app: {
    kernel: {
      branch: 'main',
    },
  },
}

vi.mock('@/stores', () => ({
  useAppSettingsStore: () => mockAppSettingsStore,
  usePluginsStore: () => ({
    onGenerateTrigger: async (config: unknown) => config,
  }),
  useProfilesStore: () => ({
    getProfileTemplate: () => createProfile(),
  }),
  useRulesetsStore: () => ({
    getRulesetById: vi.fn(),
  }),
  useSubscribesStore: () => ({
    getSubscribeById: vi.fn(),
  }),
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')

  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
    }),
  }
})

import {
  DefaultDns,
  DefaultExperimental,
  DefaultInbounds,
  DefaultInboundDirect,
  DefaultLog,
  DefaultMixin,
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { Inbound } from '@/enums/kernel'
import { generateConfig } from '@/utils/generator'
import { restoreProfile } from '@/utils/restorer'

const createProfile = (): IProfile => ({
  id: 'test-profile',
  name: 'Test Profile',
  log: DefaultLog(),
  experimental: DefaultExperimental(),
  inbounds: DefaultInbounds(),
  outbounds: DefaultOutbounds(),
  route: DefaultRoute(),
  dns: DefaultDns(),
  mixin: DefaultMixin(),
  script: DefaultScript(),
})

describe('generateConfig dns servers', () => {
  beforeEach(() => {
    mockAppSettingsStore.app.kernel.branch = 'main'
  })

  it('omits domain resolvers for IP-based dns servers', async () => {
    const config = await generateConfig(createProfile(), {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    const localDns = config.dns.servers.find((server: { tag: string }) => server.tag === 'Local-DNS')
    const remoteDns = config.dns.servers.find(
      (server: { tag: string }) => server.tag === 'Remote-DNS',
    )

    expect(localDns).not.toHaveProperty('domain_resolver')
    expect(remoteDns).not.toHaveProperty('domain_resolver')
  })

  it('generates direct inbound configuration without users', async () => {
    const profile = createProfile()
    profile.inbounds = [
      {
        id: 'direct-in',
        type: Inbound.Direct,
        tag: 'direct-in',
        enable: true,
        direct: {
          ...DefaultInboundDirect(),
          network: 'tcp',
        },
      },
    ]

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.inbounds).toEqual([
      {
        type: 'direct',
        tag: 'direct-in',
        listen: '127.0.0.1',
        listen_port: 20119,
        tcp_fast_open: false,
        tcp_multi_path: false,
        udp_fragment: false,
        network: 'tcp',
      },
    ])
  })

  it('restores direct inbound configuration', () => {
    const profile = restoreProfile(
      {
        experimental: DefaultExperimental(),
        inbounds: [
          {
            type: 'direct',
            tag: 'direct-in',
            listen: '127.0.0.1',
            listen_port: 20119,
            tcp_fast_open: true,
            tcp_multi_path: false,
            udp_fragment: true,
            network: 'udp',
          },
        ],
      },
      'Restored',
    )

    expect(profile.inbounds).toEqual([
      {
        id: 'in-0',
        type: Inbound.Direct,
        tag: 'direct-in',
        enable: true,
        direct: {
          listen: {
            listen: '127.0.0.1',
            listen_port: 20119,
            tcp_fast_open: true,
            tcp_multi_path: false,
            udp_fragment: true,
          },
          network: 'udp',
        },
      },
    ])
  })
})
