import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  check: vi.fn(), start: vi.fn(), probe: vi.fn(), generate: vi.fn(), replace: vi.fn(),
  remove: vi.fn(), beforeStart: vi.fn(), profile: {} as App.Profile, restored: {} as App.Profile,
}))

vi.mock('@/api/kernel', () => ({
  getProxies: vi.fn().mockResolvedValue({ proxies: {} }),
  getConfigs: vi.fn().mockResolvedValue({ mode: 'rule' }),
  setConfigs: vi.fn(), onLogs: vi.fn(), onMemory: vi.fn(), onConnections: vi.fn(), onTraffic: vi.fn(),
  initWebsocket: vi.fn(), destroyWebsocket: vi.fn(), probeApiAvailability: mocks.probe,
}))
vi.mock('@/bridge', () => ({
  ProcessInfo: vi.fn(), KillProcess: vi.fn().mockResolvedValue(undefined),
  Exec: mocks.check, ExecBackground: mocks.start,
  AbsolutePath: vi.fn(async (path: string) => `/workspace/${path}`),
  FileExists: vi.fn(), MoveFile: vi.fn(), ReadFile: vi.fn().mockResolvedValue('{}'),
  RemoveFile: mocks.remove, WriteFile: vi.fn().mockResolvedValue(undefined),
  FindListeningProcess: vi.fn().mockResolvedValue(123),
}))
vi.mock('@/constant/profile', () => ({ DefaultInboundMixed: vi.fn() }))
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { profile: 'profile', branch: 'Main' } } }),
  useProfilesStore: () => ({ currentProfile: mocks.profile, getProfileById: () => mocks.profile }),
  useSubscribesStore: () => ({ subscribes: [] }),
  useRulesetsStore: () => ({ rulesets: [] }),
  useLogsStore: () => ({
    clearKernelLog: vi.fn(), recordKernelApiLog: vi.fn(), hydrateKernelLogs: vi.fn(), recordKernelLog: vi.fn(),
  }),
  usePluginsStore: () => ({
    onBeforeCoreStartTrigger: mocks.beforeStart,
    onBeforeCoreStopTrigger: vi.fn().mockResolvedValue(undefined),
    onCoreStoppedTrigger: vi.fn().mockResolvedValue(undefined),
    onCoreStartedTrigger: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('@/utils', () => ({
  generateConfigFile: mocks.generate,
  getKernelFileName: () => 'sing-box',
  restoreProfile: () => structuredClone(mocks.restored),
  deepClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
  getKernelRuntimeArgs: () => [], getKernelRuntimeEnv: () => ({}),
  eventBus: { on: vi.fn() }, sleep: vi.fn(), replaceFileWithRollback: mocks.replace,
}))

import { CoreConfigStagedFilePath } from '@/constant/kernel'
import { useKernelApiStore } from '@/stores/kernelApi'

describe('kernel staged configuration integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.profile = {
      id: 'profile', name: 'Profile',
      inbounds: [{ id: 'http', tag: 'http', type: 'http', enable: true, http: { listen: { listen: '127.0.0.1', listen_port: 8080 }, users: [] } }],
      outbounds: [], route: { default_interface: '', rule_set: [] }, dns: { servers: [] },
      experimental: { clash_api: { external_controller: '127.0.0.1:20123' } },
      mixin: {}, script: {},
      native: { endpoints: [{ tag: 'Profile endpoint', type: 'wireguard' }] },
    } as unknown as App.Profile
    mocks.restored = {
      ...structuredClone(mocks.profile),
      native: {
        endpoints: [{ tag: 'Generated subscription endpoint', type: 'wireguard' }],
        dnsServers: [{ tag: 'sub:generated:dns', type: 'udp', server: '1.1.1.1' }],
      },
    }
    mocks.generate.mockImplementation(async (_profile: App.Profile, beforeWrite: (config: unknown) => Promise<unknown>) => {
      await beforeWrite({ endpoints: [{ tag: 'Before plugin', type: 'wireguard' }] })
    })
    mocks.beforeStart.mockImplementation(async (config: unknown) => config)
    mocks.probe.mockResolvedValue(false)
    mocks.check.mockResolvedValue(undefined)
    mocks.start.mockResolvedValue(123)
    mocks.replace.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
  })

  it('annotates the final plugin configuration while keeping the active config untouched on check failure', async () => {
    mocks.beforeStart.mockResolvedValue({ endpoints: [{ tag: 'After plugin', type: 'tailscale', auth_key: 'private-key' }] })
    mocks.check.mockRejectedValue('decode config: endpoints[0]: unknown endpoint type: tailscale')
    const store = useKernelApiStore()

    await expect(store.startCore()).rejects.toThrow('endpoints[0] "After plugin" (tailscale)')

    expect(mocks.check).toHaveBeenCalledWith('data/sing-box/sing-box', expect.arrayContaining(['check']), expect.any(Object))
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenLastCalledWith(CoreConfigStagedFilePath)
    expect(store.starting).toBe(false)
  })

  it.each([true, false])('uses only profile-native entries during an inbound-setting restart (native=%s)', async (hasNative) => {
    if (!hasNative) delete mocks.profile.native
    const store = useKernelApiStore()
    await store.refreshConfig()
    store.running = true
    mocks.probe.mockResolvedValueOnce(false).mockResolvedValue(true)

    await store.updateConfig('http', 9090)

    const regeneratedProfile = mocks.generate.mock.calls[0]![0] as App.Profile
    expect(regeneratedProfile.native).toEqual(mocks.profile.native)
    expect(regeneratedProfile.native?.dnsServers).toBeUndefined()
    expect(regeneratedProfile.inbounds[0]!.http!.listen.listen_port).toBe(9090)
    expect(mocks.replace).toHaveBeenCalledOnce()
    expect(store.running).toBe(true)
  })
})
