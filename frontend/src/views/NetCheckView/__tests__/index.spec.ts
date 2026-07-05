import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  clear: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  prepareModal: vi.fn(),
  refresh: vi.fn(),
  running: { value: false },
  groups: { value: [
    {
      id: 'overview',
      title: 'netCheck.groups.overview',
      status: 'success',
      summary: '1 success, 1 failed',
      items: [
        { id: 'core', title: 'netCheck.results.core', status: 'success', summary: 'ok' },
      ],
    },
    {
      id: 'dns',
      title: 'netCheck.groups.dns',
      status: 'skipped',
      summary: '0 items',
      items: [],
    },
  ] },
}))

const mountView = () =>
  mount(NetCheckView, {
    global: {
      stubs: {
        Card: { template: '<div><slot /><slot name="extra" /></div>' },
        Button: { template: '<button v-bind="$attrs"><slot /></button>' },
        Input: {
          props: ['modelValue'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        Icon: true,
        NodeDiagnosticsPanel: { template: '<div class="node-panel" />' },
      },
    },
  })

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    te: () => false,
  }),
}))

vi.mock('@/views/NetCheckView/useRuntimeNetworkCheck', () => ({
  useRuntimeNetworkCheck: () => ({
    input: ref('https://www.gstatic.com/generate_204'),
    running: mocks.running,
    results: ref([]),
    groups: mocks.groups,
    clear: mocks.clear,
    run: mocks.run,
  }),
}))

vi.mock('@/views/HomeView/useNodeController', () => ({
  useNodeController: () => ({
    startPolling: mocks.startPolling,
    stopPolling: mocks.stopPolling,
    prepareModal: mocks.prepareModal,
    refresh: mocks.refresh,
    primary: ref({
      kind: 'group',
      groupName: 'Proxy',
      chain: ['Proxy', 'HK 01'],
      leafName: 'HK 01',
      delay: 80,
    }),
    groups: ref([]),
    selectedGroupName: ref(''),
    selectedGroup: ref(undefined),
    nodes: ref([]),
    batch: ref({ running: false, cancelled: false, total: 0, completed: 0, success: 0, failure: 0 }),
    stale: ref(false),
    refreshError: ref(''),
    readonlyMode: ref(false),
    testingNodes: ref(new Set()),
    switchNode: vi.fn(),
    testNode: vi.fn(),
    testGroup: vi.fn(),
    cancelGroupTest: vi.fn(),
    selectGroup: vi.fn(),
  }),
}))

vi.mock('@/stores', () => ({
  useKernelApiStore: () => ({
    running: true,
  }),
}))

import NetCheckView from '@/views/NetCheckView/index.vue'

describe('NetCheckView', () => {
  beforeEach(() => {
    mocks.running.value = false
    mocks.groups.value = [
      {
        id: 'overview',
        title: 'netCheck.groups.overview',
        status: 'success',
        summary: '1 success, 1 failed',
        items: [{ id: 'core', title: 'netCheck.results.core', status: 'success', summary: 'ok' }],
      },
      {
        id: 'dns',
        title: 'netCheck.groups.dns',
        status: 'skipped',
        summary: '0 items',
        items: [],
      },
    ]
  })

  it('renders localized count summaries from raw group summaries', () => {
    const wrapper = mountView()

    expect(wrapper.text()).toContain('netCheck.summary.groupCountSuccess')
    expect(wrapper.text()).toContain('netCheck.summary.groupCountFailed')
  })

  it('renders groups and triggers a check', async () => {
    const wrapper = mountView()

    await wrapper.get('[data-action="run-check"]').trigger('click')

    expect(mocks.startPolling).toHaveBeenCalled()
    expect(mocks.run).toHaveBeenCalled()
    expect(wrapper.text()).toContain('netCheck.groups.overview')
    expect(wrapper.text()).toContain('netCheck.groups.dns')
    expect(wrapper.text()).toContain('ok')
  })

  it('shows groupRunning for empty groups while the page is still running', () => {
    mocks.running.value = true
    mocks.groups.value = [
      {
        id: 'dns',
        title: 'netCheck.groups.dns',
        status: 'skipped',
        summary: '0 items',
        items: [],
      },
    ]

    const wrapper = mountView()

    expect(wrapper.text()).toContain('netCheck.summary.groupRunning')
    expect(wrapper.text()).not.toContain('netCheck.results.empty')
  })
})
