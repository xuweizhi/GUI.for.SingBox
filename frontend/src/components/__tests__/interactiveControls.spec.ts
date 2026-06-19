import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Button from '@/components/Button/index.vue'
import Dropdown from '@/components/Dropdown/index.vue'
import Select from '@/components/Select/index.vue'
import Switch from '@/components/Switch/index.vue'

vi.mock('@/lang', () => ({
  default: {
    global: {
      t: (key: string) => key,
    },
  },
}))

vi.mock('@/utils', () => ({
  deepClone: <T>(value: T): T => structuredClone(value),
  debounce: <T extends (...args: any[]) => any>(fn: T) =>
    Object.assign(fn, { cancel: vi.fn() }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('interactive controls', () => {
  it('operates Button with Enter and exposes button semantics', async () => {
    const wrapper = mount(Button, {
      slots: { default: 'Run' },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.attributes()).toMatchObject({
      role: 'button',
      tabindex: '0',
    })
    await wrapper.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('operates Switch with Space and exposes checked state', async () => {
    const wrapper = mount(Switch, {
      props: { modelValue: false, label: 'Sort' },
      global: { directives: { tips: () => undefined } },
    })

    expect(wrapper.attributes()).toMatchObject({
      role: 'switch',
      tabindex: '0',
      'aria-checked': 'false',
    })
    await wrapper.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })

  it('opens Select from the keyboard and exposes combobox semantics', async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: 'Proxy',
        options: [{ label: 'Proxy', value: 'Proxy' }],
      },
      global: {
        components: { Button, Dropdown },
        stubs: { Empty: true, Icon: true },
      },
    })
    const trigger = wrapper.get('.gui-select')

    expect(trigger.attributes()).toMatchObject({
      role: 'combobox',
      tabindex: '0',
      'aria-expanded': 'false',
    })
    await trigger.trigger('keydown', { key: 'Enter' })
    expect(trigger.attributes('aria-expanded')).toBe('true')
  })
})
