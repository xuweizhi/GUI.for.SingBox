import { flushPromises, mount } from '@vue/test-utils'
import { EditorView } from 'codemirror'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ themeMode: 'light' }),
  useSubscribesStore: () => ({ editSubscribe: vi.fn() }),
}))
const real = vi.hoisted(() => ({ debounce: undefined as any }))
vi.mock('@/utils', () => ({
  debounce: (...args: any[]) => real.debounce(...args),
  deepClone: (v: any) => JSON.parse(JSON.stringify(v)),
  ignoredError: async (fn: any, ...args: any[]) => {
    try {
      return await fn(...args)
    } catch {
      return undefined
    }
  },
  message: { error: vi.fn() },
  omitArray: (v: any) => v,
  reconcileSubscriptionProxyIds: () => [],
  sampleID: () => 'id',
  APP_TITLE: 'Review',
  APP_VERSION: '1',
  isValidIPv4: () => true,
  isValidIPv6: () => false,
}))
vi.mock('@/utils/completion', () => ({ getCompletions: () => [] }))
vi.mock('@/components/Modal/index.vue', () => ({ IS_IN_MODAL: 'IS_IN_MODAL' }))
vi.mock('@/bridge', () => ({
  ReadFile: vi.fn().mockResolvedValue('[]'),
  WriteFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
import { debounce } from '@/utils/others'
real.debounce = debounce
import { WriteFile } from '@/bridge'
import ProxiesEditor from '@/views/SubscribesView/components/ProxiesEditor.vue'

import CodeEditor from '@/components/CodeEditor/index.vue'
afterEach(() => {
  vi.useRealTimers()
})
it.each([100, 350])(
  'saves the latest typed code when Save is clicked %d ms after typing',
  async (delay) => {
    vi.mocked(WriteFile).mockClear()
    Range.prototype.getClientRects = () => [] as any
    Range.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
    })
    vi.useFakeTimers()
    const wrapper = mount(ProxiesEditor, {
      props: {
        sub: {
          id: 'sub',
          name: 'Sub',
          path: 'data/review.json',
          proxies: [],
          type: 'Manual',
        } as any,
      },
      global: {
        components: { CodeEditor },
        stubs: { Button: true },
        provide: { cancel: vi.fn(), submit: vi.fn() },
      },
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!
    const edited = JSON.stringify([
      { tag: 'new', type: 'socks', server: '127.0.0.1', server_port: 1080 },
    ])
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edited } })
    await vi.advanceTimersByTimeAsync(delay)
    await (wrapper.vm as any).modalSlots.submit().props.onClick()
    try {
      expect(WriteFile).toHaveBeenCalledWith(
        'data/review.json',
        JSON.stringify(JSON.parse(edited), null, 2),
      )
    } finally {
      wrapper.unmount()
    }
  },
)

it('preserves selection on v-model feedback and cancels stale change on external replacement', async () => {
  vi.useFakeTimers()
  const wrapper = mount(CodeEditor, {
    props: { modelValue: '[]', editable: true },
    global: { stubs: { Button: true } },
  })
  await vi.advanceTimersByTimeAsync(0)
  const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!
  view.dispatch({ changes: { from: 1, insert: '1' }, selection: { anchor: 2 } })
  expect(wrapper.emitted('update:modelValue')).toEqual([['[1]']])
  await wrapper.setProps({ modelValue: '[1]' })
  await flushPromises()
  expect(view.state.selection.main.anchor).toBe(2)
  expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  await wrapper.setProps({ modelValue: '[2,3]' })
  await flushPromises()
  expect(view.state.doc.toString()).toBe('[2,3]')
  await vi.advanceTimersByTimeAsync(350)
  expect(wrapper.emitted('change')).toBeUndefined()
  expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  view.dispatch({ changes: { from: 1, to: 2, insert: '4' } })
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['[4,3]'])
  await vi.advanceTimersByTimeAsync(350)
  expect(wrapper.emitted('change')).toEqual([['[4,3]']])
  wrapper.unmount()
})
