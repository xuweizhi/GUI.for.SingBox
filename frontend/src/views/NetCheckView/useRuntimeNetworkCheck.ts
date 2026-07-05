import { DefaultTestTimeout, DefaultTestURL } from '@/constant/app'
import { useAppSettingsStore } from '@/stores/appSettings'
import { getConnections, dnsQuery, getProxyDelay } from '@/api/kernel'
import { useKernelApiStore } from '@/stores/kernelApi'
import { useProfilesStore } from '@/stores/profiles'
import { useRulesetsStore } from '@/stores/rulesets'
import { isWebui } from '@/utils/env'
import { resolvePrimaryNode } from '@/views/HomeView/nodeController'
import {
  buildRulesetCheckItems,
  formatDnsAnswers,
  matchLatestConnection,
} from '@/views/NetCheckView/networkCheckRuntime'
import { useNetworkCheck } from '@/views/NetCheckView/useNetworkCheck'

type RequestMethod = 'GET' | 'HEAD'
type RequestOptions = {
  Proxy?: string
  Timeout?: number
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

let bridgePromise: Promise<RuntimeBridge> | undefined

const loadBridge = (): Promise<RuntimeBridge> => {
  bridgePromise ||= (
    isWebui
      ? import('@/bridge/browser/go/bridge/App')
      : import('@/bridge/wailsjs/go/bridge/App')
  ).then((module) => ({
    Requests: module.Requests as RuntimeBridge['Requests'],
    TcpPing: module.TcpPing as RuntimeBridge['TcpPing'],
  }))
  return bridgePromise
}

const requestWithoutBody = async (method: RequestMethod, url: string, options: RequestOptions = {}) => {
  const bridge = await loadBridge()
  const result = await bridge.Requests(method, url, {}, '', {
    Proxy: options.Proxy || '',
    Insecure: false,
    Redirect: true,
    Timeout: options.Timeout ?? 15,
    CancelId: '',
    FileField: 'file',
    Sha256: '',
    Stream: '',
  })

  if (!result.flag) throw result.body

  return {
    status: result.status,
    headers: Object.fromEntries(
      Object.entries(result.headers).map(([key, value]) => [key, value.length > 1 ? value : (value[0] ?? '')]),
    ),
    body: result.body,
  }
}

const httpHead = (url: string, _headers = {}, options: RequestOptions = {}) => {
  return requestWithoutBody('HEAD', url, options)
}

const httpGet = (url: string, _headers = {}, options: RequestOptions = {}) => {
  return requestWithoutBody('GET', url, options)
}

const tcpPing = async (address: string, options: { Timeout?: number } = {}) => {
  const bridge = await loadBridge()
  const result = await bridge.TcpPing(address, {
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

  return useNetworkCheck({
    probeApiAvailability: async () => {
      if (!kernelApiStore.running) throw new Error('netCheck.summary.coreFailed')
      await kernelApiStore.refreshConfig()
    },
    getKernelProxyEndpoint: async () => kernelApiStore.getProxyEndpoint(),
    httpHead,
    httpGet,
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
        mode: primary.kind,
        groupName: primary.groupName,
        leafName: primary.leafName,
        chain: primary.chain,
        delay,
      }
    },
    getLatestRuleMatch: async (target) => {
      const { connections } = await getConnections()
      const match = matchLatestConnection(connections, {
        targetHost: target.requestHost,
        targetPort: target.tcpPort,
      })

      if (!match) return

      return {
        host: match.metadata.host || match.metadata.destinationIP,
        port: Number(match.metadata.destinationPort || 0),
        rule: match.rule,
        chains: match.chains,
      }
    },
    getRulesetStates: async () => {
      const profileRulesets = profilesStore.currentProfile?.route.rule_set ?? []
      return buildRulesetCheckItems(profileRulesets, rulesetsStore.rulesets)
    },
  })
}
