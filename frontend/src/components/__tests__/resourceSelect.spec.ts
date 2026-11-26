import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'

import ResourceSelect from '@/components/ResourceSelect/index.vue'

const fixture = vi.hoisted(() => ({
  profiles: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ],
  modal: vi.fn(),
}))
vi.mock('@/stores', () => ({
  useProfilesStore: () => ({
    profiles: fixture.profiles,
    getProfileById: (id: string) => fixture.profiles.find((p) => p.id === id),
  }),
  useSubscribesStore: () => ({}),
  useRulesetsStore: () => ({}),
  usePluginsStore: () => ({}),
  useScheduledTasksStore: () => ({}),
}))
vi.mock('@/utils', () => ({ message: { warn: vi.fn() }, modal: fixture.modal }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

it('discards a canceled draft and commits only explicitly confirmed resources', async () => {
  const model = ref(['a'])
  const renderDialog = shallowRef<() => ReturnType<typeof h>>()
  const submitted = vi.fn()
  const changed = vi.fn()
  let close!: (ok: boolean) => void
  fixture.modal.mockImplementation((options, slots) => ({
    open() {
      renderDialog.value = slots.default
      close = (ok: boolean) => {
        if (ok && !options.onOk()) return
        renderDialog.value = undefined
        options.afterClose(ok)
      }
    },
  }))
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h('div', [
          h(ResourceSelect, {
            type: 'profile',
            modelValue: model.value,
            'onUpdate:modelValue': (ids: string[]) => {
              model.value = ids
            },
            onChange: changed,
            onSubmit: submitted,
          }),
          renderDialog.value?.(),
        ]),
    }),
    {
      global: {
        stubs: {
          Button: { template: '<button><slot /></button>' },
          Card: { props: ['title'], template: '<button>{{title}}</button>' },
          Input: true,
          Empty: true,
        },
      },
    },
  )
  await wrapper.get('button').trigger('click')
  await wrapper.findAll('button')[2]!.trigger('click')
  close(false)
  await nextTick()
  expect(changed).not.toHaveBeenCalled()
  expect(model.value).toEqual(['a'])
  await wrapper.get('button').trigger('click')
  await wrapper.findAll('button')[2]!.trigger('click')
  close(true)
  expect(model.value).toEqual(['a', 'b'])
  expect(changed).toHaveBeenCalledWith(['a', 'b'], fixture.profiles)
  expect(submitted).toHaveBeenCalledWith(['a', 'b'], fixture.profiles)
  wrapper.unmount()
})
