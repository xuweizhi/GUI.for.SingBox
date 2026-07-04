import * as Bridge from '@/bridge/wailsjs/go/bridge/App'
import { useKernelApiStore } from '@/stores/kernelApi'
import { useNetworkCheck } from '@/views/NetCheckView/useNetworkCheck'

type RequestMethod = 'GET' | 'HEAD'
type RequestOptions = {
  Proxy?: string
  Timeout?: number
}

const requestWithoutBody = async (method: RequestMethod, url: string, options: RequestOptions = {}) => {
  const {
    flag,
    status,
    headers,
    body,
  } = await Bridge.Requests(method, url, {}, '', {
    Proxy: options.Proxy || '',
    Insecure: false,
    Redirect: true,
    Timeout: options.Timeout ?? 15,
    CancelId: '',
    FileField: 'file',
    Sha256: '',
    Stream: '',
  })

  if (!flag) throw body

  return {
    status,
    headers: Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, value.length > 1 ? value : value[0]!]),
    ),
    body,
  }
}

const httpHead = (url: string, _headers = {}, options: RequestOptions = {}) => {
  return requestWithoutBody('HEAD', url, options)
}

const httpGet = (url: string, _headers = {}, options: RequestOptions = {}) => {
  return requestWithoutBody('GET', url, options)
}

const tcpPing = async (address: string, options: { Timeout?: number } = {}) => {
  const { flag, data } = await Bridge.TcpPing(address, {
    Mode: 'Text',
    Timeout: options.Timeout ?? 15,
  })

  if (!flag) throw data
  return Number(data)
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
