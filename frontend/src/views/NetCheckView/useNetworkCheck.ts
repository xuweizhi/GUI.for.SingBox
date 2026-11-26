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
  observeRuleMatch?: (target: ParsedNetworkCheckTarget) => Promise<() => Promise<RuleMatchState | undefined>>
  queryRoute?: (target: ParsedNetworkCheckTarget, resolvedIP?: string) => Promise<string | undefined>
  getRulesetStates?: (running: boolean) => Promise<RulesetState[]>
  onCancel?: () => void
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
  let localHost = host
  if (!host || host === '0.0.0.0') localHost = '127.0.0.1'
  if (host === '::' || host === '[::]') localHost = '::1'
  const auth = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : ''
  return `${schema}://${auth}${formatProxyHost(localHost)}:${port}`
}

const resolveGroupStatus = (
  items: NetworkCheckResultItem[],
  pending = false,
): ResultStatus => {
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'running')) return 'running'
  if (pending && items.length === 0) return 'running'
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
  pending = false,
): NetworkCheckResultGroup => ({
  id,
  title,
  status: resolveGroupStatus(items, pending),
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
  let runToken = 0

  const cancel = () => {
    if (!running.value) return
    runToken += 1
    running.value = false
    deps.onCancel?.()
  }

  const clear = () => {
    cancel()
    groups.value = []
  }

  const run = async (raw = input.value) => {
    if (running.value) return
    const target = parseNetworkCheckTarget(raw)
    input.value = raw
    groups.value = []
    running.value = true
    const myToken = ++runToken
    const isCancelled = () => myToken !== runToken

    let coreAvailable = false
    let testedLeaf: string | undefined
    const overviewItems: NetworkCheckResultItem[] = []
    const dnsItems: NetworkCheckResultItem[] = []
    const outboundItems: NetworkCheckResultItem[] = []
    const rulesetItems: NetworkCheckResultItem[] = []
    const syncGroups = (completedStages = 0) => {
      if (isCancelled()) return
      groups.value = [
        buildGroup('overview', 'netCheck.groups.overview', overviewItems, completedStages < 1),
        buildGroup('dns', 'netCheck.groups.dns', dnsItems, completedStages < 2),
        buildGroup('outbound', 'netCheck.groups.outbound', outboundItems, completedStages < 3),
        buildGroup('rulesets', 'netCheck.groups.rulesets', rulesetItems, completedStages < 4),
      ]
    }
    syncGroups(0)

    try {
      try {
        const core = await measure(() => deps.probeApiAvailability())
        if (isCancelled()) return
        coreAvailable = true
        overviewItems.push({
          id: 'core',
          title: 'netCheck.results.core',
          status: 'success',
          summary: 'netCheck.summary.coreOk',
          durationMs: core.durationMs,
        })
      } catch (error) {
        if (isCancelled()) return
        overviewItems.push({
          id: 'core',
          title: 'netCheck.results.core',
          status: 'failed',
          summary: 'netCheck.summary.coreFailed',
          detail: normalizeErrorMessage(error),
        })
      }
      syncGroups(0)

      let match: RuleMatchState | undefined
      let observationError: unknown
      let resolvedIP: string | undefined
      if (!coreAvailable) {
        overviewItems.push({
          id: 'proxy-http',
          title: 'netCheck.results.proxyHttp',
          status: 'skipped',
          summary: 'netCheck.summary.proxySkipped',
        })
      } else {
        let finishObservation: (() => Promise<RuleMatchState | undefined>) | undefined
        try {
          const proxy = buildProxyUrl(await deps.getKernelProxyEndpoint())
          if (isCancelled()) return
          if (!proxy) {
            overviewItems.push({
              id: 'proxy-http',
              title: 'netCheck.results.proxyHttp',
              status: 'failed',
              summary: 'netCheck.summary.proxyMissing',
            })
          } else {
            try {
              finishObservation = await deps.observeRuleMatch?.(target)
            } catch (error) {
              observationError = error
            }
            if (isCancelled()) return
            let method: 'HEAD' | 'GET' = 'HEAD'
            let request
            try {
              request = await measure(() =>
                deps.httpHead(target.requestUrl, {}, { Proxy: proxy, Timeout: 15 }),
              )
            } catch (error: any) {
              if (isCancelled()) return
              const status = Number(error?.status || 0)
              if (status !== 405 && status !== 501) throw error

              method = 'GET'
              request = await measure(() =>
                deps.httpGet(target.requestUrl, {}, { Proxy: proxy, Timeout: 15 }),
              )
            }
            if (isCancelled()) return

            overviewItems.push({
              id: 'proxy-http',
              title: 'netCheck.results.proxyHttp',
              status: 'success',
              summary: `${method} ${target.requestUrl} -> ${request.value.status}`,
              durationMs: request.durationMs,
            })
          }
        } catch (error) {
          if (isCancelled()) return
          overviewItems.push({
            id: 'proxy-http',
            title: 'netCheck.results.proxyHttp',
            status: 'failed',
            summary: 'netCheck.summary.proxyFailed',
            detail: normalizeErrorMessage(error),
          })
        } finally {
          try {
            match = await finishObservation?.()
          } catch (error) {
            observationError = error
          }
        }
      }
      if (isCancelled()) return
      syncGroups(0)

      try {
        const tcp = await measure(() =>
          deps.tcpPing(`${formatProxyHost(target.tcpHost)}:${target.tcpPort}`, { Timeout: 15 }),
        )
        if (isCancelled()) return
        overviewItems.push({
          id: 'tcp',
          title: 'netCheck.results.tcp',
          status: 'success',
          summary: `${target.tcpHost}:${target.tcpPort}, ${tcp.value} ms`,
          durationMs: tcp.durationMs,
        })
      } catch (error) {
        if (isCancelled()) return
        overviewItems.push({
          id: 'tcp',
          title: 'netCheck.results.tcp',
          status: 'failed',
          summary: 'netCheck.summary.tcpFailed',
          detail: normalizeErrorMessage(error),
        })
      }
      syncGroups(1)

      if (target.targetKind === 'ip') {
        dnsItems.push(
          createSkippedItem('dns-query', 'netCheck.results.dnsQuery', 'netCheck.summary.ipTarget'),
        )
      } else if (!coreAvailable || !deps.dnsQuery) {
        dnsItems.push(
          createSkippedItem(
            'dns-query',
            'netCheck.results.dnsQuery',
            'netCheck.summary.dnsUnavailable',
          ),
        )
      } else {
        try {
          const dnsMeasured = await measure(() => deps.dnsQuery!(target.dnsLookupHost))
          if (isCancelled()) return
          const dns = dnsMeasured.value
          const answers = normalizeDnsAnswers(dns)
          resolvedIP = answers.find(
            (answer) =>
              /^(?:\d{1,3}\.){3}\d{1,3}$/.test(answer) || /^[0-9a-f:]*:[0-9a-f:]+$/i.test(answer),
          )
          const status = dns.status ?? dns.Status ?? 0
          const server = dns.server ?? dns.Server
          const detailParts = [
            server || undefined,
            answers.length > 1 ? answers.join(', ') : undefined,
          ].filter(Boolean)
          dnsItems.push({
            id: 'dns-query',
            title: 'netCheck.results.dnsQuery',
            status: status === 0 ? 'success' : 'failed',
            summary:
              answers[0] || (status === 0 ? 'diagnostics.noAnswer' : `status ${status}`),
            detail: detailParts.length ? detailParts.join(' · ') : undefined,
            durationMs: dnsMeasured.durationMs,
          })
        } catch (error) {
          if (isCancelled()) return
          dnsItems.push({
            id: 'dns-query',
            title: 'netCheck.results.dnsQuery',
            status: 'failed',
            summary: 'netCheck.summary.dnsFailed',
            detail: normalizeErrorMessage(error),
          })
        }
      }
      syncGroups(2)

      if (!coreAvailable || !deps.getPrimaryOutboundState) {
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
          if (isCancelled()) return
          testedLeaf = outbound?.leafName
          if (!outbound) {
            outboundItems.push(
              createSkippedItem(
                'primary-outbound',
                'netCheck.results.outboundDelay',
                'netCheck.summary.outboundUnavailable',
              ),
            )
          } else if (outbound.mode === 'unavailable') {
            outboundItems.push({
              id: 'primary-outbound',
              title: 'netCheck.results.outboundDelay',
              status: 'failed',
              summary: 'netCheck.summary.outboundUnavailable',
            })
          } else {
            const chain = outbound.chain?.filter(Boolean).join(' -> ')
            outboundItems.push({
              id: 'primary-outbound',
              title: 'netCheck.results.outboundDelay',
              status: 'success',
              summary:
                chain || outbound.leafName || outbound.groupName || 'netCheck.summary.outboundReady',
              detail: typeof outbound.delay === 'number' ? `${outbound.delay} ms` : outbound.mode,
            })
          }
        } catch (error) {
          if (isCancelled()) return
          outboundItems.push({
            id: 'primary-outbound',
            title: 'netCheck.results.outboundDelay',
            status: 'failed',
            summary: 'netCheck.summary.outboundFailed',
            detail: normalizeErrorMessage(error),
          })
        }
      }
      syncGroups(2)

      outboundItems.push({
        id: 'rule-match',
        title: 'diagnostics.observedConnection',
        status: observationError ? 'failed' : match ? 'success' : 'skipped',
        summary: observationError
          ? 'netCheck.summary.ruleMatchFailed'
          : match
            ? `${match.host || target.displayHost}:${match.port ?? target.tcpPort}`
            : 'diagnostics.noConnection',
        detail: observationError
          ? normalizeErrorMessage(observationError)
          : [match?.rule, match?.chains?.join(' → ')].filter(Boolean).join(' | '),
      })
      if (coreAvailable && deps.queryRoute) {
        try {
          const route = await deps.queryRoute(target, resolvedIP)
          if (isCancelled()) return
          outboundItems.push({
            id: 'route-query',
            title: 'diagnostics.routeQuery',
            status: route ? 'success' : 'skipped',
            summary: route || 'diagnostics.queryUnsupported',
            detail: route ? 'diagnostics.routeInputs' : undefined,
          })
        } catch (error) {
          if (isCancelled()) return
          outboundItems.push({
            id: 'route-query',
            title: 'diagnostics.routeQuery',
            status: 'failed',
            summary: 'netCheck.summary.ruleMatchFailed',
            detail: normalizeErrorMessage(error),
          })
        }
      }
      syncGroups(3)

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
          const states = await deps.getRulesetStates(coreAvailable)
          if (isCancelled()) return
          if (states.length === 0) {
            rulesetItems.push(
              createSkippedItem(
                'rulesets',
                'netCheck.results.rulesetItem',
                'netCheck.summary.noRulesets',
              ),
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
          if (isCancelled()) return
          rulesetItems.push({
            id: 'rulesets',
            title: 'netCheck.results.rulesetItem',
            status: 'failed',
            summary: 'netCheck.summary.rulesetsFailed',
            detail: normalizeErrorMessage(error),
          })
        }
      }
      syncGroups(4)
      return testedLeaf
    } finally {
      if (myToken === runToken) {
        running.value = false
      }
    }
  }

  return {
    input,
    running,
    groups,
    results,
    clear,
    cancel,
    run,
  }
}
