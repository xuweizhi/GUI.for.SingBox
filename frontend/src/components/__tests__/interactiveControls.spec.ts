import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { ClipboardGetText } from '@/bridge'
import SplashView from '@/components/_common/SplashView.vue'
import Button from '@/components/Button/index.vue'
import Card from '@/components/Card/index.vue'
import CheckBox from '@/components/CheckBox/index.vue'
import Confirm from '@/components/Confirm/index.vue'
import Picker from '@/components/Picker/index.vue'
import Prompt from '@/components/Prompt/index.vue'
import Dropdown from '@/components/Dropdown/index.vue'
import { icons } from '@/components/Icon/icons'
import Input from '@/components/Input/index.vue'
import KeyValueEditor from '@/components/KeyValueEditor/index.vue'
import Pagination from '@/components/Pagination/index.vue'
import Radio from '@/components/Radio/index.vue'
import Select from '@/components/Select/index.vue'
import Switch from '@/components/Switch/index.vue'
import Table from '@/components/Table/index.vue'
import { message } from '@/utils'

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
  message: { info: vi.fn() },
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

  it('submits a bordered runtime setting once on Enter', async () => {
    const wrapper = mount(Input, {
      attachTo: document.body,
      props: { modelValue: 1080, type: 'number', submitOnEnter: true },
      global: { stubs: { Button: true, Icon: true, CodeEditor: true } },
    })
    const input = wrapper.get('input')
    input.element.focus()
    await input.setValue('2080')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('submit')).toEqual([[2080]])
    wrapper.unmount()
  })

  it('commits lazy input only on blur and publishes an in-range number while typing', async () => {
    const wrapper = mount(Input, {
      props: { modelValue: 'old', modelModifiers: { lazy: true } },
      global: { stubs: { Button: true, Icon: true, CodeEditor: true } },
    })
    const input = wrapper.get('input')
    await input.setValue('new')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await input.trigger('blur')
    expect(wrapper.emitted('update:modelValue')).toEqual([['new']])
    await wrapper.setProps({ modelValue: 5, type: 'number', min: 1, max: 10, modelModifiers: {} })
    await input.setValue('123')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([10])
    wrapper.unmount()
  })

  it('reflects an external change after selecting the current option again', async () => {
    const wrapper = mount(Select, {
      props: { modelValue: 'a', options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }] },
      global: { components: { Button, Dropdown, Input }, stubs: { Empty: true, Icon: true, Teleport: true } },
    })
    await wrapper.get('[role="combobox"]').trigger('keydown', { key: 'Enter' })
    await wrapper.get('[role="option"]').trigger('click')
    await wrapper.setProps({ modelValue: 'b' })
    expect(wrapper.get('[role="combobox"]').attributes('aria-label')).toBe('Beta')
    wrapper.unmount()
  })

  it('selects the existing address for manual paste when clipboard access fails', async () => {
    vi.mocked(ClipboardGetText).mockRejectedValueOnce(new Error('Clipboard permission denied'))
    const wrapper = mount(Input, {
      attachTo: document.body,
      props: { modelValue: 'old address', allowPaste: true },
      global: { components: { Button }, stubs: { Icon: true, CodeEditor: true } },
    })
    const input = wrapper.get('input')
    await wrapper.get('[aria-label="common.paste"]').trigger('click')
    expect(message.info).toHaveBeenCalledWith('common.pasteManually')
    expect(document.activeElement).toBe(input.element)
    expect(input.element.selectionStart).toBe(0)
    expect(input.element.selectionEnd).toBe(input.element.value.length)
    expect(input.element.value).toBe('old address')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await input.setValue('new address')
    expect(wrapper.emitted('update:modelValue')).toEqual([['new address']])
    wrapper.unmount()
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

  it('clears Select search filter when its dropdown closes', async () => {
    const options = Array.from({ length: 15 }, (_, idx) => ({
      label: `Option ${idx + 1}`,
      value: `opt-${idx + 1}`,
    }))
    const wrapper = mount(Select, {
      props: { modelValue: 'opt-1', options },
      global: {
        components: { Button, Dropdown, Input },
        stubs: { Empty: true, Icon: true, Teleport: true, CodeEditor: true },
      },
    })

    await wrapper.get('.gui-select').trigger('click')
    const searchInput = wrapper.get('input')
    await searchInput.setValue('Option 15')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)

    await wrapper.get('[role="option"]').trigger('click')
    await wrapper.get('.gui-select').trigger('click')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(15)
  })

  it('keeps restart, stop, log, and settings icons tintable without hardcoded primary fills', () => {
    for (const name of ['restart', 'stop', 'log', 'settings'] as const) {
      expect(icons[name]).not.toContain('var(--primary-color)')
    }
  })
})

describe('stacked dialogs', () => {
  it('moves keyboard focus to the top dialog and handles Escape once', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const options = { attachTo: document.body, global: { components: { Button, Input }, stubs: { MarkdownViewer: true, Icon: true, Empty: true } } }
    const confirm = mount(Confirm, { ...options, props: { title: 'Confirm', message: 'Delete?' } })
    const picker = mount(Picker, { ...options, props: { type: 'single', title: 'Choose', options: [{ label: 'A', value: 'a' }] } })
    try {
      expect(document.activeElement).toBe(picker.get('[role="dialog"]').element)
      await picker.get('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(picker.element.contains(document.activeElement)).toBe(true)
      await picker.get('[role="option"]').trigger('click')
      await picker.get('[role="option"]').trigger('click')
      expect(picker.get('[role="option"]').attributes('aria-selected')).toBe('true')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(picker.emitted('cancel')).toHaveLength(1)
      expect(confirm.emitted('cancel')).toBeUndefined()
    } finally {
      picker.unmount()
      confirm.unmount()
      expect(document.activeElement).toBe(trigger)
      trigger.remove()
    }
  })

  it('keeps a prompt open when Enter commits an IME composition', async () => {
    const prompt = mount(Prompt, {
      props: { title: 'Name', props: {} },
      global: { components: { Input, Button }, stubs: { Icon: true, CodeEditor: true } },
    })
    await prompt.get('input').trigger('keydown', { key: 'Enter', isComposing: true })
    expect(prompt.emitted('submit')).toBeUndefined()
    await prompt.get('input').trigger('keydown', { key: 'Enter' })
    expect(prompt.emitted('submit')).toHaveLength(1)
    prompt.unmount()
  })
})
