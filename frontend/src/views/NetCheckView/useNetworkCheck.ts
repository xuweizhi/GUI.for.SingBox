import { computed, ref } from 'vue'

import { parseNetworkCheckTarget, type ParsedNetworkCheckTarget } from '@/views/NetCheckView/networkCheckTarget'

type ResultStatus = 'success' | 'failed' | 'skipped' | 'running'
type NetworkRequestOptions = {
  Proxy?: string
  Timeout?: number
}
type NetworkResponse = {
  status: number
}
type DnsQueryAnswer = {
  data: string
}
type DnsQueryResult = {
  server?: string
  status?: number
  answers?: string[]
  Server?: string
  Status?: number
  Answer?: DnsQueryAnswer[]
}
type PrimaryOutboundState = {
  mode?: string
  groupName?: string
  leafName?: string
  chain?: string[]
  delay?: number
}
type RuleMatchState = {
  host?: string
  port?: number | string
  rule?: string
  chains?: string[]
}
type RulesetState = {
  id: string
  title: string
  status: ResultStatus
  summary: string
  detail?: string
}

export type NetworkCheckProxyEndpoint = {
  schema: 'http' | 'socks5'
  host: string
  port: number
  username: string
  password: string
}

export interface NetworkCheckDeps {
  probeApiAvailability: () => Promise<unknown>
  getKernelProxyEndpoint: () => Promise<NetworkCheckProxyEndpoint | undefined>
  httpHead: (
    url: string,
    headers?: Record<string, string>,
    options?: NetworkRequestOptions,
  ) => Promise<NetworkResponse>
  httpGet: (
    url: string,
    headers?: Record<string, string>,
    options?: NetworkRequestOptions,
  ) => Promise<NetworkResponse>
  tcpPing: (address: string, options?: { Timeout?: number }) => Promise<number>
  dnsQuery?: (host: string) => Promise<DnsQueryResult>
  getPrimaryOutboundState?: () => Promise<PrimaryOutboundState | undefined>
  getLatestRuleMatch?: (target: ParsedNetworkCheckTarget) => Promise<RuleMatchState | undefined>
  getRulesetStates?: () => Promise<RulesetState[]>
}

export interface NetworkCheckResultItem {
  id: string
  title: string
  status: ResultStatus
  summary: string
  detail?: string
  durationMs?: number
}

export interface NetworkCheckResultGroup {
  id: 'overview' | 'dns' | 'outbound' | 'rulesets'
  title: string
  status: ResultStatus
  summary: string
  items: NetworkCheckResultItem[]
}

const measure = async <T>(fn: () => Promise<T>) => {
  const startedAt = Date.now()
  const value = await fn()
  return { value, durationMs: Date.now() - startedAt }
}

const normalizeErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

const formatProxyHost = (host: string) => {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

const buildProxyUrl = (endpoint: NetworkCheckProxyEndpoint | undefined) => {
  if (!endpoint) return ''

  const { schema, host, port, username, password } = endpoint
  const auth = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : ''
  return `${schema}://${auth}${formatProxyHost(host)}:${port}`
}

const resolveGroupStatus = (items: NetworkCheckResultItem[]): ResultStatus => {
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'running')) return 'running'
  if (items.some((item) => item.status === 'success')) return 'success'
  return 'skipped'
}

const summarizeGroupStatus = (items: NetworkCheckResultItem[]) => {
  if (items.length === 0) return '0 items'

  const counts = items.reduce<Record<ResultStatus, number>>(
    (acc, item) => {
      acc[item.status] += 1
      return acc
    },
    { success: 0, failed: 0, skipped: 0, running: 0 },
  )

  return [
    counts.success && `${counts.success} success`,
    counts.failed && `${counts.failed} failed`,
    counts.skipped && `${counts.skipped} skipped`,
    counts.running && `${counts.running} running`,
  ]
    .filter(Boolean)
    .join(', ')
}

const buildGroup = (
  id: NetworkCheckResultGroup['id'],
  title: string,
  items: NetworkCheckResultItem[],
): NetworkCheckResultGroup => ({
  id,
  title,
  status: resolveGroupStatus(items),
  summary: summarizeGroupStatus(items),
  items,
})

const createSkippedItem = (
  id: string,
  title: string,
  summary: string,
  detail?: string,
): NetworkCheckResultItem => ({
  id,
  title,
  status: 'skipped',
  summary,
  detail,
})

const normalizeDnsAnswers = (result: DnsQueryResult) => {
  if (Array.isArray(result.answers)) return result.answers
  if (Array.isArray(result.Answer)) return result.Answer.map((answer) => answer.data)
  return []
}

export const useNetworkCheck = (deps: NetworkCheckDeps) => {
  const input = ref('https://www.gstatic.com/generate_204')
  const running = ref(false)
  const groups = ref<NetworkCheckResultGroup[]>([])
  const results = computed(() => groups.value.find((group) => group.id === 'overview')?.items ?? [])

  const clear = () => {
    groups.value = []
  }

  const run = async (raw = input.value) => {
    const target = parseNetworkCheckTarget(raw)
    input.value = raw
    clear()
    running.value = true

    let coreAvailable = false
    const overviewItems: NetworkCheckResultItem[] = []
    const dnsItems: NetworkCheckResultItem[] = []
    const outboundItems: NetworkCheckResultItem[] = []
    const rulesetItems: NetworkCheckResultItem[] = []
    const syncGroups = () => {
      groups.value = [
        buildGroup('overview', 'netCheck.groups.overview', overviewItems),
        buildGroup('dns', 'netCheck.groups.dns', dnsItems),
        buildGroup('outbound', 'netCheck.groups.outbound', outboundItems),
        buildGroup('rulesets', 'netCheck.groups.rulesets', rulesetItems),
      ]
    }

    try {
      const core = await measure(() => deps.probeApiAvailability())
      coreAvailable = true
      overviewItems.push({
        id: 'core',
        title: 'netCheck.results.core',
        status: 'success',
        summary: 'netCheck.summary.coreOk',
        durationMs: core.durationMs,
      })
    } catch (error) {
      overviewItems.push({
        id: 'core',
        title: 'netCheck.results.core',
        status: 'failed',
        summary: 'netCheck.summary.coreFailed',
        detail: normalizeErrorMessage(error),
      })
    }
    syncGroups()

    if (!coreAvailable) {
      overviewItems.push({
        id: 'proxy-http',
        title: 'netCheck.results.proxyHttp',
        status: 'skipped',
        summary: 'netCheck.summary.proxySkipped',
      })
    } else {
      const proxy = buildProxyUrl(await deps.getKernelProxyEndpoint())
      if (!proxy) {
        overviewItems.push({
          id: 'proxy-http',
          title: 'netCheck.results.proxyHttp',
          status: 'failed',
          summary: 'netCheck.summary.proxyMissing',
        })
      } else {
        try {
          const head = await measure(() =>
            deps.httpHead(target.requestUrl, {}, { Proxy: proxy, Timeout: 15 }),
          )
          overviewItems.push({
            id: 'proxy-http',
            title: 'netCheck.results.proxyHttp',
            status: 'success',
            summary: `HEAD ${target.requestUrl} -> ${head.value.status}`,
            durationMs: head.durationMs,
          })
        } catch (error: any) {
          const status = Number(error?.status || 0)
          if (status === 405 || status === 501) {
            const request = await measure(() =>
              deps.httpGet(target.requestUrl, {}, { Proxy: proxy, Timeout: 15 }),
            )
            overviewItems.push({
              id: 'proxy-http',
              title: 'netCheck.results.proxyHttp',
              status: 'success',
              summary: `GET ${target.requestUrl} -> ${request.value.status}`,
              durationMs: request.durationMs,
            })
          } else {
            overviewItems.push({
              id: 'proxy-http',
              title: 'netCheck.results.proxyHttp',
              status: 'failed',
              summary: 'netCheck.summary.proxyFailed',
              detail: normalizeErrorMessage(error),
            })
          }
        }
      }
    }
    syncGroups()

    try {
      const tcp = await measure(() =>
        deps.tcpPing(`${target.tcpHost}:${target.tcpPort}`, { Timeout: 15 }),
      )
      overviewItems.push({
        id: 'tcp',
        title: 'netCheck.results.tcp',
        status: 'success',
        summary: `${target.tcpHost}:${target.tcpPort}, ${tcp.value} ms`,
        durationMs: tcp.durationMs,
      })
    } catch (error) {
      overviewItems.push({
        id: 'tcp',
        title: 'netCheck.results.tcp',
        status: 'failed',
        summary: 'netCheck.summary.tcpFailed',
        detail: normalizeErrorMessage(error),
      })
    }
    syncGroups()

    if (target.targetKind === 'ip') {
      dnsItems.push(
        createSkippedItem('dns-query', 'netCheck.results.dnsQuery', 'netCheck.summary.ipTarget'),
      )
    } else if (!deps.dnsQuery) {
      dnsItems.push(
        createSkippedItem(
          'dns-query',
          'netCheck.results.dnsQuery',
          'netCheck.summary.dnsUnavailable',
        ),
      )
    } else {
      try {
        const dns = await deps.dnsQuery(target.dnsLookupHost)
        const answers = normalizeDnsAnswers(dns)
        const status = dns.status ?? dns.Status ?? 0
        dnsItems.push({
          id: 'dns-query',
          title: 'netCheck.results.dnsQuery',
          status: status === 0 ? 'success' : 'failed',
          summary: answers[0] || `status ${status}`,
          detail:
            answers.length > 1
              ? answers.join(', ')
              : (dns.server ?? dns.Server) || undefined,
        })
      } catch (error) {
        dnsItems.push({
          id: 'dns-query',
          title: 'netCheck.results.dnsQuery',
          status: 'failed',
          summary: 'netCheck.summary.dnsFailed',
          detail: normalizeErrorMessage(error),
        })
      }
    }
    syncGroups()

    if (!deps.getPrimaryOutboundState) {
      outboundItems.push(
        createSkippedItem(
          'primary-outbound',
          'netCheck.results.outboundDelay',
          'netCheck.summary.outboundUnavailable',
        ),
      )
    } else {
      try {
        const outbound = await deps.getPrimaryOutboundState()
        if (!outbound) {
          outboundItems.push(
            createSkippedItem(
              'primary-outbound',
              'netCheck.results.outboundDelay',
              'netCheck.summary.outboundUnavailable',
            ),
          )
        } else {
          const chain = outbound.chain?.filter(Boolean).join(' -> ')
          outboundItems.push({
            id: 'primary-outbound',
            title: 'netCheck.results.outboundDelay',
            status: 'success',
            summary: chain || outbound.leafName || outbound.groupName || 'netCheck.summary.outboundReady',
            detail: typeof outbound.delay === 'number' ? `${outbound.delay} ms` : outbound.mode,
          })
        }
      } catch (error) {
        outboundItems.push({
          id: 'primary-outbound',
          title: 'netCheck.results.outboundDelay',
          status: 'failed',
          summary: 'netCheck.summary.outboundFailed',
          detail: normalizeErrorMessage(error),
        })
      }
    }
    syncGroups()

    if (!deps.getLatestRuleMatch) {
      outboundItems.push(
        createSkippedItem(
          'rule-match',
          'netCheck.results.latestRuleMatch',
          'netCheck.summary.ruleMatchUnavailable',
        ),
      )
    } else {
      try {
        const ruleMatch = await deps.getLatestRuleMatch(target)
        if (!ruleMatch) {
          outboundItems.push(
            createSkippedItem(
              'rule-match',
              'netCheck.results.latestRuleMatch',
              'netCheck.summary.ruleMatchUnavailable',
            ),
          )
        } else {
          const host = ruleMatch.host || target.displayHost
          const port = ruleMatch.port ?? target.tcpPort
          outboundItems.push({
            id: 'rule-match',
            title: 'netCheck.results.latestRuleMatch',
            status: 'success',
            summary: `${host}:${port}`,
            detail: [ruleMatch.rule, ruleMatch.chains?.filter(Boolean).join(' -> ')].filter(Boolean).join(' | '),
          })
        }
      } catch (error) {
        outboundItems.push({
          id: 'rule-match',
          title: 'netCheck.results.latestRuleMatch',
          status: 'failed',
          summary: 'netCheck.summary.ruleMatchFailed',
          detail: normalizeErrorMessage(error),
        })
      }
    }
    syncGroups()

    if (!deps.getRulesetStates) {
      rulesetItems.push(
        createSkippedItem(
          'rulesets',
          'netCheck.results.rulesetItem',
          'netCheck.summary.rulesetsUnavailable',
        ),
      )
    } else {
      try {
        const states = await deps.getRulesetStates()
        if (states.length === 0) {
          rulesetItems.push(
            createSkippedItem('rulesets', 'netCheck.results.rulesetItem', 'netCheck.summary.noRulesets'),
          )
        } else {
          rulesetItems.push(
            ...states.map((item) => ({
              id: item.id,
              title: item.title,
              status: item.status,
              summary: item.summary,
              detail: item.detail,
            })),
          )
        }
      } catch (error) {
        rulesetItems.push({
          id: 'rulesets',
          title: 'netCheck.results.rulesetItem',
          status: 'failed',
          summary: 'netCheck.summary.rulesetsFailed',
          detail: normalizeErrorMessage(error),
        })
      }
    }
    syncGroups()
    running.value = false
  }

  return {
    input,
    running,
    groups,
    results,
    clear,
    run,
  }
}
