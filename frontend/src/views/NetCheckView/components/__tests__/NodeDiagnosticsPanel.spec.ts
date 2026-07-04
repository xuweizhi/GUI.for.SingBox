import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import NodeDiagnosticsPanel from '@/views/NetCheckView/components/NodeDiagnosticsPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const createController = () => ({
  primary: computed(() => ({
    kind: 'group' as const,
    groupName: 'Proxy',
    chain: ['Proxy', 'HK 01'],
    leafName: 'HK 01',
    delay: 80,
    readonly: false,
  })),
  groups: computed(() => [{ name: 'Proxy', type: 'Selector', all: ['HK 01'], now: 'HK 01' }]),
  selectedGroupName: ref('Proxy'),
  selectedGroup: computed(() => ({ name: 'Proxy', type: 'Selector', all: ['HK 01'], now: 'HK 01' })),
  nodes: computed(() => [
    {
      name: 'HK 01',
      proxy: { name: 'HK 01', type: 'VLESS', udp: true },
      delay: 80,
      delayStatus: 'success' as const,
    },
  ]),
  batch: ref({ running: false, cancelled: false, total: 1, completed: 0, success: 0, failure: 0 }),
  stale: ref(false),
  refreshError: ref(''),
  readonlyMode: computed(() => false),
  testingNodes: ref(new Set<string>()),
  switchNode: vi.fn().mockResolvedValue({ ok: true }),
  testNode: vi.fn().mockResolvedValue({ ok: true }),
  testGroup: vi.fn().mockResolvedValue(undefined),
  cancelGroupTest: vi.fn(),
  selectGroup: vi.fn(),
})

describe('NodeDiagnosticsPanel', () => {
  it('renders primary group and node delay', () => {
    const wrapper = mount(NodeDiagnosticsPanel, {
      props: { controller: createController() as never, coreReady: true },
      global: {
        stubs: {
          Card: { template: '<div><slot /><slot name="extra" /></div>' },
          Button: { template: '<button v-bind="$attrs"><slot /></button>' },
          Select: true,
          Empty: true,
          Icon: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Proxy')
    expect(wrapper.text()).toContain('HK 01')
    expect(wrapper.text()).toContain('80 ms')
  })

  it('wires group and node actions', async () => {
    const controller = createController()
    const wrapper = mount(NodeDiagnosticsPanel, {
      props: { controller: controller as never, coreReady: true },
      global: {
        stubs: {
          Card: { template: '<div><slot /><slot name="extra" /></div>' },
          Button: { template: '<button v-bind="$attrs"><slot /></button>' },
          Select: true,
          Empty: true,
          Icon: true,
        },
      },
    })

    await wrapper.get('[data-action="test-group"]').trigger('click')
    await wrapper.get('[data-node="HK 01"]').trigger('click')
    await wrapper.get('[data-delay="HK 01"]').trigger('click')

    expect(controller.testGroup).toHaveBeenCalled()
    expect(controller.switchNode).toHaveBeenCalledWith('HK 01')
    expect(controller.testNode).toHaveBeenCalledWith('HK 01')
  })
})
