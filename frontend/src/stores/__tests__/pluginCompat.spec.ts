import { describe, expect, it } from 'vitest'

import { normalizePluginCode } from '@/stores/pluginCompat'

const smartProxySwitcherSnippet = `
export default (Plugin) => {
  const { ref } = Vue

  const kernelApi = Plugins.useKernelApiStore()

  const request = {
    async get(url, params) {
      const { base, bearer } = setupRequestApi()
      const res = await fetch(base + url + '?' + new URLSearchParams(params).toString(), {
        headers: { Authorization: \`Bearer \${bearer}\` }
      })
      const data = await res.json()
      return data
    }
  }

  const start = (config) => {
    config.IncludeGroup.forEach((group) => {
      const proxies = kernelApi.proxies[group].all.map((proxy) => {
        return {
          id: proxy,
          url: \`/proxies/\${encodeURIComponent(proxy)}/delay\`,
          priority: 1, // 节点权重暂未使用，全设置为1
          group
        }
      })
      console.log(proxies)
    })
  }
}
`

describe('normalizePluginCode', () => {
  it('patches smart proxy switcher candidates to skip non-delay-testable entries', () => {
    const normalized = normalizePluginCode(
      { id: 'plugin-smart-proxy-switcher' } as Pick<App.Plugin, 'id'>,
      smartProxySwitcherSnippet,
    )

    expect(normalized).toContain('__GUI_FOR_SINGBOX_DELAY_FILTER_PATCH__')
    expect(normalized).toContain('const candidates = all.filter((proxy) => isDelayTestableProxy(proxy))')
    expect(normalized).toContain('策略组【${group}】已过滤 ${all.length - candidates.length} 个不可测速条目')
    expect(normalized).not.toContain('const proxies = kernelApi.proxies[group].all.map((proxy) => {')
    expect(normalized).toContain('const { body } = await Plugins.Requests({')
    expect(normalized).toContain('autoTransformBody: false')
    expect(normalized).not.toContain('const res = await fetch(base + url')
  })

  it('keeps the patch idempotent', () => {
    const once = normalizePluginCode(
      { id: 'plugin-smart-proxy-switcher' } as Pick<App.Plugin, 'id'>,
      smartProxySwitcherSnippet,
    )
    const twice = normalizePluginCode(
      { id: 'plugin-smart-proxy-switcher' } as Pick<App.Plugin, 'id'>,
      once,
    )

    expect(twice).toBe(once)
  })

  it('does not change other plugins', () => {
    const source = 'export default () => ({})'
    expect(
      normalizePluginCode({ id: 'plugin-other' } as Pick<App.Plugin, 'id'>, source),
    ).toBe(source)
  })
})
