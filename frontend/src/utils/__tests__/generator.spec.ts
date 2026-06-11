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
  DefaultLog,
  DefaultMixin,
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { generateConfig } from '@/utils/generator'

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
})
