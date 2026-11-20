import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

import BackupSettings from '../BackupSettings.vue'

const errors = vi.hoisted(() => vi.fn())
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/utils', () => ({ formatBytes: String, message: { error: errors, success: vi.fn() } }))
vi.mock('@/stores', () => ({ useWebuiAuthStore: () => ({ handleUnauthorized: vi.fn() }) }))
vi.mock('@/utils/configPersistence', () => ({
  withConfigMutation: (operation: () => Promise<unknown>) => operation(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('previews the chosen archive and resubmits the same bytes only after confirmation', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        created: '2026-01-01T00:00:00Z',
        files: 2,
        bytes: 120,
        counts: { profiles: 1 },
        external: ['/srv/local.srs'],
      }),
    )
    .mockResolvedValueOnce(new Response('restore unavailable', { status: 400 }))
  vi.stubGlobal('fetch', fetch)
  const wrapper = mount(BackupSettings, {
    global: {
      stubs: {
        Card: { template: '<section><slot/></section>' },
        Input: true,
        Button: true,
        Switch: true,
        Modal: {
          props: ['open', 'onOk'],
          template:
            '<section v-if="open" data-preview><slot/><button @click="onOk">restore</button></section>',
        },
      },
    },
  })
  try {
    const zip = new File(['fixture'], 'source.zip', { type: 'application/zip' })
    const input = wrapper.get<HTMLInputElement>('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [zip] })
    await input.trigger('change')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/__webui/api/backup/preview', { method: 'POST', body: zip })
    expect(wrapper.get('[data-preview]').text()).toContain('/srv/local.srs')
    await wrapper.get('[data-preview] button').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith('/__webui/api/backup/restore', {
      method: 'POST',
      body: zip,
    })
    expect(errors).toHaveBeenCalledWith(new Error('restore unavailable'))
    expect(wrapper.find('[data-preview]').exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
})
