import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

const appStoreMock = vi.hoisted(() => ({
  modalStack: [] as (() => MaybePromise<void>)[],
}))
vi.mock('@/stores', () => ({
  useAppStore: () => appStoreMock,
}))

describe('useAppLifecycle', () => {
  beforeEach(() => {
    appStoreMock.modalStack.splice(0)
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
