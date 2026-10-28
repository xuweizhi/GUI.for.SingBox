import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

vi.mock('@/bridge/io', () => ({ ReadFile: vi.fn() }))

import { ReadFile } from '@/bridge/io'

import { useRuntimeNodeDetails } from '../useRuntimeNodeDetails'

describe('runtime node details loading', () => {
  beforeEach(() => vi.mocked(ReadFile).mockReset())

  it('reads the active config and recomputes the selected leaf without reading secrets repeatedly', async () => {
    vi.mocked(ReadFile).mockResolvedValue(
      JSON.stringify({
        outbounds: [
          { tag: 'one', type: 'socks', domain_resolver: 'first' },
          { tag: 'two', type: 'socks', domain_resolver: 'second' },
        ],
      }),
    )
    const ready = ref(true)
    const leaf = ref('one')
    const scope = effectScope()
    const runtime = scope.run(() => useRuntimeNodeDetails(ready, leaf, ref({})))!
    await flushPromises()
    expect(runtime.details.value?.resolver).toBe('first')
    leaf.value = 'two'
    expect(runtime.details.value?.resolver).toBe('second')
    expect(ReadFile).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('discards a stale config read after the core stops and reports current read failures', async () => {
    let resolve!: (value: string) => void
    vi.mocked(ReadFile).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const ready = ref(true)
    const scope = effectScope()
    const runtime = scope.run(() => useRuntimeNodeDetails(ready, ref('one'), ref({})))!
    ready.value = false
    await nextTick()
    resolve(JSON.stringify({ outbounds: [{ tag: 'one', type: 'socks' }] }))
    await flushPromises()
    expect(runtime.details.value).toBeUndefined()
    vi.mocked(ReadFile).mockRejectedValueOnce(new Error('unavailable'))
    ready.value = true
    await flushPromises()
    expect(runtime.unavailable.value).toBe(true)
    expect(runtime.details.value).toBeUndefined()
    scope.stop()
  })
})
