import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${Object.values(params).join(' ')}` : key,
  }),
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
        Select: {
          props: ['modelValue', 'options'],
          emits: ['update:modelValue'],
          template: `<select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
            <option v-for="option in options" :value="option.value">{{ option.label }}</option>
          </select>`,
        },
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

  it('switches matching fields live and explains each result using the actual matched value', async () => {
    useSubscribesStore().subscribes = [{ ...subscription, name: 'HK Provider' }]
    useNodeGroupsStore().nodeGroups = [{ ...group('filter'), exclude: 'test' }]
    const wrapper = mountForm('group-filter')
    const field = wrapper.get<HTMLSelectElement>('[data-testid="node-group-match-field"]')

    expect(field.element.value).toBe('all')
    expect(wrapper.findAll('[data-testid="node-group-match-reason"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('JP 01 · HK Provider')

    await field.setValue('name')

    expect(wrapper.text()).toContain('HK 01 · HK Provider')
    expect(wrapper.text()).not.toContain('JP 01 · HK Provider')
    const reason = wrapper.get('[data-testid="node-group-match-reason"]').text()
    expect(reason).toContain('nodeGroups.matchIncluded nodeGroups.matchFields.name HK 01 HK')
    expect(reason).toContain('nodeGroups.matchNotExcluded test')

    await field.setValue('protocol')
    expect(wrapper.findAll('[data-testid="node-group-match-reason"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('common.none')

    await field.setValue('subscription')
    expect(wrapper.findAll('[data-testid="node-group-match-reason"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="node-group-match-reason"]').text()).toContain(
      'nodeGroups.matchFields.subscription HK Provider',
    )
  })

  it('explains an unrestricted include filter without claiming an include match', () => {
    useNodeGroupsStore().nodeGroups = [{ ...group('filter'), match_field: 'protocol', include: '' }]
    const wrapper = mountForm('group-filter')

    expect(wrapper.get('[data-testid="node-group-match-reason"]').text()).toContain(
      'nodeGroups.matchUnrestricted nodeGroups.matchFields.protocol vless',
    )
    expect(wrapper.text()).not.toContain('nodeGroups.matchIncluded')
  })
})
