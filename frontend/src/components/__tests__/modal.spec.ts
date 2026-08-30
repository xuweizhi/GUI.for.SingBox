/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onUnmounted } from 'vue'

const appStoreMock = vi.hoisted(() => ({
  modalMinimized: [] as {
    id: string
    title: () => string
    openFn: () => void
    closeFn: () => MaybePromise<void>
    minimizeFn: () => void
  }[],
  modalStack: [] as (() => MaybePromise<void>)[],
  modalZIndexCounter: 999,
}))
const underlyingDestroyMock = vi.hoisted(() => vi.fn())
const underlyingUnmountMock = vi.hoisted(() => vi.fn())
const modalModuleMode = vi.hoisted(() => ({ real: false }))

vi.mock('@/stores', () => ({
  useAppStore: () => appStoreMock,
}))

vi.mock('@/stores/index', () => ({
  useAppStore: () => appStoreMock,
}))

vi.mock('@/bridge/browser/runtime/runtime', () => ({}))

vi.mock('@/bridge', () => ({}))

vi.mock('@/components/Modal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/Modal')>()

  return {
    ...actual,
    useModal: (...args: Parameters<typeof actual.useModal>) => {
      if (modalModuleMode.real) {
        return actual.useModal(...args)
      }

      const [options] = args
      const Modal = defineComponent({
        setup() {
          onUnmounted(underlyingUnmountMock)
          return () => null
        },
      })
      const api = {
        open: vi.fn(),
        close: vi.fn(),
        destroy: underlyingDestroyMock.mockImplementation(async () => options.afterDestroy?.()),
      }
      return [Modal, api]
    },
  }
})

vi.mock('@/utils', () => ({
  APP_TITLE: 'GUI.for.SingBox',
  bindAppContext: vi.fn(),
  message: {
    info: vi.fn(() => ({ destroy: vi.fn() })),
  },
  normalizeErrorMessage: (value: unknown) => String(value),
  sampleID: vi.fn(() => 'modal-id'),
}))

describe('Modal', () => {
  const mountedWrappers: ReturnType<typeof mount>[] = []

  beforeEach(() => {
    modalModuleMode.real = false
    appStoreMock.modalMinimized.splice(0)
    appStoreMock.modalStack.splice(0)
    appStoreMock.modalZIndexCounter = 999
    underlyingDestroyMock.mockReset()
    underlyingUnmountMock.mockReset()
  })

  afterEach(() => {
    mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  })

  const mountRealModal = async (
    options: Parameters<typeof import('@/components/Modal').useModal>[0],
  ) => {
    modalModuleMode.real = true
    const { useModal } = await import('@/components/Modal')
    const { default: Modal } = await import('@/components/Modal/index.vue')
    const [ModalHost, api] = useModal(options)
    const wrapper = mount(ModalHost, {
      global: {
        mocks: { $t: (key: string) => key },
        stubs: {
          Button: defineComponent({
            props: { loading: Boolean },
            setup(props, { attrs, slots }) {
              return () =>
                h('button', { ...attrs, 'data-loading': String(props.loading) }, slots.default?.())
            },
          }),
          Icon: true,
          Teleport: true,
          Transition: false,
        },
      },
    })
    mountedWrappers.push(wrapper)
    api.open()
    await nextTick()
    const modal = wrapper.getComponent(Modal)

    return {
      api,
      modal,
      wrapper,
      externalClose: async () => {
        modal.vm.$emit('update:open', false)
        await nextTick()
      },
      finishLeave: () =>
        (
          modal.vm.$ as unknown as { setupState: { onAfterLeave: () => void } }
        ).setupState.onAfterLeave(),
    }
  }

  it('runs one close action for concurrent close requests and settles both callers', async () => {
    let releaseCancel!: () => void
    const onCancel = vi.fn(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
    const afterClose = vi.fn()
    const { modal, finishLeave } = await mountRealModal({ onCancel, afterClose })

    const firstClose = modal.vm.handleCancel()
    const secondClose = modal.vm.handleCancel()
    expect(secondClose).toBe(firstClose)
    let firstSettled = false
    let secondSettled = false
    void firstClose.finally(() => (firstSettled = true))
    void secondClose.finally(() => (secondSettled = true))
    await nextTick()

    expect(onCancel).toHaveBeenCalledOnce()
    releaseCancel()
    await flushPromises()
    const closeDuringLeave = modal.vm.handleCancel()
    expect(closeDuringLeave).toBe(firstClose)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)
    finishLeave()

    await expect(Promise.all([firstClose, secondClose, closeDuringLeave])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(afterClose).toHaveBeenCalledOnce()
  })

  it('shares the close lifecycle with a synchronous reentrant close', async () => {
    let reentrantClose: Promise<void> | undefined
    const state = {} as { modal: Awaited<ReturnType<typeof mountRealModal>>['modal'] }
    const onCancel = vi.fn(() => {
      reentrantClose = state.modal.vm.handleCancel()
    })
    const mounted = await mountRealModal({ onCancel })
    const modal = mounted.modal
    state.modal = modal

    const firstClose = modal.vm.handleCancel()
    await flushPromises()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(reentrantClose).toBe(firstClose)
    mounted.finishLeave()
    await firstClose
  })

  it('shares one lifecycle across mask, Escape, and internal cancel', async () => {
    let releaseCancel!: () => void
    const onCancel = vi.fn(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
    const { modal, finishLeave } = await mountRealModal({ maskClosable: true, onCancel })

    await modal.get('.gui-modal-mask').trigger('click')
    appStoreMock.modalStack.at(-1)?.()
    const internalClose = modal.vm.handleCancel()
    await nextTick()

    expect(onCancel).toHaveBeenCalledOnce()
    releaseCancel()
    await flushPromises()
    finishLeave()
    await internalClose
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('returns the shared lifecycle and hook rejection from the public close API', async () => {
    let releaseCancel!: () => void
    const error = new Error('public close failed')
    const onCancel = vi.fn(
      () => new Promise<void>((_, reject) => (releaseCancel = () => reject(error))),
    )
    const { api } = await mountRealModal({ onCancel })

    const firstClose = api.close()
    const duplicateClose = api.close()

    expect(firstClose).toBeInstanceOf(Promise)
    expect(duplicateClose).toBe(firstClose)
    releaseCancel()
    await expect(Promise.allSettled([firstClose, duplicateClose])).resolves.toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ])
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps the modal open when the model closes while hooks are pending', async () => {
    let releaseCancel!: () => void
    const onCancel = vi.fn(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
    const afterClose = vi.fn()
    const { api, externalClose, finishLeave, modal } = await mountRealModal({
      onCancel,
      afterClose,
    })

    const close = api.close()
    await nextTick()
    await externalClose()
    finishLeave()
    await flushPromises()

    expect(modal.get('.gui-modal-mask').attributes('style')).not.toContain('display: none')
    expect(afterClose).not.toHaveBeenCalled()

    releaseCancel()
    await flushPromises()
    let settled = false
    void close.finally(() => (settled = true))
    expect(settled).toBe(false)
    finishLeave()
    await close
    expect(afterClose).toHaveBeenCalledOnce()
  })

  it('delays minimize until pending close hooks finish', async () => {
    let releaseCancel!: () => void
    const onCancel = vi.fn(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
    const { api, modal } = await mountRealModal({
      title: 'Persistent',
      destroyOnClose: false,
      onCancel,
    })

    const close = api.close()
    await nextTick()
    await modal.findAll('button')[0]!.trigger('click')
    await nextTick()

    expect(appStoreMock.modalMinimized).toHaveLength(0)
    expect(modal.get('.gui-modal-mask').attributes('style')).not.toContain('display: none')

    releaseCancel()
    await close
    expect(appStoreMock.modalMinimized).toHaveLength(1)
    expect(modal.get('.gui-modal-mask').attributes('style')).toContain('display: none')
  })

  it('ignores reopen until a persistent close lifecycle finishes', async () => {
    const onCancel = vi.fn()
    const afterClose = vi.fn()
    const { api, modal, finishLeave } = await mountRealModal({
      destroyOnClose: false,
      onCancel,
      afterClose,
    })

    const firstClose = modal.vm.handleCancel()
    let firstSettled = false
    void firstClose.finally(() => (firstSettled = true))
    await flushPromises()

    api.open()
    await nextTick()
    const closeDuringLeave = modal.vm.handleCancel()
    expect(closeDuringLeave).toBe(firstClose)
    await flushPromises()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(firstSettled).toBe(false)
    finishLeave()
    await expect(Promise.all([firstClose, closeDuringLeave])).resolves.toEqual([
      undefined,
      undefined,
    ])
    expect(afterClose).toHaveBeenCalledOnce()

    api.open()
    await nextTick()
    const secondClose = modal.vm.handleCancel()
    await flushPromises()
    expect(onCancel).toHaveBeenCalledTimes(2)
    finishLeave()
    await secondClose
    expect(afterClose).toHaveBeenCalledTimes(2)
  })

  it('allows retry after beforeClose vetoes a close', async () => {
    const beforeClose = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { modal, finishLeave } = await mountRealModal({ beforeClose })

    await modal.vm.handleCancel()
    const retry = modal.vm.handleCancel()
    await flushPromises()
    finishLeave()
    await retry

    expect(beforeClose).toHaveBeenCalledTimes(2)
  })

  it('clears loading and allows retry after a close hook throws', async () => {
    const error = new Error('cancel failed')
    const onCancel = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    const { modal, finishLeave } = await mountRealModal({ onCancel })

    const firstClose = modal.vm.handleCancel()
    const duplicateClose = modal.vm.handleCancel()
    const results = await Promise.allSettled([firstClose, duplicateClose])
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ])
    expect(onCancel).toHaveBeenCalledOnce()
    expect(modal.get('button').attributes('data-loading')).toBe('false')

    const retry = modal.vm.handleCancel()
    await flushPromises()
    finishLeave()
    await retry

    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('force destroys a minimized modal through one shared close lifecycle', async () => {
    const onCancel = vi.fn()
    const afterClose = vi.fn()
    const afterDestroy = vi.fn()
    const { modal } = await mountRealModal({
      title: 'Persistent',
      destroyOnClose: false,
      onCancel,
      afterClose,
      afterDestroy,
    })

    await modal.findAll('button')[0]!.trigger('click')
    await nextTick()
    expect(appStoreMock.modalMinimized).toHaveLength(1)

    const firstClose = appStoreMock.modalMinimized[0]!.closeFn()
    const duplicateClose = appStoreMock.modalMinimized[0]!.closeFn()
    expect(duplicateClose).toBe(firstClose)
    await Promise.all([firstClose, duplicateClose])

    expect(onCancel).toHaveBeenCalledOnce()
    expect(afterClose).toHaveBeenCalledOnce()
    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(appStoreMock.modalMinimized).toHaveLength(0)
  })

  it.each(['veto', 'error'] as const)(
    'keeps a minimized modal recoverable when openAll races with a destroy %s',
    async (outcome) => {
      let finishHook!: () => void
      const error = new Error('destroy failed')
      const onCancel = vi.fn(
        () =>
          new Promise<boolean | void>((resolve, reject) => {
            finishHook = () => (outcome === 'veto' ? resolve(false) : reject(error))
          }),
      )
      const { modal } = await mountRealModal({
        title: 'Persistent',
        destroyOnClose: false,
        onCancel,
      })

      await modal.findAll('button')[0]!.trigger('click')
      await nextTick()
      const item = appStoreMock.modalMinimized[0]!
      const destroy = item.closeFn()
      await nextTick()

      appStoreMock.modalMinimized.slice().forEach((entry) => entry.openFn())
      await nextTick()

      expect(appStoreMock.modalMinimized).toEqual([item])
      expect(modal.get('.gui-modal-mask').attributes('style')).toContain('display: none')
      expect(appStoreMock.modalStack).toHaveLength(0)

      finishHook()
      if (outcome === 'veto') {
        await expect(destroy).resolves.toBeUndefined()
      } else {
        await expect(destroy).rejects.toBe(error)
      }

      expect(appStoreMock.modalMinimized).toEqual([item])
      expect(modal.get('.gui-modal-mask').attributes('style')).toContain('display: none')

      item.openFn()
      await nextTick()

      expect(appStoreMock.modalMinimized).toHaveLength(0)
      expect(modal.get('.gui-modal-mask').attributes('style')).not.toContain('display: none')
      expect(appStoreMock.modalStack).toHaveLength(1)
    },
  )

  it('ignores openAll during an accepted minimized destroy and still cleans up', async () => {
    let releaseCancel!: () => void
    const onCancel = vi.fn(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
    const afterDestroy = vi.fn()
    const { modal } = await mountRealModal({
      title: 'Persistent',
      destroyOnClose: false,
      onCancel,
      afterDestroy,
    })

    await modal.findAll('button')[0]!.trigger('click')
    await nextTick()
    const item = appStoreMock.modalMinimized[0]!
    const destroy = item.closeFn()
    await nextTick()

    appStoreMock.modalMinimized.slice().forEach((entry) => entry.openFn())
    await nextTick()
    expect(appStoreMock.modalMinimized).toEqual([item])
    expect(modal.get('.gui-modal-mask').attributes('style')).toContain('display: none')

    releaseCancel()
    await destroy

    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(appStoreMock.modalMinimized).toHaveLength(0)
    expect(appStoreMock.modalStack).toHaveLength(0)
  })

  it('runs destroy cleanup when afterClose throws and rejects with that error', async () => {
    const error = new Error('afterClose failed')
    const laterError = new Error('afterDestroy failed')
    const afterClose = vi.fn(() => {
      throw error
    })
    const afterDestroy = vi.fn(() => {
      throw laterError
    })
    const { api, modal } = await mountRealModal({
      title: 'Persistent',
      destroyOnClose: false,
      afterClose,
      afterDestroy,
    })

    await modal.findAll('button')[0]!.trigger('click')
    await nextTick()
    const destroy = api.destroy()

    await expect(destroy).rejects.toBe(error)
    expect(afterClose).toHaveBeenCalledOnce()
    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(appStoreMock.modalMinimized).toHaveLength(0)
  })

  it('removes a minimized modal when afterDestroy throws', async () => {
    const error = new Error('afterDestroy failed')
    const afterDestroy = vi.fn(() => {
      throw error
    })
    const { api, modal } = await mountRealModal({
      title: 'Persistent',
      destroyOnClose: false,
      afterDestroy,
    })

    await modal.findAll('button')[0]!.trigger('click')
    await nextTick()
    expect(appStoreMock.modalMinimized).toHaveLength(1)
    expect(modal.get('.gui-modal-mask').attributes('style')).toContain('display: none')
    const destroy = api.destroy()
    expect(modal.vm.handleDestroy()).toBe(destroy)

    await expect(destroy).rejects.toBe(error)
    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(appStoreMock.modalMinimized).toHaveLength(0)
  })

  it('settles public close and destroy when the modal is minimized', async () => {
    const afterClose = vi.fn()
    const afterDestroy = vi.fn()
    const { api, modal } = await mountRealModal({
      title: 'Persistent',
      destroyOnClose: false,
      afterClose,
      afterDestroy,
    })

    await modal.findAll('button')[0]!.trigger('click')
    await nextTick()
    expect(modal.get('.gui-modal-mask').attributes('style')).toContain('display: none')
    await expect(api.close()).resolves.toBeUndefined()
    expect(appStoreMock.modalMinimized).toHaveLength(1)

    await expect(api.destroy()).resolves.toBeUndefined()
    expect(afterClose).toHaveBeenCalledTimes(2)
    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(appStoreMock.modalMinimized).toHaveLength(0)
  })

  it('keeps the first close destroy policy when destroy joins an active lifecycle', async () => {
    let releaseCancel!: () => void
    const onCancel = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
      .mockResolvedValueOnce(undefined)
    const afterDestroy = vi.fn()
    const { api, finishLeave } = await mountRealModal({
      destroyOnClose: false,
      onCancel,
      afterDestroy,
    })

    const close = api.close()
    const destroy = api.destroy()
    expect(destroy).toBe(close)
    releaseCancel()
    await flushPromises()
    finishLeave()
    await close

    expect(afterDestroy).not.toHaveBeenCalled()

    api.open()
    await nextTick()
    const destroyFirst = api.destroy()
    await flushPromises()
    finishLeave()
    await destroyFirst
    expect(afterDestroy).toHaveBeenCalledOnce()
  })

  it('waits for hooks before the public destroy lifecycle completes', async () => {
    let releaseCancel!: () => void
    const onCancel = vi.fn(() => new Promise<void>((resolve) => (releaseCancel = resolve)))
    const afterDestroy = vi.fn()
    const { api, finishLeave, modal } = await mountRealModal({ onCancel, afterDestroy })

    const firstDestroy = api.destroy()
    const duplicateDestroy = api.destroy()
    expect(duplicateDestroy).toBe(firstDestroy)
    await nextTick()

    expect(modal.find('.gui-modal-mask').exists()).toBe(true)
    expect(afterDestroy).not.toHaveBeenCalled()
    releaseCancel()
    await flushPromises()
    finishLeave()
    await firstDestroy

    expect(afterDestroy).toHaveBeenCalledOnce()
  })

  it('runs afterClose when the open model is closed externally', async () => {
    const afterClose = vi.fn()
    const { externalClose } = await mountRealModal({ afterClose })

    await externalClose()
    await flushPromises()

    expect(afterClose).toHaveBeenCalledWith(false)
  })

  it('restores an externally closed modal when beforeClose vetoes', async () => {
    const beforeClose = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(undefined)
    const { externalClose, finishLeave, modal } = await mountRealModal({
      beforeClose,
      maskClosable: true,
    })
    const closeFn = appStoreMock.modalStack[0]

    await externalClose()
    await flushPromises()

    expect(beforeClose).toHaveBeenCalledWith(false)
    expect(modal.get('.gui-modal-mask').attributes('style')).not.toContain('display: none')
    expect(appStoreMock.modalStack).toEqual([closeFn])

    const retry = closeFn!()
    await flushPromises()
    finishLeave()
    await retry
    expect(beforeClose).toHaveBeenCalledTimes(2)
    expect(appStoreMock.modalStack).toHaveLength(0)
  })

  it('keeps the Escape stack after an external close error and removes it on acceptance', async () => {
    let releaseClose!: () => void
    const error = new Error('external close failed')
    const beforeClose = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseClose = resolve)))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { externalClose } = await mountRealModal({ beforeClose, maskClosable: true })
      const closeFn = appStoreMock.modalStack[0]

      await externalClose()
      await flushPromises()

      expect(consoleError).toHaveBeenCalledWith(error)
      expect(appStoreMock.modalStack).toEqual([closeFn])

      const retry = closeFn!()
      await nextTick()
      expect(appStoreMock.modalStack).toEqual([closeFn])
      releaseClose()
      await flushPromises()

      expect(appStoreMock.modalStack).toHaveLength(0)
      ;(retry as Promise<void>).catch(() => undefined)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('handles external close rejection without an unhandled rejection and allows retry', async () => {
    const error = new Error('external beforeClose failed')
    const beforeClose = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    try {
      const { externalClose } = await mountRealModal({ beforeClose })

      await externalClose()
      await flushPromises()

      expect(consoleError).toHaveBeenCalledWith(error)
      expect(unhandled).not.toHaveBeenCalled()

      await externalClose()
      await flushPromises()
      expect(beforeClose).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener('unhandledrejection', unhandled)
      consoleError.mockRestore()
    }
  })

  it('reports an external afterClose error without an unhandled rejection', async () => {
    const error = new Error('external afterClose failed')
    const afterClose = vi.fn(() => {
      throw error
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    try {
      const { externalClose } = await mountRealModal({ afterClose })

      await externalClose()
      await flushPromises()

      expect(consoleError).toHaveBeenCalledWith(error)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', unhandled)
      consoleError.mockRestore()
    }
  })

  it('removes a persistent minimized modal when it is closed from the minimized list', async () => {
    const { default: Modal } = await import('@/components/Modal/index.vue')
    const appStore = appStoreMock
    const afterDestroy = vi.fn()

    const wrapper = mount(Modal, {
      props: {
        open: true,
        destroyOnClose: false,
        afterDestroy,
      },
      global: {
        mocks: { $t: (key: string) => key },
        stubs: { Button: true, Icon: true, Teleport: true, Transition: false },
      },
    })

    await wrapper.setProps({ open: false })
    expect(appStore.modalMinimized).toHaveLength(1)

    await appStore.modalMinimized[0]!.closeFn()
    await wrapper.vm.$nextTick()

    expect(appStore.modalMinimized).toHaveLength(0)
    expect(afterDestroy).toHaveBeenCalledOnce()
  })

  it('destroys a command modal and runs cleanup exactly once', async () => {
    const { modal } = await import('@/utils/interaction')
    const afterDestroy = vi.fn()

    const instance = modal({ afterDestroy })
    instance.open()
    instance.destroy()
    instance.destroy()
    await nextTick()

    expect(underlyingDestroyMock).toHaveBeenCalledOnce()
    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(document.querySelector('[id^="Modal-"]')).toBeNull()
  })

  it('removes a command modal when afterDestroy throws', async () => {
    const { modal } = await import('@/utils/interaction')
    const error = new Error('afterDestroy failed')
    const afterDestroy = vi.fn(() => {
      throw error
    })

    const instance = modal({ afterDestroy })

    const firstDestroy = instance.destroy()
    expect(instance.destroy()).toBe(firstDestroy)
    await expect(firstDestroy).rejects.toBe(error)
    await nextTick()

    expect(underlyingDestroyMock).toHaveBeenCalledOnce()
    expect(afterDestroy).toHaveBeenCalledOnce()
    expect(underlyingUnmountMock).toHaveBeenCalledOnce()
    expect(document.querySelector('[id^="Modal-"]')).toBeNull()
  })
})
