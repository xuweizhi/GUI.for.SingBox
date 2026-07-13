import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

const proxies = () => ({
  Proxy: {
    alive: true,
    name: 'Proxy',
    type: 'Selector',
    all: ['HK 01', 'JP 01'],
    now: 'HK 01',
    udp: false,
    history: [] as Array<{ delay: number }>,
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
    history: [] as Array<{ delay: number }>,
  },
})

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  handleUseProxy: vi.fn(),
  refresh: vi.fn(),
  store: undefined as any,
}))

vi.mock('@/views/HomeView/nodeLatencyScheduler', () => ({
  nodeLatencyScheduler: { submit: mocks.submit },
}))
vi.mock('@/bridge', () => ({}))
vi.mock('@/utils/helper', () => ({ handleUseProxy: mocks.handleUseProxy }))
vi.mock('@/stores', () => {
  mocks.store ||= reactive({
    running: true,
    config: { mode: 'rule' },
    proxies: {},
    refreshProviderProxies: mocks.refresh,
  })
  return {
    useKernelApiStore: () => mocks.store,
    useProfilesStore: () => ({
      currentProfile: {
        route: { final: 'proxy-id' },
        outbounds: [{ id: 'proxy-id', tag: 'Proxy', hidden: false }],
      },
    }),
    useAppSettingsStore: () => ({
      app: { kernel: { testUrl: 'test-url', testTimeout: 5000, concurrencyLimit: 7 } },
    }),
  }
})

import { useNodeController } from '@/views/HomeView/useNodeController'

const summary = (values: Partial<any> = {}) => ({
  total: 1,
  completed: 1,
  success: 1,
  failure: 0,
  retryQueued: 0,
  cancelled: false,
  ...values,
})
const successSubmit = (options: any) => {
  options.nodes.forEach((name: string) => {
    options.onState?.(name, 'queued')
    options.onState?.(name, 'testing')
    options.onResult?.({ ok: true, name, delay: name === 'HK 01' ? 70 : 71, attempts: 1 })
    options.onState?.(name, 'success')
  })
  return {
    cancel: vi.fn(),
    done: Promise.resolve(
      summary({
        total: options.nodes.length,
        completed: options.nodes.length,
        success: options.nodes.length,
      }),
    ),
  }
}

describe('useNodeController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.store.running = true
    mocks.store.config.mode = 'rule'
    mocks.store.proxies = proxies()
    mocks.refresh.mockResolvedValue(undefined)
    mocks.handleUseProxy.mockResolvedValue(undefined)
    mocks.submit.mockImplementation(successSubmit)
  })
  afterEach(() => vi.useRealTimers())

  it('deduplicates refresh and records refresh failure without losing snapshot', async () => {
    let resolve!: () => void
    mocks.refresh.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done
      }),
    )
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    const a = controller.refresh()
    const b = controller.refresh()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    resolve()
    await Promise.all([a, b])
    mocks.refresh.mockRejectedValueOnce(new Error('offline'))
    await expect(controller.refresh()).rejects.toThrow('offline')
    expect(controller.stale.value).toBe(true)
    expect(controller.refreshError.value).toContain('offline')
    expect(mocks.store.proxies.Proxy.now).toBe('HK 01')
    scope.stop()
  })

  it('prepares from the snapshot even when refresh fails', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('offline'))
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    await expect(controller.prepareModal()).rejects.toThrow('offline')
    expect(controller.selectedGroupName.value).toBe('Proxy')
    scope.stop()
  })

  it('switches selectors once and refreshes after mutation', async () => {
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    expect(await controller.switchNode('JP 01')).toEqual({ ok: true })
    expect(mocks.handleUseProxy).toHaveBeenCalledOnce()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(await controller.switchNode('HK 01')).toEqual({ ok: true })
    expect(mocks.handleUseProxy).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('blocks readonly and concurrent switches', async () => {
    let release!: () => void
    mocks.handleUseProxy.mockReturnValueOnce(
      new Promise<void>((done) => {
        release = done
      }),
    )
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    const first = controller.switchNode('JP 01')
    await Promise.resolve()
    expect(await controller.switchNode('JP 01')).toEqual({
      ok: false,
      error: 'home.nodes.switching',
    })
    release()
    await first
    mocks.store.config.mode = 'direct'
    expect(await controller.switchNode('JP 01')).toEqual({
      ok: false,
      error: 'home.nodes.readonly',
    })
    scope.stop()
  })

  it('submits single and group tests through the same configured contract', async () => {
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    await controller.testNode('JP 01')
    await controller.testGroup()
    expect(mocks.submit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ nodes: ['JP 01'], url: 'test-url', timeout: 5000, concurrency: 7 }),
    )
    expect(mocks.submit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nodes: ['HK 01', 'JP 01'],
        url: 'test-url',
        timeout: 5000,
        concurrency: 7,
      }),
    )
    scope.stop()
  })

  it('maps successful actual attempts and refreshes exactly once', async () => {
    mocks.submit.mockImplementationOnce((options: any) => {
      options.onResult({ ok: true, name: 'JP 01', delay: 72, attempts: 2 })
      return { cancel: vi.fn(), done: Promise.resolve(summary()) }
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    expect(await controller.testNode('JP 01')).toEqual({ ok: true })
    expect(controller.nodeAttempts.value.get('JP 01')).toBe(2)
    expect(mocks.store.proxies['JP 01'].history.at(-1)).toEqual({ delay: 72 })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('maps final failure and preserves its original message', async () => {
    mocks.submit.mockImplementationOnce((options: any) => {
      options.onResult({
        ok: false,
        name: 'JP 01',
        category: 'timeout',
        message: 'timed out',
        attempts: 2,
        maxAttempts: 2,
      })
      return { cancel: vi.fn(), done: Promise.resolve(summary({ success: 0, failure: 1 })) }
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    expect(await controller.testNode('JP 01')).toEqual({ ok: false, error: 'timed out' })
    expect(controller.nodeErrors.value.get('JP 01')).toEqual({
      category: 'timeout',
      message: 'timed out',
      attempts: 2,
      maxAttempts: 2,
    })
    expect(mocks.store.proxies['JP 01'].history.at(-1)).toEqual({ delay: 0 })
    scope.stop()
  })

  it('returns unavailable for a completed task without result and canceled only for cancellation', async () => {
    mocks.submit
      .mockReturnValueOnce({ cancel: vi.fn(), done: Promise.resolve(summary({ success: 0 })) })
      .mockReturnValueOnce({
        cancel: vi.fn(),
        done: Promise.resolve(summary({ success: 0, cancelled: true })),
      })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    expect(await controller.testNode('JP 01')).toEqual({
      ok: false,
      error: 'home.nodes.unavailable',
    })
    expect(await controller.testNode('JP 01')).toEqual({ ok: false, error: 'common.canceled' })
    scope.stop()
  })

  it('refreshes exactly once after a cancelled single task settles', async () => {
    mocks.submit.mockReturnValueOnce({
      cancel: vi.fn(),
      done: Promise.resolve(summary({ success: 0, cancelled: true })),
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!

    expect(await controller.testNode('JP 01')).toEqual({ ok: false, error: 'common.canceled' })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('tracks queued, testing, and retry phases as busy', async () => {
    let options!: any
    let resolve!: (value: any) => void
    mocks.submit.mockImplementationOnce((value: any) => {
      options = value
      return {
        cancel: vi.fn(),
        done: new Promise((done) => {
          resolve = done
        }),
      }
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    const testing = controller.testNode('JP 01')
    for (const phase of ['queued', 'testing', 'retry-queued']) {
      options.onState('JP 01', phase)
      expect(controller.testingNodes.value.has('JP 01')).toBe(true)
    }
    options.onResult({ ok: true, name: 'JP 01', delay: 1, attempts: 2 })
    options.onState('JP 01', 'success')
    resolve(summary())
    await testing
    expect(controller.nodePhases.value.get('JP 01')).toBe('success')
    scope.stop()
  })

  it('keeps local result and busy state through a stale trailing refresh', async () => {
    let release!: () => void
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = () => {
            mocks.store.proxies['JP 01'].history = []
            done()
          }
        }),
    )
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    const testing = controller.testNode('JP 01')
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.testingNodes.value.has('JP 01')).toBe(true)
    expect(controller.nodes.value.find((node) => node.name === 'JP 01')).toMatchObject({
      delay: 71,
    })
    release()
    await testing
    expect(controller.nodeAttempts.value.get('JP 01')).toBe(1)
    scope.stop()
  })

  it('cleans busy and protection after trailing refresh failure', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('refresh failed'))
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    expect(await controller.testNode('JP 01')).toEqual({ ok: true })
    expect(controller.testingNodes.value.has('JP 01')).toBe(false)
    mocks.store.proxies['JP 01'].history = [{ delay: 80 }]
    await controller.refresh()
    expect(controller.nodeAttempts.value.has('JP 01')).toBe(false)
    scope.stop()
  })

  it('maps mixed group results and drives batch from summary', async () => {
    mocks.submit.mockImplementationOnce((options: any) => {
      options.onResult({ ok: true, name: 'HK 01', delay: 62, attempts: 2 })
      options.onResult({
        ok: false,
        name: 'JP 01',
        category: 'connection-refused',
        message: 'refused',
        attempts: 2,
        maxAttempts: 2,
      })
      return {
        cancel: vi.fn(),
        done: Promise.resolve(summary({ total: 2, completed: 2, success: 1, failure: 1 })),
      }
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    await controller.testGroup()
    expect(controller.nodeAttempts.value.get('HK 01')).toBe(2)
    expect(mocks.store.proxies['JP 01'].history.at(-1)).toEqual({ delay: 0 })
    expect(controller.nodeErrors.value.get('JP 01')).toMatchObject({
      category: 'connection-refused',
      attempts: 2,
    })
    expect(controller.batch.value).toMatchObject({ completed: 2, success: 1, failure: 1 })
    scope.stop()
  })

  it('delegates group cancellation and does not count cancellation as failure', async () => {
    let resolve!: (value: any) => void
    const cancel = vi.fn()
    mocks.submit.mockReturnValueOnce({
      cancel,
      done: new Promise((done) => {
        resolve = done
      }),
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    const testing = controller.testGroup()
    controller.cancelGroupTest()
    expect(cancel).toHaveBeenCalledOnce()
    resolve(summary({ total: 2, completed: 2, success: 0, failure: 0, cancelled: true }))
    await testing
    expect(controller.batch.value).toMatchObject({ cancelled: true, failure: 0 })
    scope.stop()
  })

  it('filters busy and non-testable group nodes and handles all-busy groups', async () => {
    mocks.store.proxies.Proxy.all = ['HK 01', '剩余流量：1 GB', 'JP 01']
    mocks.store.proxies['剩余流量：1 GB'] = {
      alive: true,
      name: '剩余流量：1 GB',
      type: 'VLESS',
      all: [],
      now: '',
      udp: true,
      history: [],
    }
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    controller.testingNodes.value.add('HK 01')
    await controller.testGroup()
    expect(mocks.submit.mock.calls[0]![0].nodes).toEqual(['JP 01'])
    mocks.submit.mockClear()
    controller.testingNodes.value.add('JP 01')
    await controller.testGroup()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(controller.batch.value.total).toBe(0)
    scope.stop()
  })

  it('rejects missing, non-testable, and busy single nodes synchronously', async () => {
    mocks.store.proxies['剩余流量：1 GB'] = {
      alive: true,
      name: '剩余流量：1 GB',
      type: 'VLESS',
      all: [],
      now: '',
      udp: true,
      history: [],
    }
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.testingNodes.value.add('JP 01')
    expect(await controller.testNode('missing')).toEqual({
      ok: false,
      error: 'home.nodes.nodeMissing',
    })
    expect(await controller.testNode('剩余流量：1 GB')).toEqual({
      ok: false,
      error: 'home.nodes.notDelayTestable',
    })
    expect(await controller.testNode('JP 01')).toEqual({
      ok: false,
      error: 'home.nodes.alreadyTesting',
    })
    expect(mocks.submit).not.toHaveBeenCalled()
    scope.stop()
  })

  it('cancels all handles on dispose and ignores late state, result, and summary', async () => {
    const tasks: any[] = []
    mocks.submit.mockImplementation((options: any) => {
      let resolve!: (value: any) => void
      const task = { options, cancel: vi.fn(), resolve: (value: any) => resolve(value) }
      tasks.push(task)
      return {
        cancel: task.cancel,
        done: new Promise((done) => {
          resolve = done
        }),
      }
    })
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    const single = controller.testNode('JP 01')
    const group = controller.testGroup()
    scope.stop()
    expect(tasks).toHaveLength(2)
    expect(tasks.every((task) => task.cancel.mock.calls.length === 1)).toBe(true)
    const history = mocks.store.proxies['JP 01'].history.length
    tasks.forEach((task) => {
      task.options.onState?.('JP 01', 'testing')
      task.options.onResult?.({ ok: true, name: 'JP 01', delay: 99, attempts: 1 })
      task.resolve(
        summary({
          total: task.options.nodes.length,
          completed: task.options.nodes.length,
          cancelled: true,
        }),
      )
    })
    await Promise.all([single, group])
    expect(controller.nodePhases.value.size).toBe(0)
    expect(mocks.store.proxies['JP 01'].history).toHaveLength(history)
    expect(controller.batch.value.running).toBe(true)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('keeps a completed group node owned until the group trailing refresh ends', async () => {
    let options!: any
    let finish!: (value: any) => void
    mocks.submit.mockImplementationOnce((value: any) => {
      options = value
      return {
        cancel: vi.fn(),
        done: new Promise((resolve) => {
          finish = resolve
        }),
      }
    })
    let releaseRefresh!: () => void
    mocks.refresh.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseRefresh = resolve
      }),
    )
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.selectGroup('Proxy')
    const group = controller.testGroup()
    options.onResult({ ok: true, name: 'HK 01', delay: 60, attempts: 1 })
    options.onState('HK 01', 'success')
    finish(summary({ total: 2, completed: 2, success: 1 }))
    await Promise.resolve()
    await Promise.resolve()

    expect(await controller.testNode('HK 01')).toEqual({
      ok: false,
      error: 'home.nodes.alreadyTesting',
    })
    releaseRefresh()
    await group
    expect(controller.testingNodes.value.has('HK 01')).toBe(false)
    scope.stop()
  })

  it('polls every five seconds only while running', async () => {
    const scope = effectScope()
    const controller = scope.run(useNodeController)!
    controller.startPolling()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
    mocks.store.running = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
    scope.stop()
  })
})
