import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import NodeSelectorModal from '@/views/HomeView/components/NodeSelectorModal.vue'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/utils', () => ({
  message: toast,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

const createController = () => {
  const selectedGroupName = ref('Proxy')
  const query = ref('')
  const sortByDelay = ref(false)
  const nodes = ref([
    {
      name: 'HK 01',
      proxy: {
        alive: true,
        name: 'HK 01',
        type: 'VLESS',
        all: [],
        now: '',
        udp: true,
        history: [{ delay: 80 }],
      },
      delay: 80,
      delayStatus: 'success' as const,
      attempts: 2,
      originalIndex: 0,
    },
    {
      name: 'JP 01',
      proxy: {
        alive: true,
        name: 'JP 01',
        type: 'Trojan',
        all: [],
        now: '',
        udp: false,
        history: [],
      },
      delay: null,
      delayStatus: 'untested' as const,
      originalIndex: 1,
    },
    {
      name: 'US Timeout',
      proxy: {
        alive: true,
        name: 'US Timeout',
        type: 'Trojan',
        all: [],
        now: '',
        udp: false,
        history: [{ delay: 0 }],
      },
      delay: null,
      delayStatus: 'failed' as const,
      error: {
        category: 'timeout' as const,
        message: 'context deadline exceeded',
        attempts: 3,
      },
      originalIndex: 2,
    },
  ])
  const group = {
    alive: true,
    name: 'Proxy',
    type: 'Selector',
    all: ['HK 01', 'JP 01', 'US Timeout'],
    now: 'HK 01',
    udp: false,
    history: [],
  }

  return {
    selectedGroupName,
    query,
    sortByDelay,
    nodeErrors: ref(new Map()),
    testingNodes: ref(new Set<string>()),
    switchingNode: ref(''),
    batch: ref({
      running: false,
      cancelled: false,
      total: 2,
      completed: 0,
      success: 0,
      failure: 0,
    }),
    stale: ref(false),
    refreshError: ref(''),
    groups: computed(() => [group]),
    primary: computed(() => ({
      kind: 'group' as const,
      groupName: 'Proxy',
      group,
      chain: ['Proxy', 'HK 01'],
      leafName: 'HK 01',
      delay: 80,
      readonly: false,
    })),
    selectedGroup: computed(() => group),
    nodes,
    readonlyMode: computed(() => false),
    refresh: vi.fn(),
    prepareModal: vi.fn().mockResolvedValue(undefined),
    selectGroup: vi.fn((name: string) => {
      selectedGroupName.value = name
    }),
    switchNode: vi.fn().mockResolvedValue({ ok: true as const }),
    testNode: vi.fn().mockResolvedValue({ ok: true as const }),
    testGroup: vi.fn().mockResolvedValue(undefined),
    cancelGroupTest: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  }
}

const mountModal = (controller = createController()) =>
  mount(NodeSelectorModal, {
    props: {
      open: true,
      controller: controller as never,
    },
    global: {
      stubs: {
        Modal: {
          props: ['open'],
          template: '<div class="modal-stub"><slot /><slot name="action" /></div>',
        },
        Select: {
          template:
            '<button class="group-select" @click="$emit(\'change\', \'Proxy\')">group</button>',
        },
        Input: {
          inheritAttrs: false,
          template:
            '<input class="search" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        Switch: {
          template:
            '<button class="sort" @click="$emit(\'update:modelValue\', true)">sort</button>',
        },
        Card: {
          template: '<div v-bind="$attrs" class="card"><slot /><slot name="extra" /></div>',
        },
        Button: {
          template: '<button v-bind="$attrs"><slot /></button>',
        },
        Progress: { template: '<div class="progress" />' },
        Empty: { template: '<div class="empty" />' },
        Icon: true,
      },
      directives: {
        tips: {
          mounted(el, binding) {
            el.dataset.tips = binding.value
            el.dataset.tipsFast = String(binding.modifiers.fast)
          },
          updated(el, binding) {
            el.dataset.tips = binding.value
          },
        },
      },
    },
  })

describe('NodeSelectorModal', () => {
  beforeEach(() => {
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('prepares data when opened', async () => {
    const controller = createController()
    mountModal(controller)
    await Promise.resolve()

    expect(controller.prepareModal).toHaveBeenCalled()
  })

  it('switches a selectable node and tests delay separately', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)

    await wrapper.get('[data-node="JP 01"]').trigger('click')
    await wrapper.get('[data-delay="JP 01"]').trigger('click')

    expect(controller.switchNode).toHaveBeenCalledWith('JP 01')
    expect(controller.testNode).toHaveBeenCalledWith('JP 01')
  })

  it('shows localized successful, failed and untested delay results', () => {
    const wrapper = mountModal()

    const success = wrapper.get('[data-delay="HK 01"] .delay-success').text()
    expect(success).toContain('80 ms')
    expect(success).toContain('2')
    expect(success).toContain('home.nodes.attempts')

    const failure = wrapper.get('[data-delay="US Timeout"] .delay-failed').text()
    expect(failure).toContain('home.nodes.delayError.timeout')
    expect(failure).toContain('3/3')

    expect(wrapper.get('[data-delay="JP 01"]').text()).toContain('home.nodes.untested')
    expect(wrapper.find('[data-delay="JP 01"] .delay-success').exists()).toBe(false)
    expect(wrapper.find('[data-delay="JP 01"] .delay-failed').exists()).toBe(false)
  })

  it('exposes the original delay error through the fast tips directive', () => {
    const failureButton = mountModal().get('[data-delay="US Timeout"]')

    expect(failureButton.attributes('data-tips')).toBe('context deadline exceeded')
    expect(failureButton.attributes('data-tips-fast')).toBe('true')
  })

  it('updates the accessible error description when an untested node fails', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)
    const button = wrapper.get('[data-delay="JP 01"]')
    expect(button.attributes('aria-description')).toBeUndefined()

    controller.nodes.value[1] = {
      name: 'JP 01',
      proxy: {
        alive: true,
        name: 'JP 01',
        type: 'Trojan',
        all: [],
        now: '',
        udp: false,
        history: [{ delay: 0 }],
      },
      delay: null,
      delayStatus: 'failed',
      error: { category: 'timeout', message: 'new timeout error', attempts: 3 },
      originalIndex: 1,
    }
    await wrapper.vm.$nextTick()

    expect(button.attributes('aria-description')).toBe('new timeout error')
    expect(button.attributes('data-tips')).toBe('new timeout error')
  })

  it('disables node switching while another switch is in progress', async () => {
    const controller = createController()
    controller.switchingNode.value = 'JP 01'
    const wrapper = mountModal(controller)

    expect(wrapper.get('[data-node="JP 01"]').attributes('aria-disabled')).toBe('true')
    await wrapper.get('[data-node="JP 01"]').trigger('click')

    expect(controller.switchNode).not.toHaveBeenCalled()
  })

  it('supports keyboard switching and reports switch failures', async () => {
    const controller = createController()
    controller.switchNode.mockResolvedValue({ ok: false, error: 'switch failed' })
    const wrapper = mountModal(controller)

    await wrapper.get('[data-node="JP 01"]').trigger('keydown', { key: 'Enter' })
    await Promise.resolve()

    expect(controller.switchNode).toHaveBeenCalledWith('JP 01')
    expect(toast.error).toHaveBeenCalledWith('switch failed')
  })

  it('starts and cancels a group delay test', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)

    await wrapper.get('[data-action="test-group"]').trigger('click')
    controller.batch.value.running = true
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-action="cancel-test"]').trigger('click')

    expect(controller.testGroup).toHaveBeenCalled()
    expect(controller.cancelGroupTest).toHaveBeenCalled()
  })

  it('wires group selection, search and delay sorting controls', async () => {
    const controller = createController()
    const wrapper = mountModal(controller)

    await wrapper.get('.group-select').trigger('click')
    await wrapper.get('.search').setValue('jp')
    await wrapper.get('.sort').trigger('click')

    expect(controller.selectGroup).toHaveBeenCalledWith('Proxy')
    expect(controller.query.value).toBe('jp')
    expect(controller.sortByDelay.value).toBe(true)
  })

  it('retries a stale controller snapshot', async () => {
    const controller = createController()
    controller.stale.value = true
    controller.refreshError.value = 'controller offline'
    const wrapper = mountModal(controller)
    controller.prepareModal.mockClear()

    await wrapper.get('[data-action="retry-refresh"]').trigger('click')

    expect(controller.prepareModal).toHaveBeenCalledTimes(1)
  })

  it('disables switching in direct mode but keeps delay buttons usable', async () => {
    const controller = createController()
    controller.readonlyMode = computed(() => true)
    const wrapper = mountModal(controller)

    expect(wrapper.get('[data-node="JP 01"]').attributes('aria-disabled')).toBe('true')
    await wrapper.get('[data-node="JP 01"]').trigger('click')
    await wrapper.get('[data-delay="JP 01"]').trigger('click')

    expect(controller.switchNode).not.toHaveBeenCalled()
    expect(controller.testNode).toHaveBeenCalledWith('JP 01')
  })
})
