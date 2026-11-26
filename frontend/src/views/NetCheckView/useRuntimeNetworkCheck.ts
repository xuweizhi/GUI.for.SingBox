import * as Bridge from '@/bridge/browser/go/bridge/App'
import { EventsEmit } from '@/bridge/browser/runtime/runtime'

import {
  dnsQuery,
  getConnections,
  getProxyDelay,
  getRemoteRulesetCounts,
  getRemoteRulesetStates,
  onConnections,
  queryCoreRoute,
} from '@/api/kernel'
import { DefaultTestTimeout, DefaultTestURL } from '@/constant/app'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useKernelApiStore } from '@/stores/kernelApi'
import { useProfilesStore } from '@/stores/profiles'
import { useRulesetsStore } from '@/stores/rulesets'
import { resolvePrimaryNode } from '@/views/HomeView/nodeController'
import {
  buildRulesetCheckItems,
  formatDnsAnswers,
  matchLatestConnection,
} from '@/views/NetCheckView/networkCheckRuntime'
import { useNetworkCheck } from '@/views/NetCheckView/useNetworkCheck'

import type { CoreApiConnectionRecord } from '@/types/kernel'

type RequestMethod = 'GET' | 'HEAD'
type RequestOptions = {
  Proxy?: string
  Timeout?: number
  CancelId?: string
}

type BridgeHttpResult = {
  flag: boolean
  status: number
  headers: Record<string, string[]>
  body: string
}

type BridgeTcpResult = {
  flag: boolean
  data: string
}

type RuntimeBridge = {
  Requests: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string,
    options: Record<string, unknown>,
  ) => Promise<BridgeHttpResult>
  TcpPing: (address: string, options: Record<string, unknown>) => Promise<BridgeTcpResult>
}

const runtimeBridge: RuntimeBridge = {
  Requests: Bridge.Requests as RuntimeBridge['Requests'],
  TcpPing: Bridge.TcpPing as RuntimeBridge['TcpPing'],
}

class RuntimeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RuntimeHttpError'
  }
}

const requestWithoutBody = async (
  method: RequestMethod,
  url: string,
  headers: Record<string, string> = {},
  options: RequestOptions = {},
) => {
  const result = await runtimeBridge.Requests(method, url, headers, '', {
    Proxy: options.Proxy || '',
    Insecure: false,
    Redirect: true,
    FreshConnection: true,
    Timeout: options.Timeout ?? 15,
    CancelId: options.CancelId || '',
    FileField: 'file',
    Sha256: '',
    Stream: '',
  })

  if (!result.flag) {
    throw new RuntimeHttpError(
      result.body || `HTTP request failed with status ${result.status}`,
      result.status,
    )
  }

  return {
    status: result.status,
    headers: Object.fromEntries(
      Object.entries(result.headers).map(([key, value]) => [
        key,
        value.length > 1 ? value : (value[0] ?? ''),
      ]),
    ),
    body: result.body,
  }
}

const httpHead = (url: string, headers = {}, options: RequestOptions = {}) => {
  return requestWithoutBody('HEAD', url, headers, options)
}

const httpGet = (url: string, headers = {}, options: RequestOptions = {}) => {
  return requestWithoutBody('GET', url, headers, options)
}

const tcpPing = async (address: string, options: { Timeout?: number } = {}) => {
  const result = await runtimeBridge.TcpPing(address, {
    Mode: 'Text',
    Timeout: options.Timeout ?? 15,
  })

  if (!result.flag) throw result.data
  return Number(result.data)
}

export const useRuntimeNetworkCheck = () => {
  const appSettingsStore = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()
  const profilesStore = useProfilesStore()
  const rulesetsStore = useRulesetsStore()
  let activeCancelId = ''

  const withCancel = async <T>(fn: (cancelId: string) => Promise<T>) => {
    const cancelId = `netcheck-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeCancelId = cancelId
    try {
      return await fn(cancelId)
    } finally {
      if (activeCancelId === cancelId) activeCancelId = ''
    }
  }

  return useNetworkCheck({
    probeApiAvailability: async () => {
      if (!kernelApiStore.running) throw new Error('netCheck.summary.coreFailed')
      await kernelApiStore.refreshConfig()
    },
    getKernelProxyEndpoint: async () => kernelApiStore.getProxyEndpoint(),
    httpHead: (url, headers = {}, options = {}) =>
      withCancel((cancelId) => httpHead(url, headers, { ...options, CancelId: cancelId })),
    httpGet: (url, headers = {}, options = {}) =>
      withCancel((cancelId) => httpGet(url, headers, { ...options, CancelId: cancelId })),
    onCancel: () => {
      if (activeCancelId) {
        EventsEmit(activeCancelId)
        activeCancelId = ''
      }
    },
    tcpPing,
    dnsQuery: async (host: string) => {
      const response = await dnsQuery(host)
      return {
        server: response.Server,
        status: response.Status,
        answers: formatDnsAnswers(response.Answer),
      }
    },
    getPrimaryOutboundState: async () => {
      await kernelApiStore.refreshProviderProxies()

      const primary = resolvePrimaryNode(
        kernelApiStore.config.mode as 'rule' | 'global' | 'direct',
        profilesStore.currentProfile,
        kernelApiStore.proxies,
      )

      let delay = primary.delay ?? undefined
      if (primary.kind === 'group' && primary.leafName && delay == null) {
        const testUrl = appSettingsStore.app.kernel.testUrl || DefaultTestURL
        const testTimeout = appSettingsStore.app.kernel.testTimeout || DefaultTestTimeout
        const result = await getProxyDelay(
          encodeURIComponent(primary.leafName),
          testUrl,
          testTimeout,
        )
        delay = result.delay ?? undefined
      }

      return {
        mode: primary.error ? 'unavailable' : primary.kind,
        groupName: primary.groupName,
        leafName: primary.leafName,
        chain: primary.chain,
        delay,
      }
    },
    observeRuleMatch: async (target) => {
      const baseline = new Set(((await getConnections()).connections || []).map((item) => item.id))
      let latest: CoreApiConnectionRecord | undefined
      const capture = (rows: CoreApiConnectionRecord[]) => {
        const match = matchLatestConnection(
          rows.filter(
            (row) => !baseline.has(row.id) && row.metadata.network?.toLowerCase() !== 'udp',
          ),
          {
            targetHost: target.requestHost,
            targetPort: target.tcpPort,
          },
        )
        if (match && (!latest || Date.parse(match.start) >= Date.parse(latest.start)))
          latest = match
      }
      const unsubscribe = onConnections((event) => capture(event.connections || []))
      let pending: Promise<void> | undefined
      const sample = () => {
        pending ??= getConnections()
          .then((data) => capture(data.connections || []))
          .finally(() => {
            pending = undefined
          })
        return pending
      }
      const timer = window.setInterval(() => {
        void sample().catch(() => undefined)
      }, 150)
      return async () => {
        clearInterval(timer)
        unsubscribe()
        try {
          await sample()
        } catch (error) {
          if (!latest) throw error
        }
        if (!latest) return
        const parsedPort = latest.metadata.destinationPort
          ? Number(latest.metadata.destinationPort)
          : undefined
        return {
          host: latest.metadata.host || latest.metadata.destinationIP,
          port: parsedPort && Number.isFinite(parsedPort) ? parsedPort : undefined,
          rule: [latest.rule, latest.rulePayload].filter(Boolean).join(' · '),
          chains: latest.chains?.slice().reverse(),
        }
      }
    },
    queryRoute: async (target, resolvedIP) => {
      const route = await queryCoreRoute(
        target.targetKind === 'ip' ? '' : target.requestHost,
        target.targetKind === 'ip' ? target.requestHost : resolvedIP || '',
      )
      if (!route) return
      if (route.err) throw new Error(route.err)
      if (typeof route.rule !== 'string') throw new Error('diagnostics.invalidEvidence')
      return [route.rule, (route.chain || []).join(' → ') || route.outbound]
        .filter(Boolean)
        .join(' | ')
    },
    getRulesetStates: async (running) => {
      const profileRulesets = profilesStore.currentProfile?.route.rule_set ?? []
      if (!running || !profileRulesets.some((item) => item.type === 'remote'))
        return buildRulesetCheckItems(profileRulesets, rulesetsStore.rulesets)
      const [counts, states] = await Promise.allSettled([
        getRemoteRulesetCounts(),
        getRemoteRulesetStates(),
      ])
      const items = buildRulesetCheckItems(profileRulesets, rulesetsStore.rulesets, {
        counts: counts.status === 'fulfilled' ? counts.value?.result : undefined,
        ...(states.status === 'fulfilled' ? states.value : {}),
      })
      return [
        ...items,
        ...[counts, states].flatMap((result, index) =>
          result.status === 'rejected'
            ? [
                {
                  id: `ruleset-api-${index}`,
                  title: 'diagnostics.coreEvidence',
                  status: 'failed' as const,
                  summary: 'netCheck.summary.rulesetsFailed',
                  detail: String(result.reason),
                },
              ]
            : [],
        ),
      ]
    },
  })
}
