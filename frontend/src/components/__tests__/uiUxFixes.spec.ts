import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import Button from '@/components/Button/index.vue'
import Card from '@/components/Card/index.vue'
import Divider from '@/components/Divider/index.vue'
import Menu from '@/components/Menu/index.vue'
import Modal from '@/components/Modal/index.vue'
import Table from '@/components/Table/index.vue'

vi.mock('@/directives/tips', () => ({ default: {} }))
vi.mock('@/directives/menu', () => ({ default: {} }))
vi.mock('@/lang', () => ({ default: { global: { t: (key: string) => key } } }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/utils', () => ({
  debounce: <T extends (...args: any[]) => any>(fn: T) =>
    Object.assign(fn, { cancel: vi.fn() }),
  getValue: (obj: Record<string, any>, key: string) =>
    key.split('.').reduce((acc, part) => acc?.[part], obj),
  sampleID: () => 'modal-id',
}))
vi.mock('@/hooks', async () => {
  const { ref } = await import('vue')
  return {
    useBool: () => {
      const state = ref(false)
      return [state, () => (state.value = !state.value)]
    },
  }
})
vi.mock('@/stores', () => ({
  useAppStore: () => ({
    modalMinimizers: new Set(),
    modalMinimized: [],
    modalStack: [],
    modalZIndexCounter: 999,
  }),
}))

const common = {
  global: {
    mocks: { $t: (key: string) => key },
    stubs: { Icon: true, Empty: true, Tag: true },
  },
}

const menus: App.Menu[] = [
  { label: 'enabled', handler: vi.fn() },
  { label: 'parent', children: [{ label: 'child', handler: vi.fn() }] },
  { label: 'disabled-parent', disabled: true, children: [{ label: 'hidden' }] },
  { label: 'last', handler: vi.fn() },
]

const mountMenu = () =>
  mount(Menu, {
    props: { modelValue: true, position: { x: 10, y: 10 }, menuList: menus },
    attachTo: document.body,
    global: { ...common.global, components: { Button, Divider } },
  })

describe('UI/UX regression fixes', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Card exposes selected/flush states and triggers click from the keyboard', async () => {
    const onClick = vi.fn()
    const wrapper = mount(Card, {
      props: { selected: true, flush: true },
      attrs: { onClick },
      ...common,
    })
    expect(wrapper.classes()).toContain('is-selected')
    expect(wrapper.classes()).toContain('is-flush')
    await wrapper.trigger('keydown.enter')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Divider only renders its label span when a default slot is provided', () => {
    const plain = mount(Divider, { ...common })
    expect(plain.classes()).toContain('my-12')
    expect(plain.find('span').exists()).toBe(false)

    const small = mount(Divider, { props: { size: 'small' }, slots: { default: 'Label' }, ...common })
    expect(small.classes()).toContain('my-4')
    expect(small.get('span').text()).toBe('Label')
  })

  it('Table uses an inner ellipsis wrapper, exposes customRender text as title, and marks fixed/sortable columns', () => {
    const wrapper = mount(Table, {
      props: {
        sort: 'rendered',
        columns: [
          {
            title: 'Name',
            key: 'name',
            ellipsis: true,
            sort: () => 0,
            customRender: () => 'Rendered name',
          },
          { title: 'Actions', key: 'actions', fixed: 'right' },
        ],
        dataSource: [{ id: '1', name: 'A very long original name' }],
      },
      ...common,
    })
    const td = wrapper.get('tbody td')
    expect(td.get('.cell-ellipsis__inner').text()).toBe('Rendered name')
    expect(td.attributes('title')).toBe('Rendered name')
    expect(wrapper.get('th[aria-sort]').attributes('aria-sort')).toBe('none')
    expect(wrapper.findAll('th')[1]!.classes()).toContain('fixed-right')
    expect(wrapper.classes()).toContain('has-fixed-right')
  })

  it('Menu skips disabled entries, wraps ArrowUp from no focus, and toggles a submenu', async () => {
    const wrapper = mountMenu()
    await nextTick()

    const buttons = wrapper.findAll('[role="menuitem"]')
    const enabledButtons = buttons.filter(
      (button) => button.attributes('aria-disabled') !== 'true',
    )
    expect(enabledButtons).toHaveLength(3)

    ;(document.activeElement as HTMLElement | null)?.blur()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    await nextTick()
    expect(document.activeElement?.textContent).toContain('last')

    const disabledParent = buttons.find((button) => button.text().includes('disabled-parent'))!
    await disabledParent.trigger('mouseenter')
    await nextTick()
    const secondary = wrapper.findAll('.gui-menu')[1]!
    expect(secondary.isVisible()).toBe(false)

    const parent = buttons.find((button) => button.text().includes('parent'))!
    await parent.trigger('click')
    await nextTick()
    expect(secondary.isVisible()).toBe(true)
    await parent.trigger('click')
    await nextTick()
    expect(secondary.isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('Button remains a div-based control but is part of the no-selection selector contract', () => {
    const wrapper = mount(Button, { slots: { default: 'Save' }, ...common })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.classes()).toContain('gui-button')
    expect(wrapper.attributes('role')).toBe('button')
  })

  it('Modal hides maximize for drawers and keeps it for sized dialogs', () => {
    const global = {
      mocks: { $t: (key: string) => key },
      stubs: {
        Teleport: true,
        Transition: false,
        Icon: true,
        Button: {
          props: ['icon'],
          template: '<button :data-icon="icon"><slot /></button>',
        },
        Input: true,
      },
    }
    const drawer = mount(Modal, {
      props: { open: true, size: 'drawer', title: 'Drawer' },
      slots: { default: 'Body' },
      global,
    })
    expect(drawer.find('[data-icon="maximize"]').exists()).toBe(false)
    expect(drawer.find('[data-icon="close"]').exists()).toBe(true)
    drawer.unmount()

    const dialog = mount(Modal, {
      props: { open: true, title: 'Dialog' },
      slots: { default: 'Body' },
      global,
    })
    expect(dialog.find('[data-icon="maximize"]').exists()).toBe(true)
    dialog.unmount()
  })
})
