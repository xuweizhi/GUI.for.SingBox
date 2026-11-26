import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/lang', () => ({
  default: {
    global: {
      t: (key: string) => key,
      te: () => false,
      locale: { value: 'en' },
      availableLocales: ['en', 'zh'],
    },
  },
  loadLocale: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({
    t: (key: string) => key,
    te: () => false,
  }),
}))

import Dropdown from '@/components/Dropdown/index.vue'
import TrafficChart from '@/components/TrafficChart/index.vue'
import { useAppSettingsStore } from '@/stores/appSettings'
import NetCheckGroupCard from '@/views/NetCheckView/components/NetCheckGroupCard.vue'
import { resolveRuntimeNodeDetails } from '@/views/NetCheckView/runtimeNodeDetails'
import { useNetworkCheck } from '@/views/NetCheckView/useNetworkCheck'
import AdvancedSettings from '@/views/SettingsView/components/components/AdvancedSettings.vue'

describe('UI/UX refactor regression suite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('attaches click-outside and Escape handling when Dropdown transitions from disabled trigger to click trigger', async () => {
    const wrapper = mount(Dropdown, {
      attachTo: document.body,
      props: {
        trigger: [],
      },
      slots: {
        default: '<button type="button" class="trigger-btn">Open</button>',
        overlay: '<div class="menu-body">Menu Content</div>',
      },
    })

    // Initially no trigger (matches disabled Select): clicking trigger does not mount overlay
    await wrapper.get('.trigger-btn').trigger('click')
    expect(document.body.querySelector('.menu-body')).toBeNull()

    // Enable click trigger dynamically: clicking opens overlay, outside click closes it
    await wrapper.setProps({ trigger: ['click'] })
    await wrapper.get('.trigger-btn').trigger('click')
    await nextTick()
    expect(document.body.querySelector('.menu-body')).not.toBeNull()

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('.menu-body')).toBeNull()

    // Re-open and close with Escape restores focus to trigger
    const triggerBtn = wrapper.get('.trigger-btn').element as HTMLButtonElement
    await wrapper.get('.trigger-btn').trigger('click')
    await nextTick()
    expect(document.body.querySelector('.menu-body')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('.menu-body')).toBeNull()
    expect(document.activeElement).toBe(triggerBtn)

    wrapper.unmount()
  })

  it('measures SVG width rather than padded container width in TrafficChart', async () => {
    const wrapper = mount(TrafficChart, {
      props: {
        series: [
          [100, 300, 500],
          [200, 400, 600],
        ],
        height: 120,
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    })

    const svgEl = wrapper.get('svg').element as SVGSVGElement
    Object.defineProperty(svgEl, 'clientWidth', { value: 240, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    const polyline = wrapper.get('polyline')
    const points = polyline.attributes('points') || ''
    const xs = points
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[0]))
    expect(xs.length).toBeGreaterThan(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(240)
    expect(wrapper.find('polygon').exists()).toBe(true)

    wrapper.unmount()
  })

  it('formats runtime DNS resolver address without a stray space before server_port', () => {
    const details = resolveRuntimeNodeDetails(
      {
        outbounds: [{ tag: 'HK', type: 'socks', domain_resolver: 'cf' }],
        dns: {
          servers: [{ tag: 'cf', type: 'udp', server: '1.1.1.1', server_port: 53 }],
        },
      },
      'HK',
    )
    expect(details?.resolverAddress).toBe('udp 1.1.1.1:53')
  })

  it('cancels an in-flight network check cleanly and reports noAnswer + durationMs for empty DNS success', async () => {
    const onCancel = vi.fn()
    let resolveProbe!: (v: unknown) => void
    const check = useNetworkCheck({
      probeApiAvailability: () =>
        new Promise((resolve) => {
          resolveProbe = resolve
        }),
      getKernelProxyEndpoint: vi.fn(),
      httpHead: vi.fn(),
      httpGet: vi.fn(),
      tcpPing: vi.fn(),
      onCancel,
    })

    const pending = check.run('example.com')
    expect(check.running.value).toBe(true)
    check.cancel()
    expect(check.running.value).toBe(false)
    expect(onCancel).toHaveBeenCalledOnce()
    resolveProbe({ ok: true })
    await pending
    expect(check.running.value).toBe(false)

    const dnsCheck = useNetworkCheck({
      probeApiAvailability: vi.fn().mockResolvedValue({ ok: true }),
      getKernelProxyEndpoint: vi.fn().mockResolvedValue({
        schema: 'http',
        host: '127.0.0.1',
        port: 7890,
        username: '',
        password: '',
      }),
      httpHead: vi.fn().mockResolvedValue({ status: 204 }),
      httpGet: vi.fn(),
      tcpPing: vi.fn().mockResolvedValue(20),
      dnsQuery: vi.fn().mockResolvedValue({ server: '1.1.1.1', status: 0, answers: [] }),
    })

    await dnsCheck.run('example.com')
    const dnsItem = dnsCheck.groups.value.find((g) => g.id === 'dns')?.items[0]
    expect(dnsItem?.status).toBe('success')
    expect(dnsItem?.summary).toBe('diagnostics.noAnswer')
    expect(typeof dnsItem?.durationMs).toBe('number')
  })

  it('avoids nested interactive buttons in collapsible NetCheckGroupCard and shows running status when pending', () => {
    const wrapper = mount(NetCheckGroupCard, {
      props: {
        running: false,
        group: {
          id: 'rulesets',
          title: 'netCheck.groups.rulesets',
          status: 'failed',
          summary: '1 failed',
          items: [
            { id: 'rs-1', title: 'GeoSite', status: 'failed', summary: 'download failed' },
          ],
        },
      },
      global: {
        stubs: {
          Icon: true,
          Button: { template: '<button type="button" v-bind="$attrs"><slot /></button>' },
        },
      },
    })

    // Ensure no <button> is nested inside another <button>
    expect(wrapper.findAll('button button')).toHaveLength(0)
    expect(wrapper.findAll('button').length).toBeGreaterThanOrEqual(2)

    const pendingWrapper = mount(NetCheckGroupCard, {
      props: {
        running: true,
        group: {
          id: 'dns',
          title: 'netCheck.groups.dns',
          status: 'skipped',
          summary: '0 items',
          items: [],
        },
      },
      global: {
        stubs: {
          Icon: true,
          Button: true,
        },
      },
    })
    expect(pendingWrapper.find('.status-badge--running').exists()).toBe(true)

    wrapper.unmount()
    pendingWrapper.unmount()
  })

  it('clamps log retentionDays to integer bounds in AdvancedSettings', async () => {
    const appSettings = useAppSettingsStore()
    const wrapper = mount(AdvancedSettings, {
      global: {
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          Card: { template: '<div><slot /></div>' },
          Input: {
            props: ['modelValue'],
            emits: ['update:modelValue', 'submit'],
            template:
              '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })

    const input = wrapper.get('input')
    await input.setValue('14.7')
    await flushPromises()
    expect(appSettings.app.log.retentionDays).toBe(14)

    await input.setValue('-5')
    await flushPromises()
    expect(appSettings.app.log.retentionDays).toBe(1)

    await input.setValue('99999')
    await flushPromises()
    expect(appSettings.app.log.retentionDays).toBe(3650)

    wrapper.unmount()
  })
})
