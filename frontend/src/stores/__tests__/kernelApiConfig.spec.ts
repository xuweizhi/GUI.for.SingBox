import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (value: any) => void>(),
  groups: [] as App.NodeGroup[],
  check: vi.fn(),
  start: vi.fn(),
  probe: vi.fn(),
  generate: vi.fn(),
  replace: vi.fn(),
  stoppedHook: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
  beforeStart: vi.fn(),
  profile: {} as App.Profile,
  restored: {} as App.Profile,
}))

vi.mock('@/api/kernel', () => ({
  getProxies: vi.fn().mockResolvedValue({ proxies: {} }),
  getConfigs: vi.fn().mockResolvedValue({ mode: 'rule' }),
  setConfigs: vi.fn(),
  onLogs: vi.fn(),
  onMemory: vi.fn(),
  onConnections: vi.fn(),
  onTraffic: vi.fn(),
  initWebsocket: vi.fn(),
  destroyWebsocket: vi.fn(),
  probeApiAvailability: mocks.probe,
}))
vi.mock('@/bridge', () => ({
  ProcessInfo: vi.fn(),
  KillProcess: vi.fn().mockResolvedValue(undefined),
  Exec: mocks.check,
  ExecBackground: mocks.start,
  AbsolutePath: vi.fn(async (path: string) => `/workspace/${path}`),
  FileExists: vi.fn(),
  MoveFile: vi.fn(),
  ReadFile: vi.fn().mockResolvedValue('{}'),
  RemoveFile: mocks.remove,
  WriteFile: vi.fn().mockResolvedValue(undefined),
  FindListeningProcess: vi.fn().mockResolvedValue(123),
}))
vi.mock('@/constant/profile', () => ({ DefaultInboundMixed: vi.fn() }))
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { profile: 'profile', branch: 'Main' } } }),
  useProfilesStore: () => ({ currentProfile: mocks.profile, getProfileById: () => mocks.profile }),
  useNodeGroupsStore: () => ({ nodeGroups: mocks.groups }),
  useSubscribesStore: () => ({ subscribes: [] }),
  useRulesetsStore: () => ({ rulesets: [] }),
  useLogsStore: () => ({
    clearKernelLog: vi.fn(),
    recordKernelApiLog: vi.fn(),
    hydrateKernelLogs: vi.fn(),
    recordKernelLog: vi.fn(),
  }),
  usePluginsStore: () => ({
    onBeforeCoreStartTrigger: mocks.beforeStart,
    onBeforeCoreStopTrigger: vi.fn().mockResolvedValue(undefined),
    onCoreStoppedTrigger: mocks.stoppedHook,
    onCoreStartedTrigger: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('@/utils', () => ({
  generateConfigFile: mocks.generate,
  getKernelFileName: () => 'sing-box',
  restoreProfile: () => structuredClone(mocks.restored),
  deepClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
  getKernelRuntimeArgs: () => [],
  getKernelRuntimeEnv: () => ({}),
  eventBus: {
    on: (event: string, listener: (value: any) => void) => mocks.handlers.set(event, listener),
  },
  sleep: vi.fn(),
  replaceFileWithRollback: mocks.replace,
}))

import { getConfigs } from '@/api/kernel'
import { KillProcess } from '@/bridge'
import { CoreConfigStagedFilePath } from '@/constant/kernel'
import { useKernelApiStore } from '@/stores/kernelApi'
import { sleep } from '@/utils'

describe('kernel staged configuration integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.groups.splice(0)
    vi.mocked(getConfigs)
      .mockReset()
      .mockResolvedValue({ mode: 'rule' } as any)
    vi.mocked(sleep).mockReset()
    setActivePinia(createPinia())
    mocks.profile = {
      id: 'profile',
      name: 'Profile',
      inbounds: [
        {
          id: 'http',
          tag: 'http',
          type: 'http',
          enable: true,
          http: { listen: { listen: '127.0.0.1', listen_port: 8080 }, users: [] },
        },
      ],
      outbounds: [],
      route: { default_interface: '', rule_set: [] },
      dns: { servers: [] },
      experimental: { clash_api: { external_controller: '127.0.0.1:20123' } },
      mixin: {},
      script: {},
      native: { endpoints: [{ tag: 'Profile endpoint', type: 'wireguard' }] },
    } as unknown as App.Profile
    mocks.restored = {
      ...structuredClone(mocks.profile),
      native: {
        endpoints: [{ tag: 'Generated subscription endpoint', type: 'wireguard' }],
        dnsServers: [{ tag: 'sub:generated:dns', type: 'udp', server: '1.1.1.1' }],
      },
    }
    mocks.generate.mockImplementation(
      async (_profile: App.Profile, beforeWrite: (config: unknown) => Promise<unknown>) => {
        await beforeWrite({ endpoints: [{ tag: 'Before plugin', type: 'wireguard' }] })
      },
    )
    mocks.beforeStart.mockImplementation(async (config: unknown) => config)
    mocks.probe.mockResolvedValue(false)
    mocks.check.mockResolvedValue(undefined)
    mocks.start.mockResolvedValue(123)
    mocks.replace.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
  })

  it('annotates the final plugin configuration while keeping the active config untouched on check failure', async () => {
    mocks.beforeStart.mockResolvedValue({
      endpoints: [{ tag: 'After plugin', type: 'tailscale', auth_key: 'private-key' }],
    })
    mocks.check.mockRejectedValue('decode config: endpoints[0]: unknown endpoint type: tailscale')
    const store = useKernelApiStore()

    await expect(store.startCore()).rejects.toThrow('endpoints[0] "After plugin" (tailscale)')

    expect(mocks.check).toHaveBeenCalledWith(
      'data/sing-box/sing-box',
      expect.arrayContaining(['check']),
      expect.any(Object),
    )
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenLastCalledWith(CoreConfigStagedFilePath)
    expect(store.starting).toBe(false)
  })

  it.each([true, false])(
    'uses only profile-native entries during an inbound-setting restart (native=%s)',
    async (hasNative) => {
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
    },
  )
  it.each(['immediate', 'waiting', 'readiness', 'refresh'])(
    'rejects a core exit during %s and allows a clean retry',
    async (stage) => {
      let exit: (message: string) => Promise<void>
      mocks.start.mockImplementationOnce(async (...args: any[]) => {
        exit = args[3]
        if (stage === 'immediate') await exit('process exited')
        return 123
      })
      mocks.probe
        .mockReset()
        .mockResolvedValueOnce(false)
        .mockImplementation(async () => {
          if (stage === 'readiness') await exit('process exited')
          return stage !== 'waiting'
        })
      vi.mocked(sleep).mockImplementationOnce(async () => {
        await exit('process exited')
      })
      if (stage === 'refresh')
        vi.mocked(getConfigs).mockImplementationOnce(async () => {
          await exit('process exited')
          return { mode: 'rule' } as any
        })
      const store = useKernelApiStore()
      await expect(store.startCore()).rejects.toBeDefined()
      expect(store.running).toBe(false)
      expect(store.pid).toBe(-1)
      expect(store.starting).toBe(false)
      expect(mocks.stoppedHook).toHaveBeenCalledOnce()
      const previousExit = exit!
      mocks.probe.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true)
      mocks.start.mockResolvedValue(456)
      await store.startCore()
      await previousExit('late callback from first attempt')
      expect(store.running).toBe(true)
      expect(store.pid).toBe(456)
    },
  )

  it('cleans up a failed final API initialization before retrying', async () => {
    mocks.probe.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true)
    vi.mocked(getConfigs).mockRejectedValueOnce(new Error('connection refused'))
    const store = useKernelApiStore()
    await expect(store.startCore()).rejects.toThrow('connection refused')
    expect(store.running).toBe(false)
    expect(store.pid).toBe(-1)
    mocks.probe.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true)
    await store.startCore()
    expect(store.running).toBe(true)
  })

  it('invalidates direct, individual-node and structural dynamic-group dependencies', () => {
    const store = useKernelApiStore()
    store.running = true
    mocks.groups.push(
      {
        id: 'manual',
        mode: 'manual',
        members: [{ subscription_id: 's', node_id: 'n' }],
      } as App.NodeGroup,
      { id: 'all', mode: 'filter', source_scope: 'all' } as App.NodeGroup,
      {
        id: 'selected',
        mode: 'filter',
        source_scope: 'selected',
        subscription_ids: ['s'],
      } as App.NodeGroup,
    )
    for (const member of [
      { type: 'Subscription', id: 's' },
      { type: 's', id: 'n' },
      ...['manual', 'all', 'selected'].map((id) => ({ type: 'NodeGroup', id })),
    ]) {
      mocks.profile.outbounds = [{ outbounds: [member] }] as App.Outbound[]
      store.needRestart = false
      mocks.handlers.get('subscriptionChange')!({ id: 's' })
      expect(store.needRestart).toBe(true)
      store.needRestart = false
      mocks.handlers.get('subscriptionsChange')!({ ids: ['s'] })
      expect(store.needRestart).toBe(true)
    }
    mocks.profile.outbounds = [
      { outbounds: [{ type: 'NodeGroup', id: 'selected' }] },
    ] as App.Outbound[]
    store.needRestart = false
    mocks.handlers.get('subscriptionChange')!({ id: 'unrelated' })
    expect(store.needRestart).toBe(false)
    mocks.handlers.get('nodeGroupChange')!({ id: 'selected' })
    expect(store.needRestart).toBe(true)
    mocks.profile.outbounds = [{ outbounds: [{ type: 'NodeGroup', id: 'all' }] }] as App.Outbound[]
    store.needRestart = false
    mocks.handlers.get('subscriptionChange')!({ id: 'newly-added-or-deleted' })
    expect(store.needRestart).toBe(true)
  })

  it('cleans up the spawned PID on readiness timeout and emits stop only once for a late exit', async () => {
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    let exit: (message: string) => Promise<void>
    mocks.start.mockImplementationOnce(async (...args: any[]) => {
      exit = args[3]
      return 123
    })
    mocks.probe.mockResolvedValue(false)
    vi.mocked(sleep).mockImplementation(async () => {
      now = 31_000
    })
    try {
      const store = useKernelApiStore()
      await expect(store.startCore()).rejects.toContain('timed out')
      expect(KillProcess).toHaveBeenCalledWith(123, 3)
      expect(store.running).toBe(false)
      expect(store.pid).toBe(-1)
      await exit!('late exit')
      expect(mocks.stoppedHook).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }
  })
})
