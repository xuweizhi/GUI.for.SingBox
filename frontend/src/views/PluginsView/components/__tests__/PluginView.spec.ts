import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { ReadFile, WriteFile } from '@/bridge'

import PluginView from '../PluginView.vue'

vi.mock('@/bridge', () => ({ ReadFile: vi.fn(), WriteFile: vi.fn() }))
vi.mock('@/stores', () => ({
  usePluginsStore: () => ({
    getPluginById: () => ({ id: 'local', path: 'source.js' }),
    getPluginMetadata: () => ({}),
    getPluginCodefromCache: () => undefined,
    reloadPlugin: vi.fn(),
  }),
}))
vi.mock('@/utils', () => ({
  deepClone: (value: unknown) => structuredClone(value),
  message: { error: vi.fn() },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('plugin source editor', () => {
  it.each([true, false])('guards save until source loading succeeds (%s)', async (succeeds) => {
    vi.clearAllMocks()
    const source = Promise.withResolvers<string>()
    vi.mocked(ReadFile).mockReturnValueOnce(source.promise)
    const view = mount(PluginView, {
      props: { id: 'local' },
      global: { provide: { submit: vi.fn(), cancel: vi.fn() }, stubs: { CodeEditor: true } },
    })
    const save = () => (view.vm as any).modalSlots.submit().props
    expect(save().disabled).toBe(true)
    await save().onClick()
    expect(WriteFile).not.toHaveBeenCalled()
    if (succeeds) source.resolve('const loaded = true')
    else source.reject(new Error('missing'))
    await flushPromises()
    expect(save().disabled).toBe(!succeeds)
    await save().onClick()
    if (succeeds) expect(WriteFile).toHaveBeenCalledWith('source.js', 'const loaded = true')
    else expect(WriteFile).not.toHaveBeenCalled()
    view.unmount()
  })
})
