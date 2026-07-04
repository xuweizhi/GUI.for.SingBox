import { ref } from 'vue'

import { parseNetworkCheckTarget } from '@/views/NetCheckView/networkCheckTarget'

type ResultStatus = 'success' | 'failed' | 'skipped' | 'running'
type NetworkRequestOptions = {
  Proxy?: string
  Timeout?: number
}
type NetworkResponse = {
  status: number
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
}

export interface NetworkCheckResultItem {
  id: 'core' | 'proxy-http' | 'tcp'
  title: string
  status: ResultStatus
  summary: string
  detail?: string
  durationMs?: number
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

export const useNetworkCheck = (deps: NetworkCheckDeps) => {
  const input = ref('https://www.gstatic.com/generate_204')
  const running = ref(false)
  const results = ref<NetworkCheckResultItem[]>([])

  const clear = () => {
    results.value = []
  }

  const run = async (raw = input.value) => {
    const target = parseNetworkCheckTarget(raw)
    input.value = raw
    clear()
    running.value = true

    let coreAvailable = false

    try {
      const core = await measure(() => deps.probeApiAvailability())
      coreAvailable = true
      results.value.push({
        id: 'core',
        title: 'netCheck.results.core',
        status: 'success',
        summary: 'netCheck.summary.coreOk',
        durationMs: core.durationMs,
      })
    } catch (error) {
      results.value.push({
        id: 'core',
        title: 'netCheck.results.core',
        status: 'failed',
        summary: 'netCheck.summary.coreFailed',
        detail: normalizeErrorMessage(error),
      })
    }

    if (!coreAvailable) {
      results.value.push({
        id: 'proxy-http',
        title: 'netCheck.results.proxyHttp',
        status: 'skipped',
        summary: 'netCheck.summary.proxySkipped',
      })
    } else {
      const proxy = buildProxyUrl(await deps.getKernelProxyEndpoint())
      if (!proxy) {
        results.value.push({
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
          results.value.push({
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
            results.value.push({
              id: 'proxy-http',
              title: 'netCheck.results.proxyHttp',
              status: 'success',
              summary: `GET ${target.requestUrl} -> ${request.value.status}`,
              durationMs: request.durationMs,
            })
          } else {
            results.value.push({
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

    try {
      const tcp = await measure(() =>
        deps.tcpPing(`${target.tcpHost}:${target.tcpPort}`, { Timeout: 15 }),
      )
      results.value.push({
        id: 'tcp',
        title: 'netCheck.results.tcp',
        status: 'success',
        summary: `${target.tcpHost}:${target.tcpPort}, ${tcp.value} ms`,
        durationMs: tcp.durationMs,
      })
    } catch (error) {
      results.value.push({
        id: 'tcp',
        title: 'netCheck.results.tcp',
        status: 'failed',
        summary: 'netCheck.summary.tcpFailed',
        detail: normalizeErrorMessage(error),
      })
    } finally {
      running.value = false
    }
  }

  return {
    input,
    running,
    results,
    clear,
    run,
  }
}
