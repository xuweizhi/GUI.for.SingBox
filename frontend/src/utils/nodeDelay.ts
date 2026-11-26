import type { CoreApiProxy } from '@/types/kernel'

export type DelayStatus = 'untested' | 'success' | 'failed'
export type DelayErrorCategory =
  | 'dns'
  | 'authentication'
  | 'tls'
  | 'connection-refused'
  | 'network-unreachable'
  | 'connection-reset'
  | 'timeout'
  | 'unknown'

export interface NodeDelayError {
  category: DelayErrorCategory
  message: string
  attempts: number
  maxAttempts: number
}

export interface NodeListItem {
  name: string
  displayName?: string
  role?: App.OutboundRole
  proxy?: CoreApiProxy
  delay: number | null
  delayStatus: DelayStatus
  originalIndex: number
  error?: NodeDelayError
  attempts?: number
}

export const delayColor = (delay?: number | null) => {
  if (!delay) return 'var(--muted-color)'
  const level = delay < 500 ? 1 : delay < 1000 ? 2 : delay < 1500 ? 3 : 4
  return `var(--level-${level}-color)`
}
