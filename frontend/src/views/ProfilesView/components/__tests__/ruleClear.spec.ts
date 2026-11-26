import { mount, shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores', () => ({
  useNodeGroupsStore: () => ({ nodeGroups: [], getNodeGroupById: vi.fn() }),
  useRulesetsStore: () => ({ rulesets: [], getRulesetById: vi.fn() }),
}))
vi.mock('@/utils', () => ({
  deepClone: (v: any) => JSON.parse(JSON.stringify(v)),
  detectManagedRuleKey: () => undefined,
  ensureProfileRuleset: vi.fn(),
  getOutboundRole: () => 'custom',
  message: { warn: vi.fn() },
  isValidJson: () => true,
  ensureNodeGroupOutlet: vi.fn(),
  sampleID: () => 'new-default',
}))
vi.mock('@/lang', () => ({ default: { global: { t: (key: string) => key } } }))
import { RuleType, RuleAction } from '@/enums/kernel'

import Radio from '@/components/Radio/index.vue'

import DnsRulesConfig from '../DnsRulesConfig.vue'
import RouteRulesConfig from '../RouteRulesConfig.vue'
describe('review clearing missing rule set references', () => {
  it.each([
    ['route', RouteRulesConfig],
    ['DNS', DnsRulesConfig],
  ] as const)(
    '%s preserves the valid reference when removing a missing ruleset',
    async (_name, component) => {
      const rule = {
        id: 'rule-1',
        type: RuleType.RuleSet,
        payload: 'present,missing',
        action: RuleAction.Route,
        server: 'server',
        outbound: 'proxy',
        enable: true,
        invert: false,
      }
      const wrapper = shallowMount(component as any, {
        props: {
          modelValue: [rule],
          inboundOptions: [],
          outboundOptions: [{ label: 'Proxy', value: 'proxy' }],
          serverOptions: [{ label: 'DNS', value: 'server' }],
          serversOptions: [{ label: 'DNS', value: 'server' }],
          ruleSet: [{ id: 'present', tag: 'Present' }],
          outbounds: [],
        },
        global: {
          config: { warnHandler: () => {} },
          stubs: {
            Empty: true,
            Divider: true,
            Switch: true,
            Select: true,
            Radio: true,
            Input: true,
            CodeEditor: true,
            Modal: true,
            Card: { template: '<div><slot/></div>' },
            Button: { template: '<button><slot/></button>' },
          },
          directives: { draggable: {} },
        },
      })
      const clear = wrapper.findAll('button').find((button) => button.text() === 'common.clear')!
      expect(clear).toBeDefined()
      await clear.trigger('click')
      expect(rule.payload).toBe('present')
      wrapper.unmount()
    },
  )

  it('keeps the target-type switch visible when a legacy group target has no node groups left', async () => {
    const rule = {
      id: 'rule-1',
      type: RuleType.Domain,
      payload: 'example.com',
      action: RuleAction.Route,
      server: '',
      outbound: 'proxy',
      enable: true,
      invert: false,
      sniffer: [],
      strategy: 'default',
    }
    const wrapper = mount(RouteRulesConfig as any, {
      props: {
        modelValue: [rule],
        inboundOptions: [],
        outboundOptions: [{ label: 'Proxy', value: 'proxy' }],
        serverOptions: [],
        ruleSet: [],
        outbounds: [
          {
            id: 'proxy',
            tag: 'Proxy',
            type: 'selector',
            source_node_group: 'removed-group',
            outbounds: [],
          },
        ],
      },
      global: {
        components: { Radio },
        stubs: {
          Empty: true,
          Divider: true,
          Switch: true,
          Select: { template: '<div class="select-stub" />' },
          Input: true,
          CodeEditor: true,
          Modal: {
            props: ['open'],
            template: '<div class="modal-stub"><slot /><slot name="action" /></div>',
          },
          Card: { template: '<div><slot /></div>' },
          Button: { template: '<button v-bind="$attrs"><slot /></button>' },
          Tag: true,
          Icon: true,
        },
        directives: { draggable: {} },
      },
    })
    ;(wrapper.vm as any).editById('rule-1')
    await wrapper.vm.$nextTick()

    const options = wrapper.findAll('.gui-radio-button').map((item) => item.text())
    expect(options).toContain('kernel.route.rules.outbound')
    expect(options).toContain('router.nodeGroups')

    const outbound = wrapper
      .findAll('.gui-radio-button')
      .find((item) => item.text() === 'kernel.route.rules.outbound')!
    await outbound.trigger('click')
    expect(wrapper.find('.select-stub').exists()).toBe(true)
    wrapper.unmount()
  })
})
