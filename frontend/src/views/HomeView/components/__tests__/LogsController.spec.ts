import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import LogsController from '../LogsController.vue'

const mocks = vi.hoisted(() => ({
  refreshKernelLogs: vi.fn(),
  logsStore: {
    apiEntries: [{ id: '1', type: 'info', payload: 'live log', time: 0 }],
    processEntries: [] as unknown[],
    clearSource: vi.fn(),
  },
}))

vi.mock('@/bridge', () => ({ ClipboardSetText: vi.fn().mockResolvedValue(true) }))
vi.mock('@/stores', () => ({
  useKernelApiStore: () => ({ refreshKernelLogs: mocks.refreshKernelLogs }),
  useLogsStore: () => mocks.logsStore,
}))
vi.mock('@/hooks', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useBool: () => {
      const state = vueRef(false)
      return [state, () => (state.value = !state.value)]
    },
  }
})
vi.mock('@/utils', () => ({
  addToRuleSet: vi.fn(),
  buildSmartRegExp: () => /.*/,
  getDomainSuffixes: () => [],
  isValidIPv4: () => false,
  isValidIPv6: () => false,
  message: { success: vi.fn(), error: vi.fn() },
  picker: { multi: vi.fn().mockResolvedValue([]) },
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mountLogs = () =>
  mount(LogsController, {
    global: {
      stubs: {
        Radio: {
          props: ['modelValue', 'options'],
          emits: ['update:modelValue'],
          template:
            '<div><button v-for="o in options" :key="o.value" :class="`source-${o.value}`" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</button></div>',
        },
        Select: true,
        Input: true,
        Switch: true,
        Button: { template: '<button v-bind="$attrs"><slot /></button>' },
        Empty: true,
        Dropdown: { template: '<div><slot /></div>' },
        Tag: true,
        Icon: true,
      },
      directives: { menu: {}, tips: {} },
    },
  })

describe('LogsController core log source', () => {
  it('fetches core output even when API logs already exist', async () => {
    const wrapper = mountLogs()
    expect(mocks.refreshKernelLogs).not.toHaveBeenCalled()

    await wrapper.get('.source-core').trigger('click')
    await Promise.resolve()

    expect(mocks.refreshKernelLogs).toHaveBeenCalled()
  })
})
