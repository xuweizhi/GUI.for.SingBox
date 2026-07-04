import { useKernelApiStore } from '@/stores/kernelApi'
import { isWebui } from '@/utils/env'
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
  const kernelApiStore = useKernelApiStore()

  return useNetworkCheck({
    probeApiAvailability: async () => {
      if (!kernelApiStore.running) throw new Error('netCheck.summary.coreFailed')
      await kernelApiStore.refreshConfig()
    },
    getKernelProxyEndpoint: async () => kernelApiStore.getProxyEndpoint(),
    httpHead,
    httpGet,
    tcpPing,
  })
}
