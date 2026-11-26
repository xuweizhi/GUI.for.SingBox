import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  native: vi.fn(),
  confirm: vi.fn(),
  mode: 'rule',
}))
vi.mock('@/api/kernel', () => ({ queryDNSViaNode: mocks.native }))
vi.mock('@/bridge/browser/shared/webui', () => ({ invokeBridge: mocks.request }))
vi.mock('@/utils/interaction', () => ({ confirm: mocks.confirm, message: { error: vi.fn() } }))
vi.mock('@/utils/generator', () => ({ generateDnsTransports: (dns: App.Dns) => dns.servers }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => false }) }))
vi.mock('@/stores/appSettings', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { branch: 'main' } } }),
}))
vi.mock('@/stores/profiles', () => ({ useProfilesStore: () => ({ currentProfile: {} }) }))
vi.mock('@/stores/kernelApi', () => ({
  useKernelApiStore: () => ({
    running: true,
    get config() {
      return { mode: mocks.mode }
    },
    refreshConfig: vi.fn(),
    refreshProviderProxies: vi.fn(),
    proxies: {
      Proxy: { name: 'Proxy', type: 'Selector', now: 'chosen' },
      chosen: { name: 'chosen', type: 'Socks' },
    },
  }),
}))
vi.mock('@/views/HomeView/nodeController', () => ({
  resolvePrimaryProxyGroup: () => ({ name: 'Proxy' }),
  resolveProxyChain: () => ({ leaf: { type: 'Socks' }, leafName: 'chosen' }),
}))

import DnsComparison from '../DnsComparison.vue'

const mountComparison = () =>
  mount(DnsComparison, {
    props: {
      profile: {
        dns: { servers: [{ tag: 'dns', id: 'dns-id', type: 'https' }] },
        outbounds: [],
      } as unknown as App.Profile,
    },
    global: {
      stubs: {
        Modal: {
          props: ['open'],
          template: '<div v-if="open"><slot /><slot name="action" /></div>',
        },
        Button: { template: '<button><slot /></button>' },
        Select: true,
        Card: { template: '<div><slot /></div>' },
        Input: true,
      },
    },
  })

describe('DNS comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mode = 'rule'
    mocks.request.mockResolvedValue({ answers: ['192.0.2.1'], durationMs: 7 })
  })

  it('uses the selected proxy and requires confirmation before changing the profile default', async () => {
    const wrapper = mountComparison()
    await wrapper.get('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    const paths = mocks.request.mock.calls.map(([, [req]]) => [
      req.path,
      req.proxy,
      req.selections.Proxy,
      req.branch,
    ])
    expect(paths).toEqual([
      ['direct', 'chosen', 'chosen', 'main'],
      ['proxy', 'chosen', 'chosen', 'main'],
    ])
    expect(wrapper.text()).toContain('192.0.2.1 · 7 ms')
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.findAll('button')[2]!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.findAll('button')[3]!.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.findAll('button')[2]!.trigger('click')
    await wrapper.findAll('button')[4]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['dns-id']])
    wrapper.unmount()
  })

  it('uses an active core DNS extension when present', async () => {
    mocks.native.mockResolvedValueOnce({ latency: 13, addr: ['192.0.2.2'] })
    const wrapper = mountComparison()
    await wrapper.get('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.native).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'dns' }),
      'example.com',
      'A',
      'chosen',
    )
    expect(wrapper.text()).toContain('192.0.2.2 · 13 ms')
    wrapper.unmount()
  })

  it('reports proxy unavailable in direct mode without issuing a second direct probe', async () => {
    mocks.mode = 'direct'
    const wrapper = mountComparison()
    await wrapper.get('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('diagnostics.noProxy')
    wrapper.unmount()
  })
})
