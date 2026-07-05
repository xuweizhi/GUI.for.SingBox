const smartProxySwitcherPluginId = 'plugin-smart-proxy-switcher'
const smartProxySwitcherPatchMarker = '__GUI_FOR_SINGBOX_DELAY_FILTER_PATCH__'

const smartProxySwitcherKernelApiSnippet = `  const kernelApi = Plugins.useKernelApiStore()
`

const smartProxySwitcherCandidatesSnippet = `      const proxies = kernelApi.proxies[group].all.map((proxy) => {
        return {
          id: proxy,
          url: \`/proxies/\${encodeURIComponent(proxy)}/delay\`,
          priority: 1, // 节点权重暂未使用，全设置为1
          group
        }
      })
`

const smartProxySwitcherRequestSnippet = `  const request = {
    async get(url, params) {
      const { base, bearer } = setupRequestApi()
      const res = await fetch(base + url + '?' + new URLSearchParams(params).toString(), {
        headers: { Authorization: \`Bearer \${bearer}\` }
      })
      const data = await res.json()
      return data
    }
  }
`

const smartProxySwitcherHelperSnippet = `  const ${smartProxySwitcherPatchMarker} = true
  const nonDelayTestableNamePatterns = [
    /剩余流量/i,
    /下次重置|重置剩余/i,
    /套餐到期|套餐过期时间/i,
    /线路持续更新/i,
    /企业套餐/i
  ]
  const isDelayTestableProxy = (name) => {
    return !nonDelayTestableNamePatterns.some((pattern) => pattern.test(name))
  }
`

const smartProxySwitcherCandidatesReplacement = `      const all = kernelApi.proxies[group].all || []
      const candidates = all.filter((proxy) => isDelayTestableProxy(proxy))
      if (!candidates.length) {
        console.log(\`[\${Plugin.name}]\`, \`策略组【\${group}】无可测速节点，跳过监测\`)
        return
      }
      if (candidates.length !== all.length) {
        console.log(
          \`[\${Plugin.name}]\`,
          \`策略组【\${group}】已过滤 \${all.length - candidates.length} 个不可测速条目\`
        )
      }
      const proxies = candidates.map((proxy) => {
        return {
          id: proxy,
          url: \`/proxies/\${encodeURIComponent(proxy)}/delay\`,
          priority: 1, // 节点权重暂未使用，全设置为1
          group
        }
      })
`

const smartProxySwitcherRequestReplacement = `  const request = {
    async get(url, params) {
      const { base, bearer } = setupRequestApi()
      const { body } = await Plugins.Requests({
        method: 'GET',
        url: base + url + '?' + new URLSearchParams(params).toString(),
        headers: { Authorization: \`Bearer \${bearer}\` },
        autoTransformBody: false
      })
      return JSON.parse(body)
    }
  }
`

const applySmartProxySwitcherCompat = (code: string) => {
  if (!code) return code
  if (code.includes(smartProxySwitcherPatchMarker)) return code
  if (
    !code.includes(smartProxySwitcherKernelApiSnippet) ||
    !code.includes(smartProxySwitcherCandidatesSnippet) ||
    !code.includes(smartProxySwitcherRequestSnippet)
  ) {
    return code
  }

  return code
    .replace(
      smartProxySwitcherKernelApiSnippet,
      `${smartProxySwitcherKernelApiSnippet}${smartProxySwitcherHelperSnippet}`,
    )
    .replace(smartProxySwitcherRequestSnippet, smartProxySwitcherRequestReplacement)
    .replace(smartProxySwitcherCandidatesSnippet, smartProxySwitcherCandidatesReplacement)
}

export const normalizePluginCode = (plugin: Pick<App.Plugin, 'id'>, code: string) => {
  if (plugin.id !== smartProxySwitcherPluginId) return code
  return applySmartProxySwitcherCompat(code)
}
