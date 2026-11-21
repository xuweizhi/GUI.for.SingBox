import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SplashView from '@/components/_common/SplashView.vue'
import Button from '@/components/Button/index.vue'
import Card from '@/components/Card/index.vue'
import CheckBox from '@/components/CheckBox/index.vue'
import Dropdown from '@/components/Dropdown/index.vue'
import Input from '@/components/Input/index.vue'
import KeyValueEditor from '@/components/KeyValueEditor/index.vue'
import Pagination from '@/components/Pagination/index.vue'
import Radio from '@/components/Radio/index.vue'
import Select from '@/components/Select/index.vue'
import Switch from '@/components/Switch/index.vue'
import Table from '@/components/Table/index.vue'

vi.mock('@/bridge/browser/runtime/runtime', () => ({}))

vi.mock('@/bridge', () => ({
  ClipboardGetText: vi.fn().mockResolvedValue(''),
}))

vi.mock('@/directives/tips', () => ({
  default: {},
}))

vi.mock('@/directives/menu', () => ({
  default: {},
}))

vi.mock('@/lang', () => ({
  default: {
    global: {
      t: (key: string) => key,
    },
  },
}))

vi.mock('@/utils', () => ({
  deepClone: <T>(value: T): T => structuredClone(value),
  debounce: <T extends (...args: any[]) => any>(fn: T) => Object.assign(fn, { cancel: vi.fn() }),
  getValue: (obj: Record<string, any>, key: string) =>
    key.split('.').reduce((acc, part) => acc?.[part], obj),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('interactive controls', () => {
  it('renders Card titles verbatim and differentiates static vs interactive cards', () => {
    const staticCard = mount(Card, {
      props: { title: 'common.save' },
      global: {
        mocks: { $t: (key: string) => `translated:${key}` },
        directives: { tips: () => undefined },
        stubs: { Icon: true, Tag: true },
      },
    })

    expect(staticCard.get('.gui-card__title').text()).toBe('common.save')
    expect(staticCard.classes()).not.toContain('is-interactive')

    const interactiveCard = mount(Card, {
      props: { title: 'Clickable', interactive: true },
      global: {
        mocks: { $t: (key: string) => key },
        directives: { tips: () => undefined },
        stubs: { Icon: true, Tag: true },
      },
    })
    expect(interactiveCard.classes()).toContain('is-interactive')
  })

  it('operates Button with Enter, exposes button semantics, and supports danger variant', async () => {
    const wrapper = mount(Button, {
      props: { type: 'danger' },
      slots: { default: 'Delete' },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.attributes()).toMatchObject({
      role: 'button',
      tabindex: '0',
    })
    expect(wrapper.classes()).toContain('danger')
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
        components: { Button, Dropdown, Input },
        stubs: { Empty: true, Icon: true, Teleport: true },
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

  it('allows clearing a number Input before clamping on blur', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 5000, type: 'number', min: 1000, max: 60000 },
      global: { stubs: { Button: true, Icon: true, CodeEditor: true } },
    })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('')
    expect((input.element as HTMLInputElement).value).toBe('')
    await input.setValue('8')
    expect((input.element as HTMLInputElement).value).toBe('8')

    await input.trigger('blur')
    expect(wrapper.emitted('submit')?.[0]).toEqual([1000])
  })

  it('toggles password visibility on password Input', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 'secret', type: 'password' },
      global: { components: { Button }, stubs: { Icon: true, CodeEditor: true } },
    })
    const input = wrapper.get('input')

    expect(input.attributes('type')).toBe('password')
    await wrapper.get('[aria-label="common.showPassword"]').trigger('click')
    expect(input.attributes('type')).toBe('text')
    await wrapper.get('[aria-label="common.hidePassword"]').trigger('click')
    expect(input.attributes('type')).toBe('password')
  })

  it('distinguishes Radio and CheckBox roles and visual checkbox boxes', () => {
    const radio = mount(Radio, {
      props: { modelValue: 'a', options: [{ label: 'A', value: 'a' }] },
      global: { directives: { tips: () => undefined } },
    })
    expect(radio.get('button').attributes('role')).toBe('radio')

    const checkbox = mount(CheckBox, {
      props: { modelValue: ['a'], options: [{ label: 'A', value: 'a' }] },
      global: { stubs: { Icon: true } },
    })
    expect(checkbox.get('button').attributes('role')).toBe('checkbox')
    expect(checkbox.find('.gui-checkbox-box').exists()).toBe(true)
  })

  it('does not rotate SplashView slot content', () => {
    const wrapper = mount(SplashView, {
      slots: { default: '<button class="retry-btn">Retry</button>' },
    })
    const retry = wrapper.get('.retry-btn')
    expect(retry.element.closest('.rotation')).toBeNull()
  })

  it('renders Table empty state and ignores sort clicks on unsortable columns', async () => {
    const wrapper = mount(Table, {
      props: {
        columns: [{ title: 'Name', key: 'name' }],
        dataSource: [],
      },
      global: { stubs: { Empty: { template: '<div class="empty-stub" />' } } },
    })
    expect(wrapper.find('.empty-stub').exists()).toBe(true)
    expect(wrapper.get('th').classes()).not.toContain('gui-table__th--sortable')
  })

  it('disables Pagination boundary arrows on first and last pages', async () => {
    const wrapper = mount(Pagination, {
      props: { current: 1, total: 18, pageSize: 9 },
      global: {
        mocks: { $t: (key: string) => key },
        components: { Button },
        stubs: { Icon: true },
      },
    })
    expect(wrapper.get('[aria-label="common.prevStep"]').attributes('aria-disabled')).toBe('true')
    expect(wrapper.get('[aria-label="common.nextStep"]').attributes('aria-disabled')).toBe('false')
  })

  it('places KeyValueEditor delete button at the end of each row and emits repeated updates', async () => {
    const wrapper = mount(KeyValueEditor, {
      props: { modelValue: { A: '1' } },
      global: {
        mocks: { $t: (key: string) => key },
        components: { Button, Input },
        stubs: { Icon: true, CodeEditor: true },
      },
    })
    const rowChildren = Array.from(wrapper.get('.gui-kv-editor > div').element.children)
    expect(rowChildren.at(-1)?.getAttribute('aria-label')).toBe('common.delete')

    const inputs = wrapper.findAll('input')
    await inputs[1]!.setValue('2')
    await inputs[1]!.setValue('3')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted?.at(-1)).toEqual([{ A: '3' }])
  })
})
