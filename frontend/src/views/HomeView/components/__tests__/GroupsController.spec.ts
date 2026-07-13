import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'

import groupsControllerSource from '@/views/HomeView/components/GroupsController.vue?raw'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  refresh: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
  complete: vi.fn(),
  store: undefined as any,
}))

vi.mock('@/views/HomeView/nodeLatencyScheduler', () => ({
  nodeLatencyScheduler: { submit: mocks.submit },
}))
vi.mock('@/bridge', () => ({}))
vi.mock('@/stores', () => {
  mocks.store ||= reactive({
    proxies: {},
    refreshProviderProxies: mocks.refresh,
    refreshConfig: vi.fn(),
  })
  return {
    useKernelApiStore: () => mocks.store,
    useProfilesStore: () => ({ currentProfile: { outbounds: [] } }),
    useAppSettingsStore: () => ({
      app: {
        kernel: {
          testUrl: 'https://probe.test',
          testTimeout: 4321,
          concurrencyLimit: 3,
          unAvailable: true,
          sortByDelay: false,
          cardMode: true,
          cardColumns: 2,
        },
      },
    }),
  }
})
vi.mock('@/utils', () => ({
  buildSmartRegExp: (value: string) => new RegExp(value),
  handleUseProxy: vi.fn(),
  ignoredError: (fn: () => Promise<unknown>) => fn().catch(() => undefined),
  sleep: vi.fn(),
  message: { info: mocks.info, error: mocks.error, warn: mocks.warn, success: vi.fn() },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import GroupsController from '@/views/HomeView/components/GroupsController.vue'

const proxies = () => ({
  Proxy: { name: 'Proxy', type: 'Selector', all: ['HK', 'JP'], now: 'HK', history: [] },
  HK: { name: 'HK', type: 'VLESS', all: [], history: [] as Array<{ delay: number }> },
  JP: { name: 'JP', type: 'Trojan', all: [], history: [] as Array<{ delay: number }> },
})
const summary = (value: Partial<any> = {}) => ({
  total: 1,
  completed: 1,
  success: 1,
  failure: 0,
  retryQueued: 0,
  cancelled: false,
  ...value,
})
const deferredTask = () => {
  let resolve!: (value: any) => void
  const cancel = vi.fn()
  return {
    cancel,
    done: new Promise<any>((done) => {
      resolve = done
    }),
    resolve,
  }
}
const mountController = () =>
  mount(GroupsController, {
    global: {
      stubs: {
        Button: {
          template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
        },
        Card: { template: '<div><slot /></div>' },
        Input: true,
        Switch: true,
        Icon: true,
        Empty: true,
        Transition: false,
        Modal: true,
        Radio: true,
      },
      directives: { tips: {} },
    },
  })
const mountKeepAliveController = () =>
  mount(
    defineComponent({
      components: { GroupsController },
      setup: () => ({ active: ref(true) }),
      template: '<KeepAlive><GroupsController v-if="active" /></KeepAlive>',
    }),
    {
      global: {
        stubs: {
          Button: {
            template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
          },
          Card: { template: '<div><slot /></div>' },
          Input: true,
          Switch: true,
          Icon: true,
          Empty: true,
          Transition: false,
          Modal: true,
          Radio: true,
        },
        directives: { tips: {} },
      },
    },
  )
const expandGroup = async (wrapper: ReturnType<typeof mountController>) => {
  await wrapper.get('.sticky.z-2').trigger('click')
}
const flushTasks = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve()
}

describe('GroupsController latency tasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.store.proxies = proxies()
    mocks.refresh.mockResolvedValue(undefined)
    mocks.store.refreshConfig.mockResolvedValue(undefined)
    mocks.info.mockReturnValue({
      update: mocks.update,
      destroy: mocks.destroy,
      success: mocks.complete,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('submits a group with settings, applies mixed results, reports summary and refreshes once', async () => {
    mocks.submit.mockImplementationOnce((options: any) => {
      expect(options).toMatchObject({
        nodes: ['HK', 'JP'],
        url: 'https://probe.test',
        timeout: 4321,
        concurrency: 3,
      })
      options.onState('HK', 'testing')
      options.onResult({ ok: true, name: 'HK', delay: 61, attempts: 1 })
      options.onState('HK', 'success')
      options.onResult({
        ok: false,
        name: 'JP',
        category: 'timeout',
        message: 'raw timeout',
        attempts: 2,
        maxAttempts: 2,
      })
      options.onState('JP', 'failed')
      return {
        cancel: vi.fn(),
        done: Promise.resolve(summary({ total: 2, completed: 2, success: 1, failure: 1 })),
      }
    })
    const wrapper = mountController()
    await wrapper.get('[data-test="group-delay-Proxy"]').trigger('click')
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())

    expect(mocks.store.proxies.HK.history).toEqual([{ delay: 61 }])
    expect(mocks.store.proxies.JP.history).toEqual([{ delay: 0 }])
    expect(mocks.error).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(mocks.complete).toHaveBeenCalledWith(
        expect.stringMatching(/2 \/ 2.*success: 1 failure: 1/),
      ),
    )
  })

  it('delegates group message close to cancel', async () => {
    const task = deferredTask()
    mocks.submit.mockReturnValueOnce(task)
    const wrapper = mountController()
    await wrapper.get('[data-test="group-delay-Proxy"]').trigger('click')
    const options = mocks.submit.mock.calls[0]![0]
    options.onResult({ ok: true, name: 'HK', delay: 55, attempts: 1 })
    const close = mocks.info.mock.calls[0]![2]
    close()
    expect(task.cancel).toHaveBeenCalledOnce()
    task.resolve(summary({ total: 2, completed: 2, success: 1, cancelled: true }))
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.store.proxies.HK.history).toEqual([{ delay: 55 }])
    expect(mocks.store.proxies.JP.history).toEqual([])
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('destroys a normal completion after three seconds without blocking done or refresh', async () => {
    const task = deferredTask()
    mocks.submit.mockReturnValueOnce(task)
    const wrapper = mountController()
    await wrapper.get('[data-test="group-delay-Proxy"]').trigger('click')
    task.resolve(summary({ total: 2, completed: 2, success: 2 }))

    await flushTasks()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenCalledOnce()
    expect(mocks.destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2999)
    expect(mocks.destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('clears a pending completion destroy timer when unmounted', async () => {
    const task = deferredTask()
    mocks.submit.mockReturnValueOnce(task)
    const wrapper = mountController()
    await wrapper.get('[data-test="group-delay-Proxy"]').trigger('click')
    task.resolve(summary({ total: 2, completed: 2, success: 2 }))
    await flushTasks()
    expect(mocks.complete).toHaveBeenCalledOnce()
    expect(mocks.destroy).not.toHaveBeenCalled()

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.destroy).not.toHaveBeenCalled()
  })

  it('submits a single, writes failure history and toasts the original error with node', async () => {
    delete (mocks.store.proxies.HK as any).history
    mocks.submit.mockImplementationOnce((options: any) => {
      expect(options).toMatchObject({
        nodes: ['HK'],
        url: 'https://probe.test',
        timeout: 4321,
        concurrency: 3,
      })
      options.onResult({
        ok: false,
        name: 'HK',
        category: 'unknown',
        message: 'socket vanished',
        attempts: 1,
        maxAttempts: 1,
      })
      return { cancel: vi.fn(), done: Promise.resolve(summary({ success: 0, failure: 1 })) }
    })
    const wrapper = mountController()
    await expandGroup(wrapper)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.store.proxies.HK.history).toEqual([{ delay: 0 }])
    expect(mocks.error).toHaveBeenCalledWith('socket vanished: HK')
  })

  it('serializes inverse task completion refreshes and preserves both latest results', async () => {
    const hkTask = deferredTask()
    const jpTask = deferredTask()
    const refreshes = [deferredTask(), deferredTask()]
    mocks.submit.mockReturnValueOnce(hkTask).mockReturnValueOnce(jpTask)
    mocks.refresh
      .mockImplementationOnce(async () => {
        mocks.store.proxies = proxies()
        mocks.store.proxies.HK.history.push({ delay: 11 })
        mocks.store.proxies.JP.history.push({ delay: 22 })
        await refreshes[0]!.done
      })
      .mockImplementationOnce(async () => {
        mocks.store.proxies = proxies()
        mocks.store.proxies.HK.history.push({ delay: 11 })
        mocks.store.proxies.JP.history.push({ delay: 22 })
        await refreshes[1]!.done
      })
    const wrapper = mountController()
    await expandGroup(wrapper)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    await wrapper.get('[data-test="proxy-delay-JP"]').trigger('click')
    const [hkOptions, jpOptions] = mocks.submit.mock.calls.map((call) => call[0])
    hkOptions.onResult({ ok: true, name: 'HK', delay: 61, attempts: 1 })
    jpOptions.onResult({
      ok: false,
      name: 'JP',
      category: 'timeout',
      message: 'timeout',
      attempts: 2,
      maxAttempts: 2,
    })

    jpTask.resolve(summary({ success: 0, failure: 1 }))
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
    hkTask.resolve(summary())
    await flushTasks()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    refreshes[0]!.resolve(undefined)
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
    refreshes[1]!.resolve(undefined)
    await vi.waitFor(() => {
      expect(mocks.store.proxies.HK.history).toEqual([{ delay: 11 }, { delay: 61 }])
      expect(mocks.store.proxies.JP.history).toEqual([{ delay: 22 }, { delay: 0 }])
    })
    expect(mocks.store.proxies.JP.history.filter(({ delay }: any) => delay === 0)).toHaveLength(1)
  })

  it('replays an active task result after a manual refresh replaces the snapshot', async () => {
    const task = deferredTask()
    mocks.submit.mockReturnValueOnce(task)
    mocks.refresh.mockImplementationOnce(async () => {
      mocks.store.proxies = proxies()
      mocks.store.proxies.HK.history.push({ delay: 11 })
    })
    const wrapper = mountController()
    await expandGroup(wrapper)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    mocks.submit.mock.calls[0]![0].onResult({ ok: true, name: 'HK', delay: 61, attempts: 1 })

    await wrapper.get('button[icon="refresh"]').trigger('click')
    await flushTasks()

    expect(mocks.store.proxies.HK.history).toEqual([{ delay: 11 }, { delay: 61 }])
    task.resolve(summary())
  })

  it('replays an active task result after activation refresh replaces the snapshot', async () => {
    const task = deferredTask()
    mocks.submit.mockReturnValueOnce(task)
    const wrapper = mountKeepAliveController()
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    mocks.refresh.mockClear()
    await expandGroup(wrapper.getComponent(GroupsController) as any)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    mocks.submit.mock.calls[0]![0].onResult({ ok: true, name: 'HK', delay: 73, attempts: 1 })
    ;(wrapper.vm as any).active = false
    await wrapper.vm.$nextTick()
    mocks.refresh.mockImplementationOnce(async () => {
      mocks.store.proxies = proxies()
      mocks.store.proxies.HK.history.push({ delay: 12 })
    })

    ;(wrapper.vm as any).active = true
    await wrapper.vm.$nextTick()
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())

    await vi.waitFor(() =>
      expect(mocks.store.proxies.HK.history).toEqual([{ delay: 12 }, { delay: 73 }]),
    )
    task.resolve(summary())
  })

  it.each(['queued', 'testing', 'retry-queued'] as const)(
    'holds busy while a node is %s',
    async (phase) => {
      const task = deferredTask()
      mocks.submit.mockReturnValueOnce(task)
      const wrapper = mountController()
      await expandGroup(wrapper)
      await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
      mocks.submit.mock.calls[0]![0].onState?.('HK', phase)
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-test="proxy-delay-HK"]').attributes('loading')).toBe('true')
      task.resolve(summary())
    },
  )

  it.each(['success', 'failed'] as const)(
    'holds terminal %s busy until trailing refresh completes',
    async (phase) => {
      const task = deferredTask()
      let releaseRefresh!: () => void
      mocks.submit.mockReturnValueOnce(task)
      mocks.refresh.mockReturnValueOnce(
        new Promise<void>((done) => {
          releaseRefresh = done
        }),
      )
      const wrapper = mountController()
      await expandGroup(wrapper)
      await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
      mocks.submit.mock.calls[0]![0].onState?.('HK', phase)
      task.resolve(
        summary({ success: phase === 'success' ? 1 : 0, failure: phase === 'failed' ? 1 : 0 }),
      )
      await Promise.resolve()
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-test="proxy-delay-HK"]').attributes('loading')).toBe('true')
      releaseRefresh()
      await vi.waitFor(() =>
        expect(wrapper.get('[data-test="proxy-delay-HK"]').attributes('loading')).toBe('false'),
      )
    },
  )

  it('holds cancelled nodes busy until their single trailing refresh completes', async () => {
    const task = deferredTask()
    let releaseRefresh!: () => void
    mocks.submit.mockReturnValueOnce(task)
    mocks.refresh.mockReturnValueOnce(
      new Promise<void>((done) => {
        releaseRefresh = done
      }),
    )
    const wrapper = mountController()
    await expandGroup(wrapper)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    mocks.submit.mock.calls[0]![0].onState?.('HK', 'cancelled')
    task.resolve(summary({ success: 0, cancelled: true }))
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-test="proxy-delay-HK"]').attributes('loading')).toBe('true')
    releaseRefresh()
    await vi.waitFor(() =>
      expect(wrapper.get('[data-test="proxy-delay-HK"]').attributes('loading')).toBe('false'),
    )
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('releases busy ownership when the trailing refresh rejects', async () => {
    const task = deferredTask()
    mocks.submit.mockReturnValueOnce(task)
    mocks.refresh.mockRejectedValueOnce(new Error('refresh unavailable'))
    const wrapper = mountController()
    await expandGroup(wrapper)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    task.resolve(summary())

    await flushTasks()
    await wrapper.vm.$nextTick()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-test="proxy-delay-HK"]').attributes('loading')).toBe('false')
  })

  it('cancels all handles on dispose and ignores late callbacks and refresh', async () => {
    const tasks = [deferredTask(), deferredTask()]
    mocks.submit.mockReturnValueOnce(tasks[0]).mockReturnValueOnce(tasks[1])
    const wrapper = mountController()
    await expandGroup(wrapper)
    await wrapper.get('[data-test="proxy-delay-HK"]').trigger('click')
    await wrapper.get('[data-test="group-delay-Proxy"]').trigger('click')
    const options = mocks.submit.mock.calls.map((call) => call[0])
    wrapper.unmount()
    expect(tasks.every((task) => task.cancel.mock.calls.length === 1)).toBe(true)
    options.forEach((option) => option.onResult({ ok: true, name: 'HK', delay: 99, attempts: 1 }))
    tasks[0]!.resolve(summary({ total: 2, completed: 2 }))
    tasks[1]!.resolve(summary())
    await Promise.all(tasks.map((task) => task.done))
    await Promise.resolve()
    expect(mocks.store.proxies.HK.history).toEqual([])
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('keeps direct probing and async pooling outside the component boundary', () => {
    expect(groupsControllerSource).not.toContain('getProxy' + 'Delay')
    expect(groupsControllerSource).not.toContain('createAsync' + 'Pool')
    expect(groupsControllerSource.match(/refreshProviderProxies/g)).toHaveLength(1)
  })
})
