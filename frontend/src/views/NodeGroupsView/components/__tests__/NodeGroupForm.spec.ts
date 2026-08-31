import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

import { useNodeGroupsStore } from '@/stores/nodeGroups'
import { useSubscribesStore } from '@/stores/subscribes'
import NodeGroupForm from '@/views/NodeGroupsView/components/NodeGroupForm.vue'

const subscription = {
  id: 'sub-a',
  name: 'Provider A',
  disabled: false,
  proxies: [
    { id: 'node-a', tag: 'HK 01', type: 'vless' },
    { id: 'node-b', tag: 'JP 01', type: 'trojan' },
  ],
} as App.Subscription

const group = (mode: App.NodeGroupMode): App.NodeGroup => ({
  id: `group-${mode}`,
  name: mode,
  icon: '',
  mode,
  members:
    mode === 'manual'
      ? [{ subscription_id: 'sub-a', node_id: 'node-a', last_known_tag: 'HK 01' }]
      : [],
  source_scope: 'all',
  subscription_ids: [],
  include: mode === 'filter' ? 'HK' : '',
  exclude: '',
  max_nodes: 0,
})

const mountForm = (id: string) =>
  mount(NodeGroupForm, {
    props: { id },
    global: {
      provide: { cancel: vi.fn(), submit: vi.fn() },
      stubs: {
        Input: { template: '<input />' },
        Radio: { template: '<div class="radio"><slot /></div>' },
        Select: { template: '<div class="select" />' },
        Button: { template: '<button v-bind="$attrs"><slot /></button>' },
        Divider: { template: '<div class="divider"><slot /></div>' },
        Tag: { template: '<span class="tag"><slot /></span>' },
      },
    },
  })

describe('NodeGroupForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSubscribesStore().subscribes = [subscription]
  })

  it('supports searchable manual membership toggles with a live preview', async () => {
    useNodeGroupsStore().nodeGroups = [group('manual')]
    const wrapper = mountForm('group-manual')

    expect(wrapper.get('[data-member="node-a"]').attributes('data-selected')).toBe('true')
    await wrapper.get('[data-member="node-b"]').trigger('click')

    expect(wrapper.get('[data-member="node-b"]').attributes('data-selected')).toBe('true')
    expect(wrapper.text()).toContain('JP 01 · Provider A')
  })

  it('renders dynamic source/filter controls and their resolved preview', () => {
    useNodeGroupsStore().nodeGroups = [group('filter')]
    const wrapper = mountForm('group-filter')

    expect(wrapper.text()).toContain('nodeGroups.sources')
    expect(wrapper.text()).toContain('nodeGroups.include')
    expect(wrapper.text()).toContain('HK 01 · Provider A')
    expect(wrapper.text()).not.toContain('JP 01 · Provider A')
  })
})
