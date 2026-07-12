import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

function createKernelProxies() {
  return {
  Proxy: {
    alive: true,
    name: 'Proxy',
    type: 'Selector',
    all: ['HK 01', 'JP 01'],
    now: 'HK 01',
    udp: false,
    history: [],
  },
  'HK 01': {
    alive: true,
    name: 'HK 01',
    type: 'VLESS',
    all: [],
    now: '',
    udp: true,
    history: [{ delay: 80 }],
  },
  'JP 01': {
    alive: true,
    name: 'JP 01',
    type: 'Trojan',
    all: [],
    now: '',
    udp: false,
    history: [],
  },
  }
}

const mocks = vi.hoisted(() => ({
  getProxyDelay: vi.fn(),
  handleUseProxy: vi.fn(),
  refreshProviderProxies: vi.fn(),
  kernelStore: undefined as any,
}))

vi.mock('@/api/kernel', () => ({
  getProxyDelay: mocks.getProxyDelay,
}))

vi.mock('@/bridge', () => ({}))

vi.mock('@/utils/helper', () => ({
  handleUseProxy: mocks.handleUseProxy,
}))

vi.mock('@/stores', async () => {
  const { reactive } = await import('vue')
  mocks.kernelStore ||= reactive({
    running: true,
    config: { mode: 'rule' },
    proxies: createKernelProxies(),
    refreshProviderProxies: mocks.refreshProviderProxies,
  })

  return {
    useKernelApiStore: () => mocks.kernelStore,
    useProfilesStore: () => ({
      currentProfile: {
        route: { final: 'proxy-id' },
        outbounds: [{ id: 'proxy-id', tag: 'Proxy', hidden: false }],
      },
    }),
    useAppSettingsStore: () => ({
      app: {
        kernel: {
          testUrl: 'https://www.gstatic.com/generate_204',
          testTimeout: 5000,
          concurrencyLimit: 1,
        },
      },
    }),
  }
})

import { useNodeController } from '@/views/HomeView/useNodeController'

describe('useNodeController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.refreshProviderProxies.mockResolvedValue(undefined)
    mocks.handleUseProxy.mockResolvedValue(undefined)
    mocks.kernelStore.running = true
    mocks.kernelStore.config.mode = 'rule'
    mocks.kernelStore.proxies = createKernelProxies()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates concurrent refreshes', async () => {
    let resolveRefresh!: () => void
    mocks.refreshProviderProxies.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve
      }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const first = controller.refresh()
    const second = controller.refresh()
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(1)

    resolveRefresh()
    await Promise.all([first, second])
    scope.stop()
  })

  it('keeps the last proxy snapshot and marks it stale after refresh failure', async () => {
    mocks.refreshProviderProxies.mockRejectedValue(new Error('controller offline'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    await expect(controller.refresh()).rejects.toThrow('controller offline')

    expect(mocks.kernelStore.proxies.Proxy.now).toBe('HK 01')
    expect(controller.stale.value).toBe(true)
    expect(controller.refreshError.value).toContain('controller offline')
    scope.stop()
  })

  it('selects the primary group from the last snapshot when modal refresh fails', async () => {
    mocks.refreshProviderProxies.mockRejectedValue(new Error('controller offline'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    await expect(controller.prepareModal()).rejects.toThrow('controller offline')

    expect(controller.selectedGroupName.value).toBe('Proxy')
    expect(controller.nodes.value.map((node) => node.name)).toEqual(['HK 01', 'JP 01'])
    scope.stop()
  })

  it('does not update stale state after its scope is disposed', async () => {
    let rejectRefresh!: (error: Error) => void
    mocks.refreshProviderProxies.mockReturnValue(
      new Promise<void>((_, reject) => {
        rejectRefresh = reject
      }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!

    const refreshing = controller.refresh()
    scope.stop()
    rejectRefresh(new Error('late failure'))
    await expect(refreshing).rejects.toThrow('late failure')

    expect(controller.stale.value).toBe(false)
    expect(controller.refreshError.value).toBe('')
  })

  it('switches only Selector groups and refreshes after success', async () => {
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const result = await controller.switchNode('JP 01')

    expect(result.ok).toBe(true)
    expect(mocks.handleUseProxy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Proxy', type: 'Selector' }),
      expect.objectContaining({ name: 'JP 01' }),
      { refresh: false },
    )
    expect(mocks.refreshProviderProxies).toHaveBeenCalled()
    scope.stop()
  })

  it('does not submit the already-selected node again', async () => {
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const result = await controller.switchNode('HK 01')

    expect(result.ok).toBe(true)
    expect(mocks.handleUseProxy).not.toHaveBeenCalled()
    scope.stop()
  })

  it('blocks concurrent node switches until the active switch settles', async () => {
    let releaseSwitch!: () => void
    mocks.handleUseProxy.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseSwitch = resolve
      }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const first = controller.switchNode('JP 01')
    await Promise.resolve()
    const second = await controller.switchNode('JP 01')

    expect(second).toEqual({ ok: false, error: 'home.nodes.switching' })
    expect(mocks.handleUseProxy).toHaveBeenCalledTimes(1)
    expect(controller.switchingNode.value).toBe('JP 01')

    releaseSwitch()
    await first
    expect(controller.switchingNode.value).toBe('')
    scope.stop()
  })

  it('runs a fresh proxy refresh after a switch waits for an older refresh', async () => {
    let releaseOldRefresh!: () => void
    mocks.refreshProviderProxies
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseOldRefresh = resolve
        }),
      )
      .mockResolvedValue(undefined)
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    controller.selectGroup('Proxy')

    const oldRefresh = controller.refresh()
    const switching = controller.switchNode('JP 01')
    await Promise.resolve()

    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(1)

    releaseOldRefresh()
    await Promise.all([oldRefresh, switching])
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('blocks switching while direct mode is active', async () => {
    mocks.kernelStore.config.mode = 'direct'
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const result = await controller.switchNode('JP 01')

    expect(result).toEqual({ ok: false, error: 'home.nodes.readonly' })
    expect(mocks.handleUseProxy).not.toHaveBeenCalled()
    scope.stop()
  })

  it('records a failed delay after three attempts without exposing 0 ms', async () => {
    mocks.getProxyDelay.mockRejectedValue(new Error('timeout'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    const initialHistoryLength = mocks.kernelStore.proxies['JP 01'].history.length
    mocks.refreshProviderProxies.mockImplementationOnce(async () => {
      expect(mocks.kernelStore.proxies['JP 01'].history).toHaveLength(initialHistoryLength + 1)
      expect(mocks.kernelStore.proxies['JP 01'].history.at(-1)).toEqual({ delay: 0 })
      mocks.kernelStore.proxies['JP 01'].history = [{ delay: 99 }]
    })

    const testing = controller.testNode('JP 01')
    await vi.advanceTimersByTimeAsync(600)
    const result = await testing

    expect(result.ok).toBe(false)
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(3)
    expect(controller.nodeErrors.value.get('JP 01')).toEqual({
      category: 'timeout',
      message: 'timeout',
      attempts: 3,
      maxAttempts: 3,
    })
    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: null,
      delayStatus: 'failed',
      error: { category: 'timeout', attempts: 3 },
    })
    scope.stop()
  })

  it('refreshes proxy state after a single node test', async () => {
    mocks.getProxyDelay.mockResolvedValue({ delay: 65 })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    mocks.refreshProviderProxies.mockClear()
    mocks.refreshProviderProxies.mockImplementationOnce(async () => {
      mocks.kernelStore.proxies['JP 01'].history = []
    })

    const result = await controller.testNode('JP 01')

    expect(result.ok).toBe(true)
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(1)
    expect(controller.nodeAttempts.value.get('JP 01')).toBe(1)
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('keeps a node busy until its trailing refresh finishes', async () => {
    mocks.getProxyDelay.mockResolvedValue({ delay: 65 })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    let resolveRefresh!: () => void
    mocks.refreshProviderProxies.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    )

    const first = controller.testNode('JP 01')
    await Promise.resolve()
    await Promise.resolve()
    const secondTesting = controller.testNode('JP 01')
    await Promise.resolve()
    const callsWhileBlocked = mocks.getProxyDelay.mock.calls.length
    const busyWhileBlocked = controller.testingNodes.value.has('JP 01')

    resolveRefresh()
    const [second] = await Promise.all([secondTesting, first])
    expect(second).toEqual({ ok: false, error: 'home.nodes.alreadyTesting' })
    expect(callsWhileBlocked).toBe(1)
    expect(busyWhileBlocked).toBe(true)
    expect(controller.testingNodes.value.has('JP 01')).toBe(false)

    await controller.testNode('JP 01')
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('clears busy and protection state when a trailing refresh rejects', async () => {
    mocks.getProxyDelay.mockResolvedValue({ delay: 65 })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    mocks.refreshProviderProxies.mockRejectedValueOnce(new Error('refresh failed'))

    await controller.testNode('JP 01')

    expect(controller.testingNodes.value.has('JP 01')).toBe(false)
    mocks.kernelStore.proxies['JP 01'].history = [{ delay: 80 }]
    await controller.refresh()
    expect(controller.nodeAttempts.value.has('JP 01')).toBe(false)
    scope.stop()
  })

  it('clears a local delay error after refresh provides a valid history entry', async () => {
    mocks.getProxyDelay.mockRejectedValue(new Error('timeout'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const testing = controller.testNode('JP 01')
    await vi.advanceTimersByTimeAsync(600)
    await testing
    expect(controller.nodeErrors.value.has('JP 01')).toBe(true)

    mocks.kernelStore.proxies['JP 01'].history = [{ delay: 72 }]
    await controller.refresh()

    expect(controller.nodeErrors.value.has('JP 01')).toBe(false)
    expect(controller.nodeAttempts.value.has('JP 01')).toBe(false)
    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: 72,
      delayStatus: 'success',
    })
    scope.stop()
  })

  it('treats a zero delay response as unavailable', async () => {
    mocks.getProxyDelay.mockResolvedValue({ delay: 0 })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const testing = controller.testNode('JP 01')
    await vi.advanceTimersByTimeAsync(600)
    const result = await testing

    expect(result).toEqual({ ok: false, error: 'home.nodes.unavailable' })
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(3)
    expect(controller.nodeErrors.value.get('JP 01')).toEqual({
      category: 'unknown',
      message: 'home.nodes.unavailable',
      attempts: 3,
      maxAttempts: 3,
    })
    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: null,
      delayStatus: 'failed',
    })
    scope.stop()
  })

  it('retries once, records one successful history entry, and yields to refreshed history', async () => {
    mocks.getProxyDelay
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ delay: 72 })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    const initialHistoryLength = mocks.kernelStore.proxies['JP 01'].history.length
    mocks.refreshProviderProxies.mockImplementationOnce(async () => {
      expect(mocks.kernelStore.proxies['JP 01'].history).toHaveLength(initialHistoryLength + 1)
      expect(mocks.kernelStore.proxies['JP 01'].history.at(-1)).toEqual({ delay: 72 })
    })

    const testing = controller.testNode('JP 01')
    await vi.advanceTimersByTimeAsync(300)
    const result = await testing

    expect(result).toEqual({ ok: true })
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)
    expect(controller.nodeAttempts.value.get('JP 01')).toBe(2)
    expect(controller.nodeErrors.value.has('JP 01')).toBe(false)
    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: 72,
      attempts: 2,
    })

    mocks.refreshProviderProxies.mockImplementationOnce(async () => {
      mocks.kernelStore.proxies['JP 01'].history = [{ delay: 80 }]
    })
    await controller.refresh()

    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: 80,
      attempts: undefined,
    })
    expect(controller.nodeAttempts.value.has('JP 01')).toBe(false)
    scope.stop()
  })

  it('protects only the node whose result joins an in-flight refresh', async () => {
    mocks.getProxyDelay.mockImplementation((name: string) =>
      Promise.resolve({ delay: name === 'JP%2001' ? 72 : 73 }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    await controller.testNode('JP 01')
    expect(controller.nodeAttempts.value.get('JP 01')).toBe(1)

    let resolveRefresh!: () => void
    mocks.refreshProviderProxies.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = () => {
            mocks.kernelStore.proxies['HK 01'].history = [{ delay: 90 }]
            mocks.kernelStore.proxies['JP 01'].history = [{ delay: 91 }]
            resolve()
          }
        }),
    )
    const ordinaryRefresh = controller.refresh()
    const testing = controller.testNode('HK 01')
    await Promise.resolve()
    resolveRefresh()
    await Promise.all([ordinaryRefresh, testing])

    expect(controller.nodeAttempts.value.has('JP 01')).toBe(false)
    expect(controller.nodeAttempts.value.get('HK 01')).toBe(1)
    expect(controller.nodes.value.find((node) => node.name === 'HK 01')).toMatchObject({
      delay: 73,
      attempts: 1,
    })
    scope.stop()
  })

  it('classifies the final connection-refused error after three attempts', async () => {
    mocks.getProxyDelay.mockRejectedValue(new Error('connection refused'))
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const testing = controller.testNode('JP 01')
    await vi.advanceTimersByTimeAsync(600)
    await testing

    expect(controller.nodeErrors.value.get('JP 01')).toEqual({
      category: 'connection-refused',
      message: 'connection refused',
      attempts: 3,
      maxAttempts: 3,
    })
    scope.stop()
  })

  it('cancels queued group tests while allowing the active request to finish', async () => {
    let reject!: (error: Error) => void
    mocks.getProxyDelay.mockImplementation(
      () =>
        new Promise((_, rejectRequest) => {
          reject = rejectRequest
        }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const testing = controller.testGroup()
    await Promise.resolve()
    await Promise.resolve()
    controller.cancelGroupTest()
    reject(new Error('timeout'))
    await testing

    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(1)
    expect(controller.batch.value.cancelled).toBe(true)
    expect(controller.batch.value.completed).toBe(0)
    expect(controller.batch.value.failure).toBe(0)
    scope.stop()
  })

  it('tests each group node only once and records actual attempts', async () => {
    mocks.getProxyDelay.mockImplementation((name: string) =>
      name === 'HK%2001' ? Promise.reject(new Error('timeout')) : Promise.resolve({ delay: 81 }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const testing = controller.testGroup()
    await vi.advanceTimersByTimeAsync(1_000)
    await testing

    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)
    expect(controller.batch.value).toMatchObject({ completed: 2, success: 1, failure: 1 })
    expect(controller.nodeErrors.value.get('HK 01')).toMatchObject({
      category: 'timeout',
      attempts: 1,
      maxAttempts: 1,
    })
    expect(controller.nodeAttempts.value.get('JP 01')).toBe(1)
    scope.stop()
  })

  it('keeps completed group nodes busy through the group trailing refresh', async () => {
    mocks.getProxyDelay.mockResolvedValue({ delay: 70 })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    let resolveRefresh!: () => void
    mocks.refreshProviderProxies.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    )

    const groupTesting = controller.testGroup()
    for (let index = 0; index < 100 && !resolveRefresh; index += 1) {
      await Promise.resolve()
    }
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)
    expect(resolveRefresh).toBeTypeOf('function')
    const singleTesting = controller.testNode('HK 01')
    await Promise.resolve()
    const callsWhileBlocked = mocks.getProxyDelay.mock.calls.length
    const busyWhileBlocked = controller.testingNodes.value.has('HK 01')

    resolveRefresh()
    const [singleResult] = await Promise.all([singleTesting, groupTesting])
    expect(singleResult).toEqual({ ok: false, error: 'home.nodes.alreadyTesting' })
    expect(callsWhileBlocked).toBe(2)
    expect(busyWhileBlocked).toBe(true)
    expect(controller.testingNodes.value.size).toBe(0)

    await controller.testNode('HK 01')
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(3)
    scope.stop()
  })

  it('excludes a busy node from group totals and tests the remaining node', async () => {
    let releaseBusy!: () => void
    mocks.getProxyDelay.mockImplementation((name: string) => {
      if (name === 'HK%2001') {
        return new Promise((resolve) => {
          releaseBusy = () => resolve({ delay: 70 })
        })
      }
      return Promise.resolve({ delay: 71 })
    })
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const singleTesting = controller.testNode('HK 01')
    await Promise.resolve()
    await controller.testGroup()

    expect(controller.batch.value).toMatchObject({
      total: 1,
      completed: 1,
      success: 1,
      running: false,
    })
    expect(mocks.getProxyDelay.mock.calls.map(([name]) => decodeURIComponent(name))).toEqual([
      'HK 01',
      'JP 01',
    ])

    releaseBusy()
    await singleTesting
    scope.stop()
  })

  it('finishes an all-busy group without starting new requests', async () => {
    const releases = new Map<string, () => void>()
    mocks.getProxyDelay.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          releases.set(name, () => resolve({ delay: 70 }))
        }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const hkTesting = controller.testNode('HK 01')
    const jpTesting = controller.testNode('JP 01')
    await Promise.resolve()
    await controller.testGroup()

    expect(controller.batch.value).toMatchObject({
      total: 0,
      completed: 0,
      success: 0,
      failure: 0,
      running: false,
    })
    expect(mocks.getProxyDelay).toHaveBeenCalledTimes(2)

    releases.forEach((release) => release())
    await Promise.all([hkTesting, jpTesting])
    scope.stop()
  })

  it('skips non-testable entries during group tests', async () => {
    mocks.kernelStore.proxies.Proxy.all = [
      'HK 01',
      '🎈 自动选择',
      '剩余流量：959.91 GB',
      'block',
      'JP 01',
    ]
    mocks.kernelStore.proxies['🎈 自动选择'] = {
      alive: true,
      name: '🎈 自动选择',
      type: 'URLTest',
      all: ['HK 01', 'JP 01'],
      now: 'HK 01',
      udp: true,
      history: [],
    }
    mocks.kernelStore.proxies['剩余流量：959.91 GB'] = {
      alive: true,
      name: '剩余流量：959.91 GB',
      type: 'VLESS',
      all: [],
      now: '',
      udp: true,
      history: [],
    }
    mocks.kernelStore.proxies.block = {
      alive: true,
      name: 'block',
      type: 'Reject',
      all: [],
      now: '',
      udp: true,
      history: [],
    }
    mocks.getProxyDelay.mockResolvedValue({ delay: 88 })

    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    await controller.testGroup()

    expect(controller.batch.value.total).toBe(3)
    expect(mocks.getProxyDelay.mock.calls.map(([name]) => decodeURIComponent(name))).toEqual([
      'HK 01',
      '🎈 自动选择',
      'JP 01',
    ])
    scope.stop()
  })

  it('keeps group test delay results when the trailing refresh has stale history', async () => {
    mocks.getProxyDelay.mockImplementation((name: string) =>
      Promise.resolve({ delay: name === 'HK%2001' ? 91 : 92 }),
    )
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()
    mocks.refreshProviderProxies.mockImplementation(async () => {
      mocks.kernelStore.proxies['HK 01'].history = []
      mocks.kernelStore.proxies['JP 01'].history = []
    })

    await controller.testGroup()

    expect(controller.nodes.value).toEqual([
      expect.objectContaining({ name: 'HK 01', delay: 91, delayStatus: 'success' }),
      expect.objectContaining({ name: 'JP 01', delay: 92, delayStatus: 'success' }),
    ])
    scope.stop()
  })

  it('does not call the delay API for a non-testable placeholder node', async () => {
    mocks.kernelStore.proxies['剩余流量：959.91 GB'] = {
      alive: true,
      name: '剩余流量：959.91 GB',
      type: 'VLESS',
      all: [],
      now: '',
      udp: true,
      history: [],
    }
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    await controller.prepareModal()

    const result = await controller.testNode('剩余流量：959.91 GB')

    expect(result).toEqual({ ok: false, error: 'home.nodes.notDelayTestable' })
    expect(mocks.getProxyDelay).not.toHaveBeenCalled()
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('refreshes every five seconds only while running', async () => {
    const scope = effectScope()
    const controller = scope.run(() => useNodeController())!
    controller.startPolling()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(3)

    mocks.kernelStore.running = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.refreshProviderProxies).toHaveBeenCalledTimes(3)
    scope.stop()
  })
})
