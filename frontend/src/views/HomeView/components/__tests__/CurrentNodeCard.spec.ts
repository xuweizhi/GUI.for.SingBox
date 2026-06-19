import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  kernelStore: { running: true },
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  chainError: undefined as 'missing' | 'cycle' | undefined,
}))

vi.mock('@/views/HomeView/useNodeController', async () => {
  const { computed, ref } = await import('vue')
  return {
    useNodeController: () => ({
      selectedGroupName: ref('Proxy'),
      query: ref(''),
      sortByDelay: ref(false),
      nodeErrors: ref(new Map()),
      testingNodes: ref(new Set()),
      batch: ref({
        running: false,
        cancelled: false,
        total: 0,
        completed: 0,
        success: 0,
        failure: 0,
      }),
      stale: ref(false),
      refreshError: ref(''),
      groups: computed(() => []),
      primary: computed(() => ({
        kind: 'group',
        groupName: 'Proxy',
        chain: ['Proxy', 'Auto', 'HK 01'],
        leafName: 'HK 01',
        delay: 86,
        error: mocks.chainError,
        readonly: false,
      })),
      selectedGroup: computed(() => undefined),
      nodes: computed(() => []),
      readonlyMode: computed(() => false),
      refresh: vi.fn(),
      prepareModal: vi.fn(),
      selectGroup: vi.fn(),
      switchNode: vi.fn(),
      testNode: vi.fn(),
      testGroup: vi.fn(),
      cancelGroupTest: vi.fn(),
      startPolling: mocks.startPolling,
      stopPolling: mocks.stopPolling,
    }),
  }
})

vi.mock('@/stores', async () => {
  const { reactive } = await import('vue')
  mocks.kernelStore = reactive(mocks.kernelStore)
  return {
    useKernelApiStore: () => mocks.kernelStore,
  }
})

vi.mock('@/utils', () => ({
  message: { warn: mocks.warn },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

import CurrentNodeCard from '@/views/HomeView/components/CurrentNodeCard.vue'

const mountCard = () =>
  mount(CurrentNodeCard, {
    global: {
      stubs: {
        Card: {
          template: '<div class="card"><slot name="extra" /><slot /></div>',
        },
        NodeSelectorModal: {
          props: ['open'],
          template: '<div class="selector-modal" :data-open="open" />',
        },
      },
      directives: {
        tips: {},
      },
    },
  })

describe('CurrentNodeCard', () => {
  beforeEach(() => {
    mocks.kernelStore.running = true
    mocks.warn.mockReset()
    mocks.startPolling.mockReset()
    mocks.stopPolling.mockReset()
    mocks.chainError = undefined
  })

  it('shows the group, full chain and final delay', () => {
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('Proxy')
    expect(wrapper.text()).toContain('Auto')
    expect(wrapper.text()).toContain('HK 01')
    expect(wrapper.text()).toContain('86 ms')
  })

  it('shows an explicit state when the current node chain is invalid', () => {
    mocks.chainError = 'cycle'
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('home.nodes.invalidChain')
    expect(wrapper.text()).not.toContain('HK 01')
  })

  it('opens from click and keyboard', async () => {
    const wrapper = mountCard()

    await wrapper.get('[data-current-node]').trigger('click')
    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('true')

    await wrapper.get('[data-current-node]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('true')
  })

  it('does not open while the core is stopped', async () => {
    mocks.kernelStore.running = false
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('home.nodes.coreUnavailable')
    await wrapper.get('[data-current-node]').trigger('click')

    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('false')
    expect(mocks.warn).toHaveBeenCalledWith('home.nodes.startCoreFirst')
  })

  it('closes the selector if the core stops while it is open', async () => {
    const wrapper = mountCard()
    await wrapper.get('[data-current-node]').trigger('click')
    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('true')

    mocks.kernelStore.running = false
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.selector-modal').attributes('data-open')).toBe('false')
    expect(mocks.stopPolling).toHaveBeenCalled()
  })

  it('starts polling while mounted and stops on unmount', () => {
    const wrapper = mountCard()

    expect(mocks.startPolling).toHaveBeenCalled()
    wrapper.unmount()
    expect(mocks.stopPolling).toHaveBeenCalled()
  })
})
