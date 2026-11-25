import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VueDraggable } from 'vue-draggable-plus'

import { FileExists, ReadFile, WriteFile } from '@/bridge'
import { DefaultNodeGroup } from '@/constant/nodeGroup'
import { useNodeGroupsStore, useSubscribesStore } from '@/stores'
import { message } from '@/utils'

import ProxiesView from '../ProxiesView.vue'

vi.mock('@/bridge', () => ({
  FileExists: vi.fn(),
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
  RemoveFile: vi.fn(),
}))
vi.mock('vue-i18n', async (original) => ({
  ...(await original<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

const mountEditor = () => {
  const store = useSubscribesStore()
  const sub = store.getSubscribeTemplate('Manual')
  sub.proxies = [{ id: 'old', tag: 'Example', type: 'socks' }]
  store.subscribes = [sub]
  const group = { ...DefaultNodeGroup(), name: 'Test group' }
  useNodeGroupsStore().nodeGroups = [group]
  vi.mocked(ReadFile).mockResolvedValue(
    JSON.stringify([{ tag: 'Example', type: 'socks', server: 'old' }]),
  )
  return mount(ProxiesView, {
    props: { sub },
    global: {
      config: { warnHandler: () => {} },
      provide: { cancel: vi.fn(), submit: vi.fn() },
      directives: { menu: {} },
      stubs: {
        Card: { template: '<section><slot name="extra" /><slot /></section>' },
        Dropdown: { template: '<div><slot name="overlay" :close="() => {}"/></div>' },
        Modal: {
          props: ['open', 'onOk'],
          template: '<div v-if="open"><slot /><button @click="onOk">confirm</button></div>',
        },
        Button: { template: '<button><slot /></button>' },
        Input: {
          props: ['modelValue'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>',
        },
        CodeEditor: {
          props: ['modelValue'],
          template:
            '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>',
        },
        Empty: true,
        Divider: true,
        Tag: true,
        Select: true,
      },
    },
  })
}
const click = (view: ReturnType<typeof mountEditor>, label: string) =>
  view
    .findAll('button')
    .find((btn) => btn.text() === label)!
    .trigger('click')

describe('subscription node editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(FileExists).mockResolvedValue(false)
    vi.spyOn(message, 'info').mockImplementation(() => undefined as never)
  })
  it('updates drag availability when the visible list is filtered', async () => {
    const view = mountEditor()
    const sortable = view.getComponent(VueDraggable).vm.$.exposed as {
      option: (key: string) => boolean
    }
    expect(sortable.option('disabled')).toBe(false)
    await view.get('input').setValue('Example')
    expect(sortable.option('disabled')).toBe(true)
    await view.get('input').setValue('')
    expect(sortable.option('disabled')).toBe(false)
    view.unmount()
  })
  it('saves the replacement node and commits its group membership only with the editor', async () => {
    const view = mountEditor()
    await click(view, 'common.delete')
    await flushPromises()
    await click(view, 'subscribes.proxies.add')
    await view
      .get('textarea')
      .setValue(JSON.stringify({ tag: 'Example', type: 'http', server: 'new' }))
    await click(view, 'confirm')
    await flushPromises()
    await click(view, 'Test group')
    expect(useNodeGroupsStore().nodeGroups[0]!.members).toEqual([])
    expect(WriteFile).not.toHaveBeenCalled()
    await (view.vm as any).modalSlots.submit().props.onClick()
    const sub = useSubscribesStore().subscribes[0]!
    expect(
      JSON.parse(vi.mocked(WriteFile).mock.calls.find(([path]) => path === sub.path)![1]),
    ).toEqual([{ tag: 'Example', type: 'http', server: 'new' }])
    expect(sub.proxies[0]!.id).not.toBe('old')
    expect(useNodeGroupsStore().nodeGroups[0]!.members[0]?.node_id).toBe(sub.proxies[0]!.id)
    view.unmount()
  })
})
