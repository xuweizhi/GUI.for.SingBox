import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

import type { Column } from '@/components/Table/index.vue'
import type { CoreApiConnectionRecord, CoreApiConnectionsData } from '@/types/kernel'

import ConnectionsController from '../ConnectionsController.vue'

const mocks = vi.hoisted(() => ({
  receive: undefined as ((snapshot: Partial<CoreApiConnectionsData>) => void) | undefined,
  close: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/api/kernel', () => ({ deleteConnection: mocks.close }))
vi.mock('@/stores', () => ({
  useAppStore: () => ({ menuShow: false, menuPosition: {}, menuList: [] }),
  useAppSettingsStore: () => ({ app: { connections: { visibility: {}, order: [] } } }),
  useProfilesStore: () => ({
    currentProfile: undefined,
    addQuickRuleToProfile: vi.fn(),
    addNodeGroupRuleToProfile: vi.fn(),
  }),
  useNodeGroupsStore: () => ({ nodeGroups: [] }),
  useKernelApiStore: () => ({
    onConnections: (handler: typeof mocks.receive) => {
      mocks.receive = handler
      return () => {
        mocks.receive = undefined
      }
    },
  }),
}))
vi.mock('@/utils', () => ({
  confirm: vi.fn().mockResolvedValue(true),
  message: { error: mocks.error },
  quickRulePayloadToEntry: vi.fn(),
}))
vi.mock('@/constant/app', () => ({ DraggableOptions: {} }))
vi.mock('@/constant/kernel', () => ({ DefaultConnections: () => ({}) }))
vi.mock('@/hooks', async () => {
  const { ref } = await import('vue')
  return {
    useBool: () => {
      const state = ref(false)
      return [state, () => (state.value = !state.value)]
    },
  }
})
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false }),
}))

it('combines live filters, closes only matching IDs, and carries the filters over to closed sessions', async () => {
  const wrapper = mount(ConnectionsController, {
    global: {
      stubs: {
        Radio: { template: '<button @click="$emit(\'update:modelValue\', false)">closed</button>' },
        Input: true,
        Button: { props: ['icon'], template: '<button :data-icon="icon"><slot /></button>' },
        MultipleSelect: {
          name: 'FilterSelect',
          props: ['modelValue', 'options'],
          template: '<i />',
        },
        Table: {
          name: 'ConnectionTable',
          props: ['dataSource', 'columns'],
          template: '<p>{{ dataSource.map(row => row.id).join(",") }}</p>',
        },
        Modal: true,
        CodeEditor: true,
        CodeViewer: true,
        Dropdown: true,
        Icon: true,
        Card: true,
        Switch: true,
      },
      directives: { tips() {}, draggable() {} },
    },
  })
  const makeRow = (id: string, chain: string, network: string) =>
    ({
      id,
      chains: [chain],
      rule: 'Match',
      metadata: { sourceIP: '192.0.2.1', network },
    }) as CoreApiConnectionRecord
  const rows = [
    makeRow('a', 'Proxy', 'udp'),
    makeRow('b', 'Proxy', 'tcp'),
    makeRow('c', 'Direct', 'udp'),
  ]
  const columns = wrapper.getComponent({ name: 'ConnectionTable' }).props('columns') as Column[]
  const compare = (key: string) => columns.find((column) => column.key === key)!.sort!
  expect(compare('download')({ download: 1 }, { download: 10 })).toBeLessThan(0)
  expect(compare('metadata.host')(
    { metadata: { destinationIP: '192.0.2.1' } },
    { metadata: { host: 'example.test' } },
  )).toBeLessThan(0)
  mocks.receive!({ connections: rows })
  await wrapper.get('[data-icon="filter"]').trigger('click')
  const filterFor = (value: string) =>
    wrapper
      .findAllComponents({ name: 'FilterSelect' })
      .find((select) =>
        select.props('options').some((opt: { value: string }) => opt.value === value),
      )!
  filterFor('UDP').vm.$emit('update:modelValue', ['UDP'])
  filterFor('Proxy').vm.$emit('update:modelValue', ['Proxy'])
  await flushPromises()
  expect(wrapper.get('p').text()).toBe('a')
  let resolve!: () => void
  mocks.close.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done
      }),
  )
  await wrapper.get('[data-icon="close"]').trigger('click')
  mocks.receive!({ connections: [rows[1]!, makeRow('d', 'Proxy', 'udp')] })
  resolve()
  await flushPromises()
  expect(mocks.close.mock.calls).toEqual([['a']])
  expect(wrapper.get('p').text()).toBe('d')
  await wrapper.get('button').trigger('click')
  expect(wrapper.get('p').text()).toBe('a')
  await wrapper.get('[data-icon="clear"]').trigger('click')
  expect(wrapper.get('p').text()).toBe('')
  filterFor('UDP').vm.$emit('update:modelValue', [])
  filterFor('Direct').vm.$emit('update:modelValue', [])
  await flushPromises()
  expect(wrapper.get('p').text()).toBe('c')
  wrapper.unmount()
})

it('keeps a frozen snapshot stable and counts against the same visible source', async () => {
  const wrapper = mount(ConnectionsController, {
    global: {
      stubs: {
        Radio: true,
        Input: true,
        Button: { props: ['icon'], template: '<button :data-icon="icon"><slot /></button>' },
        MultipleSelect: true,
        Table: {
          name: 'ConnectionTable',
          props: ['dataSource'],
          template: '<div><p>{{ dataSource.map(row => row.id).join(",") }}</p><div v-for="row in dataSource" :data-row="row.id"><slot name="__actions" :record="row" /></div></div>',
        },
        Modal: true,
        CodeEditor: true,
        CodeViewer: true,
        Dropdown: true,
        Icon: true,
        Card: true,
        Switch: true,
      },
      directives: { tips() {}, draggable() {} },
    },
  })
  const makeRow = (id: string) =>
    ({
      id,
      chains: ['Proxy'],
      rule: 'Match',
      upload: 0,
      download: 0,
      start: new Date().toISOString(),
      metadata: { sourceIP: '192.0.2.1', network: 'tcp' },
    }) as CoreApiConnectionRecord
  mocks.receive!({ connections: [makeRow('a'), makeRow('b'), makeRow('c')] })
  await flushPromises()

  await wrapper.get('[data-icon="pause"]').trigger('click')
  mocks.receive!({ connections: [makeRow('b'), makeRow('c'), makeRow('d')] })
  await flushPromises()

  expect(wrapper.get('p').text()).toBe('a,b,c')
  expect(wrapper.text()).toContain('3 / 3')

  mocks.close.mockClear()
  await wrapper.get('[data-row="a"] [data-icon="close"]').trigger('click')
  await flushPromises()
  expect(mocks.close).not.toHaveBeenCalled()
  expect(wrapper.get('p').text()).toBe('b,c')
  mocks.close.mockImplementation((id) =>
    id === 'c' ? Promise.reject(new Error('close failed')) : Promise.resolve(),
  )
  await wrapper.get('[aria-label="home.connections.closeVisible"]').trigger('click')
  await flushPromises()
  expect(mocks.error).toHaveBeenCalledWith('close failed')
  expect(wrapper.get('p').text()).toBe('c')

  await wrapper.get('[data-icon="play"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('p').text()).toBe('c,d')
  wrapper.unmount()
})
