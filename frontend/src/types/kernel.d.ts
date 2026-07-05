export interface CoreApiConfig {
  port: number
  'socks-port': number
  'mixed-port': number
  'interface-name': string
  'allow-lan': boolean
  mode: string
  tun: {
    enable: boolean
    stack: string
    device: string
  }
}

export interface CoreApiProxy {
  alive: boolean
  all: string[]
  name: string
  now: string
  type: string
  udp: boolean
  history: {
    delay: number
  }[]
}

export interface CoreApiProxies {
  proxies: Record<string, CoreApiProxy>
}

export interface CoreApiDnsQueryResponse {
  Status: number
  Server: string
  Answer?: { data: string; name: string; type: number; TTL: number }[]
}

export interface CoreApiConnectionRecord {
  id: string
  chains: string[]
  download: number
  upload: number
  rule: string
  rulePayload: string
  start: string
  metadata: {
    host: string
    destinationIP: string
    destinationPort: string
    dnsMode: string
    network: string
    processPath: string
    sourceIP: string
    sourcePort: string
    type: string
  }
}

export interface CoreApiConnections {
  connections: CoreApiConnectionRecord[]
}

export interface CoreApiTrafficData {
  down: number
  up: number
}

export interface CoreApiMemoryData {
  inuse: number
  oslimit: number
}

export interface CoreApiLogsData {
  type: string
  payload: string
}

export interface CoreApiConnectionsData {
  memory: number
  uploadTotal: number
  downloadTotal: number
  connections: CoreApiConnectionRecord[]
}

export type CoreApiWsDataMap = {
  logs: CoreApiLogsData
  memory: CoreApiMemoryData
  traffic: CoreApiTrafficData
  connections: CoreApiConnectionsData
}
