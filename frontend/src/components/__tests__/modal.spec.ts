import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appStoreMock = vi.hoisted(() => ({
  modalMinimized: [] as {
    id: string
    title: () => string
    openFn: () => void
    closeFn: () => MaybePromise<void>
    minimizeFn: () => void
  }[],
  modalStack: [] as (() => void)[],
  modalZIndexCounter: 999,
}))

vi.mock('@/stores', () => ({
  useAppStore: () => appStoreMock,
}))

vi.mock('@/stores/index', () => ({
  useAppStore: () => appStoreMock,
}))

vi.mock('@wails/runtime/runtime', () => ({}))

vi.mock('@/bridge', () => ({}))

vi.mock('@/utils', () => ({
  message: {
    info: vi.fn(() => ({ destroy: vi.fn() })),
  },
  sampleID: vi.fn(() => 'modal-id'),
}))

describe('Modal', () => {
  beforeEach(() => {
    appStoreMock.modalMinimized.splice(0)
    appStoreMock.modalStack.splice(0)
    appStoreMock.modalZIndexCounter = 999
  })

  it('runs afterClose when the open model is closed externally', async () => {
    const { default: Modal } = await import('@/components/Modal/index.vue')
    const afterClose = vi.fn()

    const wrapper = mount(Modal, {
      props: {
        open: true,
        afterClose,
      },
      global: {
        mocks: { $t: (key: string) => key },
        stubs: { Button: true, Icon: true, Teleport: true, Transition: false },
      },
    })

    await wrapper.setProps({ open: false })

    expect(afterClose).toHaveBeenCalledWith(false)
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
})
