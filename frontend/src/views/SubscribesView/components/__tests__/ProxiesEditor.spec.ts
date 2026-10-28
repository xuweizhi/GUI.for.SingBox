import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: vi.fn().mockResolvedValue(''),
}))
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

import { ReadFile, WriteFile } from '@/bridge'
import { useSubscribesStore } from '@/stores/subscribes'
import { message } from '@/utils'
import ProxiesEditor from '@/views/SubscribesView/components/ProxiesEditor.vue'

const endpoint = {
  type: 'wireguard',
  tag: 'WG',
  _gui_kind: 'endpoint',
  private_key: 'old-key',
  address: ['10.0.0.2/32'],
  peers: [{ address: 'wg.example', port: 51820, public_key: 'public', reserved: [1, 2, 3] }],
  mtu: 1420,
}

const mountEditor = (sub: App.Subscription) =>
  mount(ProxiesEditor, {
    props: { sub },
    global: {
      provide: { cancel: vi.fn(), submit: vi.fn() },
      stubs: {
        CodeEditor: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  })

const saveEditor = async (wrapper: ReturnType<typeof mountEditor>) => {
  const exposed = wrapper.vm as unknown as {
    modalSlots: { submit: () => { props: { onClick: () => Promise<void> } } }
  }
  await exposed.modalSlots.submit().props.onClick()
  await flushPromises()
}

describe('subscription raw endpoint editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(WriteFile).mockReset()
    vi.mocked(WriteFile).mockResolvedValue('')
    vi.mocked(ReadFile).mockReset()
  })

  it('edits, saves, and reloads protocol fields, DNS metadata, and stable endpoint identities', async () => {
    const store = useSubscribesStore()
    const sub = {
      ...store.getSubscribeTemplate('Manual'),
      type: 'Manual',
      proxies: [{ id: 'stable', tag: 'WG', type: 'wireguard', kind: 'endpoint' }],
      importedDns: { servers: [{ type: 'local', tag: 'provider' }], resolver: 'provider' },
    } as App.Subscription
    store.subscribes = [sub]
    vi.mocked(ReadFile).mockResolvedValue(JSON.stringify([endpoint]))
    const wrapper = mountEditor(sub)
    await flushPromises()
    const editor = wrapper.get('textarea')
    const value = JSON.parse(editor.element.value)
    expect(value.endpoints[0]).not.toHaveProperty('_gui_kind')
    expect(value.endpoints[0].__id_in_gui).toBe('stable')
    value.endpoints[0].private_key = 'new-key'
    value.endpoints[0].tag = 'Renamed WG'
    await editor.setValue(JSON.stringify(value))
    await saveEditor(wrapper)

    const call = vi.mocked(WriteFile).mock.calls.find(([path]) => path === sub.path)!
    const saved = JSON.parse(call[1])
    expect(saved).toEqual([{ ...endpoint, private_key: 'new-key', tag: 'Renamed WG' }])
    expect(store.subscribes[0]!.proxies).toEqual([
      { id: 'stable', tag: 'Renamed WG', type: 'wireguard', kind: 'endpoint' },
    ])
    expect(store.subscribes[0]!.importedDns).toEqual(sub.importedDns)
    vi.mocked(ReadFile).mockResolvedValue(call[1])
    const reloaded = mountEditor(store.subscribes[0]!)
    await flushPromises()
    const reloadedValue = JSON.parse(reloaded.get('textarea').element.value)
    expect(reloadedValue.endpoints[0]).toMatchObject({
      private_key: 'new-key',
      mtu: 1420,
      peers: endpoint.peers,
      __id_in_gui: 'stable',
    })
    wrapper.unmount()
    reloaded.unmount()
  })
  it.each([false, true])(
    'restores the cache after metadata save failure and reports rollback failure: %s',
    async (rollbackFails) => {
      const store = useSubscribesStore()
      const sub = {
        ...store.getSubscribeTemplate('Manual'),
        type: 'Manual',
        proxies: [{ id: 'stable', tag: 'WG', type: 'wireguard', kind: 'endpoint' }],
      } as App.Subscription
      store.subscribes = [sub]
      const previousContent = JSON.stringify([endpoint])
      vi.mocked(ReadFile).mockResolvedValue(previousContent)
      const edit = vi
        .spyOn(store, 'editSubscribe')
        .mockRejectedValue(new Error('metadata write failed'))
      const error = vi.spyOn(message, 'error').mockImplementation(() => undefined as never)
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const wrapper = mountEditor(sub)
      try {
        await flushPromises()
        const editor = wrapper.get('textarea')
        const value = JSON.parse(editor.element.value)
        value.endpoints[0].tag = 'Changed'
        await editor.setValue(JSON.stringify(value))
        if (rollbackFails)
          vi.mocked(WriteFile)
            .mockResolvedValueOnce('')
            .mockRejectedValueOnce(new Error('rollback denied'))
        await saveEditor(wrapper)
        expect(WriteFile).toHaveBeenLastCalledWith(sub.path, previousContent)
        expect(store.subscribes[0]!.proxies[0]!.tag).toBe('WG')
        expect(error).toHaveBeenCalledWith(
          rollbackFails
            ? 'Failed to save subscription (metadata write failed) and restore node cache (rollback denied)'
            : 'metadata write failed',
        )
      } finally {
        edit.mockRestore()
        error.mockRestore()
        log.mockRestore()
        wrapper.unmount()
      }
    },
  )
})
