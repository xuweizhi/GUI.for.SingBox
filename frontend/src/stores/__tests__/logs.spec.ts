import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLogsStore } from '@/stores/logs'

describe('logs store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hydrates kernel logs from file content with newest lines first', () => {
    const store = useLogsStore()

    store.hydrateKernelLogs('INFO[0000] boot complete\r\nwarning: retrying upstream\n')

    expect(store.kernelLogs).toEqual(['warning: retrying upstream', 'INFO[0000] boot complete'])
    expect(store.kernelApiLogs).toEqual([
      { type: 'warn', payload: 'warning: retrying upstream' },
      { type: 'info', payload: 'INFO[0000] boot complete' },
    ])
  })

  it('keeps the console sources independent during refresh and clear', () => {
    const store = useLogsStore()
    store.recordKernelApiLog({ type: 'info', payload: 'API message' })
    store.hydrateKernelLogs('INFO[0001] process output')
    expect(store.apiEntries.map(entry => entry.payload)).toEqual(['API message'])
    expect(store.processEntries.map(entry => entry.payload)).toEqual(['INFO[0001] process output'])
    store.clearSource('core')
    store.hydrateKernelLogs('INFO[0001] process output')
    expect(store.processEntries).toEqual([])
    expect(store.apiEntries).toHaveLength(1)
    store.hydrateKernelLogs('INFO[0002] refreshed', true)
    expect(store.processEntries[0]?.payload).toBe('INFO[0002] refreshed')
  })

  it('records live kernel logs in both raw and structured collections', () => {
    const store = useLogsStore()

    store.recordKernelApiLog({ type: 'error', payload: 'dial tcp timeout' })

    expect(store.kernelLogs).toEqual(['[error] dial tcp timeout'])
    expect(store.kernelApiLogs).toEqual([{ type: 'error', payload: 'dial tcp timeout' }])

    store.clearKernelLog()

    expect(store.isEmpty).toBe(true)
    expect(store.kernelApiLogs).toEqual([])
  })
})
