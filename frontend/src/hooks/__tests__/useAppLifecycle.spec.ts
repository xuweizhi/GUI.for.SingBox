import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appStoreMock = vi.hoisted(() => ({
  modalStack: [] as (() => MaybePromise<void>)[],
}))
const offMocks = vi.hoisted(() => [vi.fn(), vi.fn(), vi.fn()])

vi.mock('@/bridge', () => ({
  EventsOn: vi.fn((event: string) => {
    const index = ['onLaunchApp', 'onBeforeExitApp', 'onExitApp'].indexOf(event)
    return offMocks[index]
  }),
  WindowHide: vi.fn(),
}))

vi.mock('@/stores', () => ({
  useAppStore: () => appStoreMock,
  useAppSettingsStore: () => ({ app: { exitOnClose: false } }),
  useSubscribesStore: () => ({ importSubscribe: vi.fn() }),
}))

vi.mock('@/utils', () => ({
  exitApp: vi.fn(),
  message: { error: vi.fn(), success: vi.fn() },
  sampleID: vi.fn(() => 'id'),
}))

describe('useAppLifecycle', () => {
  beforeEach(() => {
    appStoreMock.modalStack.splice(0)
    offMocks.forEach((off) => off.mockReset())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mountLifecycle = async () => {
    const { useAppLifecycle } = await import('@/hooks/useAppLifecycle')
    return mount(
      defineComponent({
        setup() {
          useAppLifecycle()
          return () => null
        },
      }),
    )
  }

  it('reports rejected Escape close promises without an unhandled rejection', async () => {
    const error = new Error('close failed')
    appStoreMock.modalStack.push(vi.fn(() => Promise.reject(error)))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    const wrapper = await mountLifecycle()
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()

      expect(consoleError).toHaveBeenCalledWith(error)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
      window.removeEventListener('unhandledrejection', unhandled)
    }

    expect(offMocks.every((off) => off.mock.calls.length === 1)).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(appStoreMock.modalStack[0]).toHaveBeenCalledOnce()
  })

  it('reports synchronous Escape close errors', async () => {
    const error = new Error('sync close failed')
    appStoreMock.modalStack.push(
      vi.fn(() => {
        throw error
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wrapper = await mountLifecycle()
    try {
      expect(() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
      ).not.toThrow()
      await flushPromises()
      expect(consoleError).toHaveBeenCalledWith(error)
    } finally {
      wrapper.unmount()
    }
  })
})
