import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lang', () => ({ default: { global: { t: (key: string) => key } } }))
vi.mock('@/stores', () => ({
  useSubscribesStore: () => ({
    subscribes: [{ id: 'sub-1', name: 'Sub 1', proxies: [] }],
    getSubscribeById: (id: string) => (id === 'sub-1' ? { id: 'sub-1', name: 'Sub 1' } : undefined),
  }),
  useNodeGroupsStore: () => ({
    nodeGroups: [
      { id: 'ng-relay', name: 'Relay Group', mode: 'manual', members: [] },
      {
        id: 'ng-landing',
        name: 'Landing Group',
        mode: 'manual',
        members: [],
        pre_proxy_group_id: 'ng-relay',
      },
    ],
    getNodeGroupById: (id: string) =>
      id === 'ng-relay'
        ? { id: 'ng-relay', name: 'Relay Group' }
        : id === 'ng-landing'
          ? { id: 'ng-landing', name: 'Landing Group', pre_proxy_group_id: 'ng-relay' }
          : undefined,
  }),
  useRulesetsStore: () => ({ rulesets: [], getRulesetById: () => undefined }),
}))

import {
  DefaultDns,
  DefaultExperimental,
  DefaultInbounds,
  DefaultLog,
  DefaultMixin,
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { getManagedToggleStates } from '@/utils/managedRules'

import SimpleProfileEditor from '../SimpleProfileEditor.vue'

const makeProfile = (): App.Profile => ({
  id: 'p-1',
  name: 'Simple Test',
  primary_proxy_outbound: 'Select',
  log: DefaultLog(),
  experimental: DefaultExperimental(),
  inbounds: DefaultInbounds(),
  outbounds: DefaultOutbounds(),
  route: DefaultRoute(),
  dns: DefaultDns(),
  mixin: DefaultMixin(),
  script: DefaultScript(),
})

describe('SimpleProfileEditor', () => {
  it('switches routing presets, updates quick custom rules, and toggles DNS presets', async () => {
    const profile = makeProfile()
    const wrapper = mount(SimpleProfileEditor, {
      props: { modelValue: profile },
      global: {
        stubs: {
          Card: { template: '<div><slot name="extra" /><slot /></div>' },
          Divider: { template: '<div><slot /></div>' },
          Tag: { template: '<span><slot /></span>' },
          Button: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          Switch: {
            props: ['modelValue'],
            template:
              '<input type="checkbox" :checked="modelValue" @change="$emit(\'change\', $event.target.checked); $emit(\'update:modelValue\', $event.target.checked)" />',
          },
          Select: true,
          Radio: true,
          Input: true,
          Modal: true,
        },
      },
    })

    // Switch routing preset to global
    await wrapper.get('[data-preset="global"]').trigger('click')
    expect(profile.preset).toBe('global')
    expect(profile.route.rules.some((rule) => rule.payload === 'GeoSite-CN')).toBe(false)

    // Enter quick rules
    const proxyTextarea = wrapper.get('[data-testid="quick-rules-proxy"]')
    await proxyTextarea.setValue('openai.com\n1.1.1.1\n# ignored')
    expect(profile.route.quick_rules?.proxy).toEqual(['openai.com', '1.1.1.1'])

    // Switch DNS preset to fakeip
    await wrapper.get('[data-dns-preset="fakeip"]').trigger('click')
    expect(profile.dns.preset).toBe('fakeip')
    expect(profile.experimental.cache_file.store_fakeip).toBe(true)

    // System toggles are reflected accurately
    expect(getManagedToggleStates(profile).hijackDns).toBe(true)
    wrapper.unmount()
  })

  it('edits an existing custom service rule in place', async () => {
    const profile = makeProfile()
    profile.route.rules.splice(5, 0, {
      id: 'rule-custom-domain',
      type: 'domain_suffix' as any,
      enable: true,
      payload: 'openai.com',
      invert: false,
      action: 'route' as any,
      outbound: 'Select',
      sniffer: [],
      strategy: 'default' as any,
      server: '',
    })

    const wrapper = mount(SimpleProfileEditor, {
      props: { modelValue: profile },
      global: {
        stubs: {
          Card: { template: '<div><slot name="extra" /><slot /></div>' },
          Divider: { template: '<div><slot /></div>' },
          Tag: { template: '<span><slot /></span>' },
          Button: {
            props: ['icon'],
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          },
          Switch: true,
          Select: true,
          Radio: {
            props: ['modelValue', 'options'],
            template:
              '<div><button v-for="o in options" :key="o.value" :data-radio="o.value" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</button></div>',
          },
          Input: {
            props: ['modelValue'],
            template:
              '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          Modal: {
            props: ['open', 'onOk'],
            template:
              '<div v-if="open"><slot /><button data-testid="modal-ok" @click="onOk?.()">ok</button></div>',
          },
        },
      },
    })

    await wrapper.get('[data-testid="edit-service-rule-rule-custom-domain"]').trigger('click')
    await wrapper.get('[data-testid="edit-service-rule-payload"]').setValue('claude.ai')
    await wrapper.get('[data-radio="direct"]').trigger('click')
    await wrapper.get('[data-testid="modal-ok"]').trigger('click')

    const updated = profile.route.rules.find((r) => r.id === 'rule-custom-domain')!
    expect(updated.payload).toBe('claude.ai')
    expect(updated.outbound).toBe('outbound-direct')
    wrapper.unmount()
  })

  it('preserves custom outbound targets when editing an existing service rule without re-picking target', async () => {
    const profile = makeProfile()
    profile.outbounds.push({
      ...profile.outbounds[0]!,
      id: 'custom-ai-group',
      tag: 'AI Custom Group',
    })
    profile.route.rules.splice(5, 0, {
      id: 'rule-custom-out',
      type: 'domain_suffix' as any,
      enable: true,
      payload: 'openai.com',
      invert: false,
      action: 'route' as any,
      outbound: 'custom-ai-group',
      sniffer: [],
      strategy: 'default' as any,
      server: '',
    })

    const wrapper = mount(SimpleProfileEditor, {
      props: { modelValue: profile },
      global: {
        stubs: {
          Card: { template: '<div><slot name="extra" /><slot /></div>' },
          Divider: { template: '<div><slot /></div>' },
          Tag: { template: '<span><slot /></span>' },
          Button: {
            props: ['icon'],
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          },
          Switch: true,
          Select: true,
          Radio: true,
          Input: {
            props: ['modelValue'],
            template:
              '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          Modal: {
            props: ['open', 'onOk'],
            template:
              '<div v-if="open"><slot /><button data-testid="modal-ok" @click="onOk?.()">ok</button></div>',
          },
        },
      },
    })

    await wrapper.get('[data-testid="edit-service-rule-rule-custom-out"]').trigger('click')
    await wrapper.get('[data-testid="edit-service-rule-payload"]').setValue('anthropic.com')
    await wrapper.get('[data-testid="modal-ok"]').trigger('click')

    const updated = profile.route.rules.find((r) => r.id === 'rule-custom-out')!
    expect(updated.payload).toBe('anthropic.com')
    expect(updated.outbound).toBe('custom-ai-group')
    wrapper.unmount()
  })

  it('adds selected node groups as independent switchable subgroups by default and supports toggling behavior and flatten mode', async () => {
    const profile = makeProfile()
    const wrapper = mount(SimpleProfileEditor, {
      props: { modelValue: profile },
      global: {
        stubs: {
          Card: { template: '<div><slot name="extra" /><slot /></div>' },
          Divider: { template: '<div><slot /></div>' },
          Tag: { template: '<span><slot /></span>' },
          Button: {
            props: ['icon'],
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          },
          Switch: true,
          Select: {
            props: { modelValue: null, options: Array, multiple: Boolean },
            template:
              '<button v-if="multiple && options?.some(o => o.value === \'ng-relay\')" data-testid="pick-node-groups" @click="$emit(\'update:modelValue\', [\'ng-relay\', \'ng-landing\'])">pick</button><div v-else />',
          },
          Radio: {
            props: ['modelValue', 'options'],
            template:
              '<div><button v-for="o in options" :key="o.value" :data-radio="o.value" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</button></div>',
          },
          Input: true,
          Modal: true,
        },
      },
    })

    // Select both node groups -> default mode is independent switchable subgroups (urltest)
    await wrapper.get('[data-testid="pick-node-groups"]').trigger('click')
    const primary = profile.outbounds.find((o) => o.id === 'outbound-select')!
    const relaySub = profile.outbounds.find((o) => o.source_node_group === 'ng-relay')
    const landingSub = profile.outbounds.find((o) => o.source_node_group === 'ng-landing')
    expect(relaySub?.type).toBe('urltest')
    expect(landingSub?.type).toBe('urltest')
    expect(primary.outbounds.some((m) => m.type === 'Built-in' && m.id === relaySub!.id)).toBe(true)
    expect(primary.outbounds.some((m) => m.type === 'Built-in' && m.id === landingSub!.id)).toBe(
      true,
    )
    expect(primary.outbounds.some((m) => m.type === 'NodeGroup')).toBe(false)

    // Toggle ng-landing subgroup from auto (urltest) to manual (selector)
    await wrapper.get('[data-testid="toggle-subgroup-behavior-ng-landing"]').trigger('click')
    const landingManual = profile.outbounds.find((o) => o.source_node_group === 'ng-landing')
    expect(landingManual?.type).toBe('selector')
    expect(primary.outbounds.some((m) => m.type === 'Built-in' && m.id === landingManual!.id)).toBe(
      true,
    )

    // Switch mode to flatten -> replaces subgroup Built-in references with direct NodeGroup members & prunes unused outlets
    await wrapper.get('[data-radio="flatten"]').trigger('click')
    expect(primary.outbounds.filter((m) => m.type === 'NodeGroup').map((m) => m.id)).toEqual([
      'ng-relay',
      'ng-landing',
    ])
    expect(profile.outbounds.some((o) => o.source_node_group === 'ng-relay')).toBe(false)
    expect(profile.outbounds.some((o) => o.source_node_group === 'ng-landing')).toBe(false)
    wrapper.unmount()
  })
})
