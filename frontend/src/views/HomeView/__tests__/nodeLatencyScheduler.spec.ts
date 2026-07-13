import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/others', () => ({
  normalizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

vi.mock('@/api/kernel', () => ({
  getProxyDelay: vi.fn(async () => ({ delay: 1 })),
}))

import { getProxyDelay } from '@/api/kernel'
import {
  createNodeLatencyScheduler,
  nodeLatencyScheduler,
} from '@/views/HomeView/nodeLatencyScheduler'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('createNodeLatencyScheduler', () => {
  it('encodes names only in the application singleton', async () => {
    const probe = vi.fn(async () => ({ delay: 1 }))
    await createNodeLatencyScheduler(probe).submit({
      nodes: ['A/B C'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
    }).done
    await nodeLatencyScheduler.submit({
      nodes: ['A/B C'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
    }).done

    expect(probe).toHaveBeenCalledWith('A/B C', 'url', 1)
    expect(getProxyDelay).toHaveBeenCalledWith('A%2FB%20C', 'url', 1)
  })

  it('fills the next concurrency slot as soon as one probe finishes', async () => {
    const probes = new Map(['A', 'B', 'C'].map((name) => [name, deferred<{ delay?: number }>()]))
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler((name) => {
      started.push(name)
      return probes.get(name)!.promise
    })

    const task = scheduler.submit({
      nodes: ['A', 'B', 'C'],
      url: 'url',
      timeout: 1000,
      concurrency: 2,
    })
    await tick()
    expect(started).toEqual(['A', 'B'])

    probes.get('A')!.resolve({ delay: 10 })
    await tick()
    await tick()
    expect(started).toEqual(['A', 'B', 'C'])

    probes.get('B')!.resolve({ delay: 20 })
    probes.get('C')!.resolve({ delay: 30 })
    await expect(task.done).resolves.toMatchObject({
      total: 3,
      completed: 3,
      success: 3,
      cancelled: false,
    })
  })

  it('limits a 100-node task to 20 active probes', async () => {
    let active = 0
    let peak = 0
    const scheduler = createNodeLatencyScheduler(async () => {
      active++
      peak = Math.max(peak, active)
      await tick()
      active--
      return { delay: 1 }
    })

    const nodes = Array.from({ length: 100 }, (_, index) => `node-${index}`)
    await scheduler.submit({ nodes, url: 'url', timeout: 1000, concurrency: 20 }).done

    expect(peak).toBe(20)
  })

  it('deduplicates nodes and emits their initial queued state', async () => {
    const probe = vi.fn(async (_name: string, _url: string, _timeout: number) => ({ delay: 8 }))
    const onState = vi.fn()
    const scheduler = createNodeLatencyScheduler(probe)

    const summary = await scheduler.submit({
      nodes: ['A', 'A', 'B'],
      url: 'url',
      timeout: 1000,
      concurrency: 1,
      onState,
    }).done

    expect(probe.mock.calls.map(([name]) => name)).toEqual(['A', 'B'])
    expect(onState.mock.calls.slice(0, 2)).toEqual([
      ['A', 'queued'],
      ['B', 'queued'],
    ])
    expect(summary.total).toBe(2)
  })

  it('reports success, normalized exceptions, and unavailable delays', async () => {
    const onState = vi.fn()
    const onResult = vi.fn()
    const scheduler = createNodeLatencyScheduler(async (name) => {
      if (name === 'success') return { delay: 42 }
      if (name === 'unavailable') return { delay: 0 }
      if (name === 'negative') return { delay: -1 }
      throw new Error('no such host')
    })

    const summary = await scheduler.submit({
      nodes: ['success', 'error', 'unavailable', 'negative'],
      url: 'url',
      timeout: 1000,
      concurrency: 4,
      onState,
      onResult,
    }).done

    expect(onResult.mock.calls.map(([result]) => result)).toEqual(
      expect.arrayContaining([
        { ok: true, name: 'success', delay: 42, attempts: 1 },
        {
          ok: false,
          name: 'unavailable',
          category: 'unknown',
          message: 'home.nodes.unavailable',
          attempts: 1,
          maxAttempts: 1,
        },
        {
          ok: false,
          name: 'negative',
          category: 'unknown',
          message: 'home.nodes.unavailable',
          attempts: 1,
          maxAttempts: 1,
        },
        {
          ok: false,
          name: 'error',
          category: 'dns',
          message: 'no such host',
          attempts: 1,
          maxAttempts: 1,
        },
      ]),
    )
    expect(onState).toHaveBeenCalledWith('success', 'success')
    expect(onState).toHaveBeenCalledWith('error', 'failed')
    expect(onState).toHaveBeenCalledWith('unavailable', 'failed')
    expect(summary).toEqual({
      total: 4,
      completed: 4,
      success: 1,
      failure: 3,
      retryQueued: 0,
      cancelled: false,
    })
  })

  it('emits queued, testing, then success for a successful node', async () => {
    const phases: string[] = []
    const scheduler = createNodeLatencyScheduler(async () => ({ delay: 5 }))

    await scheduler.submit({
      nodes: ['A'],
      url: 'url',
      timeout: 1000,
      concurrency: 1,
      onState: (_name, phase) => phases.push(phase),
    }).done

    expect(phases).toEqual(['queued', 'testing', 'success'])
  })

  it('cancels queued nodes without starting them or reporting results', async () => {
    const first = deferred<{ delay?: number }>()
    const probe = vi.fn(() => first.promise)
    const onResult = vi.fn()
    const onState = vi.fn()
    const scheduler = createNodeLatencyScheduler(probe)
    const task = scheduler.submit({
      nodes: ['A', 'B', 'C'],
      url: 'url',
      timeout: 1000,
      concurrency: 1,
      onResult,
      onState,
    })

    task.cancel()
    first.resolve({ delay: 5 })

    await expect(task.done).resolves.toEqual({
      total: 3,
      completed: 3,
      success: 0,
      failure: 0,
      retryQueued: 0,
      cancelled: true,
    })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(onState).toHaveBeenCalledWith('B', 'cancelled')
    expect(onState).toHaveBeenCalledWith('C', 'cancelled')
    expect(onState).not.toHaveBeenCalledWith('A', 'success')
    expect(onState).not.toHaveBeenCalledWith('A', 'failed')
  })

  it('expands the global limit when a higher-concurrency task is submitted', async () => {
    const pending: Array<ReturnType<typeof deferred<{ delay?: number }>>> = []
    let active = 0
    let peak = 0
    const scheduler = createNodeLatencyScheduler(() => {
      active++
      peak = Math.max(peak, active)
      const probe = deferred<{ delay?: number }>()
      pending.push(probe)
      return probe.promise.finally(() => active--)
    })

    const low = scheduler.submit({ nodes: ['low'], url: 'url', timeout: 1, concurrency: 1 })
    await tick()
    expect(active).toBe(1)

    const high = scheduler.submit({
      nodes: Array.from({ length: 20 }, (_, index) => `high-${index}`),
      url: 'url',
      timeout: 1,
      concurrency: 20,
    })
    await tick()
    expect(peak).toBe(20)

    low.cancel()
    high.cancel()
    while (pending.length) pending.shift()!.resolve({ delay: 1 })
    await Promise.all([high.done, low.done])
  })

  it('does not start more probes after the global limit is lowered below running', async () => {
    const pending: Array<ReturnType<typeof deferred<{ delay?: number }>>> = []
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler((name) => {
      started.push(name)
      const request = deferred<{ delay?: number }>()
      pending.push(request)
      return request.promise
    })
    const high = scheduler.submit({
      nodes: Array.from({ length: 21 }, (_, index) => `high-${index}`),
      url: 'url',
      timeout: 1,
      concurrency: 20,
    })
    await tick()
    expect(started).toHaveLength(20)

    const low = scheduler.submit({ nodes: ['low'], url: 'url', timeout: 1, concurrency: 1 })
    pending.shift()!.resolve({ delay: 1 })
    await tick()
    await tick()
    expect(started).toHaveLength(20)

    while (pending.length) pending.shift()!.resolve({ delay: 1 })
    while (started.length < 22) {
      await tick()
      pending.shift()?.resolve({ delay: 1 })
    }
    while (pending.length) pending.shift()!.resolve({ delay: 1 })
    await Promise.all([high.done, low.done])
  })

  it('finishes and releases the slot when probe throws synchronously', async () => {
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler((name) => {
      started.push(name)
      if (name === 'A') throw new Error('TLS certificate error')
      return Promise.resolve({ delay: 9 })
    })

    const summary = await scheduler.submit({
      nodes: ['A', 'B'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
    }).done

    expect(started).toEqual(['A', 'B'])
    expect(summary).toMatchObject({ completed: 2, success: 1, failure: 1 })
  })

  it('continues scheduling when state and result callbacks throw', async () => {
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler(async (name) => {
      started.push(name)
      return { delay: 7 }
    })

    const task = scheduler.submit({
      nodes: ['A', 'B'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
      onState: () => {
        throw new Error('state callback')
      },
      onResult: () => {
        throw new Error('result callback')
      },
    })

    await expect(task.done).resolves.toMatchObject({ completed: 2, success: 2 })
    expect(started).toEqual(['A', 'B'])
  })

  it('selects active tasks round-robin', async () => {
    const probes = new Map(['A1', 'A2', 'B'].map((name) => [name, deferred<{ delay?: number }>()]))
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler((name) => {
      started.push(name)
      return probes.get(name)!.promise
    })
    const first = scheduler.submit({ nodes: ['A1', 'A2'], url: 'url', timeout: 1, concurrency: 1 })
    const second = scheduler.submit({ nodes: ['B'], url: 'url', timeout: 1, concurrency: 1 })

    await tick()
    probes.get('A1')!.resolve({ delay: 1 })
    await tick()
    await tick()
    expect(started).toEqual(['A1', 'B'])

    probes.get('B')!.resolve({ delay: 1 })
    await tick()
    probes.get('A2')!.resolve({ delay: 1 })
    await Promise.all([first.done, second.done])
  })

  it('runs every initial probe before a queued retry', async () => {
    const started: string[] = []
    let attempts = 0
    const scheduler = createNodeLatencyScheduler(async (name) => {
      started.push(name)
      if (name === 'A' && attempts++ === 0) throw new Error('request timeout')
      return { delay: 5 }
    })

    await scheduler.submit({ nodes: ['A', 'B'], url: 'url', timeout: 1, concurrency: 1 }).done

    expect(started).toEqual(['A', 'B', 'A'])
  })

  it('starts all 100 initial probes before any retry under mixed transient failures', async () => {
    const attempts = new Map<string, number>()
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler(async (name) => {
      started.push(name)
      const attempt = (attempts.get(name) ?? 0) + 1
      attempts.set(name, attempt)
      if (Number(name.slice(5)) % 2 === 0 && attempt === 1) {
        throw new Error('request timeout')
      }
      return { delay: 5 }
    })
    const nodes = Array.from({ length: 100 }, (_, index) => `node-${index}`)

    await scheduler.submit({ nodes, url: 'url', timeout: 1, concurrency: 20 }).done

    expect(started.slice(0, 100)).toEqual(nodes)
    expect(new Set(started.slice(0, 100)).size).toBe(100)
    expect(started).toHaveLength(150)
  })

  it.each([
    ['request timeout', 2],
    ['reset by peer', 2],
    ['unexpected EOF', 2],
    ['network is unreachable', 2],
    ['no such host', 1],
    ['authentication failed', 1],
    ['TLS certificate error', 1],
    ['connection refused', 1],
    ['something else', 1],
  ])('probes %s errors the expected number of times', async (message, expected) => {
    const probe = vi.fn(async () => {
      throw new Error(message)
    })
    const scheduler = createNodeLatencyScheduler(probe)

    await scheduler.submit({ nodes: ['A'], url: 'url', timeout: 1, concurrency: 1 }).done

    expect(probe).toHaveBeenCalledTimes(expected)
  })

  it.each([
    ['succeeds', { delay: 12 }, { completed: 1, success: 1, failure: 0 }],
    ['fails', new Error('request timeout'), { completed: 1, success: 0, failure: 1 }],
  ])(
    'reports a retry that %s with attempts and states',
    async (_label, second, expectedSummary) => {
      const states: string[] = []
      const results: unknown[] = []
      let attempt = 0
      const scheduler = createNodeLatencyScheduler(async () => {
        if (attempt++ === 0) throw new Error('request timeout')
        if (second instanceof Error) throw second
        return second
      })

      const summary = await scheduler.submit({
        nodes: ['A'],
        url: 'url',
        timeout: 1,
        concurrency: 1,
        onState: (_name, state) => states.push(state),
        onResult: (result) => results.push(result),
      }).done

      expect(attempt).toBe(2)
      expect(states).toEqual([
        'queued',
        'testing',
        'retry-queued',
        'testing',
        second instanceof Error ? 'failed' : 'success',
      ])
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject(
        second instanceof Error
          ? { ok: false, attempts: 2, maxAttempts: 2 }
          : { ok: true, attempts: 2 },
      )
      expect(summary).toMatchObject({ ...expectedSummary, retryQueued: 0 })
    },
  )

  it('prioritizes another task initial probe over a retry', async () => {
    const first = deferred<{ delay?: number }>()
    const started: string[] = []
    let aAttempts = 0
    const scheduler = createNodeLatencyScheduler((name) => {
      started.push(name)
      if (name === 'A' && aAttempts++ === 0) return first.promise
      return Promise.resolve({ delay: 3 })
    })
    const taskA = scheduler.submit({ nodes: ['A'], url: 'url', timeout: 1, concurrency: 1 })
    const taskB = scheduler.submit({ nodes: ['B'], url: 'url', timeout: 1, concurrency: 1 })

    first.reject(new Error('request timeout'))
    await Promise.all([taskA.done, taskB.done])

    expect(started).toEqual(['A', 'B', 'A'])
  })

  it('cancels a retry-queued node without starting its retry', async () => {
    const blocker = deferred<{ delay?: number }>()
    const calls: string[] = []
    let retryTask!: ReturnType<ReturnType<typeof createNodeLatencyScheduler>['submit']>
    const scheduler = createNodeLatencyScheduler(async (name) => {
      calls.push(name)
      if (name === 'A') throw new Error('request timeout')
      return blocker.promise
    })
    retryTask = scheduler.submit({
      nodes: ['A', 'B'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
      onState: (name, state) => {
        if (name === 'A' && state === 'retry-queued') retryTask.cancel()
      },
    })

    await expect(retryTask.done).resolves.toEqual({
      total: 2,
      completed: 2,
      success: 0,
      failure: 0,
      retryQueued: 0,
      cancelled: true,
    })
    expect(calls).toEqual(['A'])
  })

  it('does not start a probe when testing state synchronously cancels the task', async () => {
    const probe = vi.fn(async () => {
      throw new Error('request timeout')
    })
    const scheduler = createNodeLatencyScheduler(probe)
    let task!: ReturnType<typeof scheduler.submit>
    task = scheduler.submit({
      nodes: ['A'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
      onState: (_name, state) => {
        if (state === 'testing' && probe.mock.calls.length === 1) task.cancel()
      },
    })

    await expect(task.done).resolves.toMatchObject({ cancelled: true, success: 0, failure: 0 })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('removes a synchronously cancelled subscriber without affecting an active probe', async () => {
    const shared = deferred<{ delay?: number }>()
    const blocker = deferred<{ delay?: number }>()
    const probe = vi.fn((name: string) => {
      if (name === 'blocker') return blocker.promise
      return shared.promise
    })
    const scheduler = createNodeLatencyScheduler(probe)
    let subscriber!: ReturnType<typeof scheduler.submit>
    subscriber = scheduler.submit({
      nodes: ['blocker', 'A'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
      onState: (name, state) => {
        if (name === 'A' && state === 'testing') subscriber.cancel()
      },
    })
    await tick()

    const owner = scheduler.submit({
      nodes: ['A'],
      url: 'url',
      timeout: 1,
      concurrency: 1,
    })
    await tick()
    expect(probe.mock.calls.map(([name]) => name)).toEqual(['blocker'])

    blocker.resolve({ delay: 8 })
    await tick()
    await tick()
    expect(probe.mock.calls.map(([name]) => name)).toEqual(['blocker', 'A'])

    await expect(subscriber.done).resolves.toMatchObject({ cancelled: true, success: 1, failure: 0 })
    shared.resolve({ delay: 8 })
    await expect(owner.done).resolves.toMatchObject({ success: 1, cancelled: false })
  })

  it('shares one active request between tasks with the same probe key', async () => {
    const request = deferred<{ delay?: number }>()
    const probe = vi.fn(() => request.promise)
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { nodes: ['A'], url: 'url', timeout: 1000, concurrency: 20 }
    const firstResult = vi.fn()
    const secondResult = vi.fn()

    const first = scheduler.submit({ ...options, onResult: firstResult })
    const second = scheduler.submit({ ...options, onResult: secondResult })
    let firstSettled = false
    let secondSettled = false
    void first.done.finally(() => {
      firstSettled = true
    })
    void second.done.finally(() => {
      secondSettled = true
    })
    await tick()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)

    request.resolve({ delay: 12 })
    await expect(Promise.all([first.done, second.done])).resolves.toEqual([
      expect.objectContaining({ success: 1 }),
      expect.objectContaining({ success: 1 }),
    ])
    expect(firstResult).toHaveBeenCalledWith({ ok: true, name: 'A', delay: 12, attempts: 1 })
    expect(secondResult).toHaveBeenCalledWith({ ok: true, name: 'A', delay: 12, attempts: 1 })
  })

  it('counts a shared request as one global concurrency slot', async () => {
    const requests = new Map(['A', 'B'].map((name) => [name, deferred<{ delay?: number }>()]))
    const started: string[] = []
    const scheduler = createNodeLatencyScheduler((name) => {
      started.push(name)
      return requests.get(name)!.promise
    })
    const options = { url: 'url', timeout: 1000, concurrency: 2 }

    const first = scheduler.submit({ ...options, nodes: ['A'] })
    const second = scheduler.submit({ ...options, nodes: ['A', 'B'] })
    await tick()

    expect(started).toEqual(['A', 'B'])
    requests.get('A')!.resolve({ delay: 10 })
    requests.get('B')!.resolve({ delay: 11 })
    await Promise.all([first.done, second.done])
  })

  it('does not share requests for different node names', async () => {
    const probe = vi.fn(async (_name: string, _url: string, _timeout: number) => ({ delay: 12 }))
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { url: 'url', timeout: 1000, concurrency: 20 }

    await Promise.all([
      scheduler.submit({ ...options, nodes: ['A'] }).done,
      scheduler.submit({ ...options, nodes: ['B'] }).done,
    ])

    expect(probe.mock.calls.map(([name]) => name)).toEqual(['A', 'B'])
  })

  it('does not share requests with different URLs or timeouts', async () => {
    const probe = vi.fn(async () => ({ delay: 12 }))
    const scheduler = createNodeLatencyScheduler(probe)

    await Promise.all([
      scheduler.submit({ nodes: ['A'], url: 'one', timeout: 1000, concurrency: 20 }).done,
      scheduler.submit({ nodes: ['A'], url: 'two', timeout: 1000, concurrency: 20 }).done,
      scheduler.submit({ nodes: ['A'], url: 'one', timeout: 2000, concurrency: 20 }).done,
    ])

    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('does not share requests with different non-finite timeouts', async () => {
    const requests = [
      deferred<{ delay?: number }>(),
      deferred<{ delay?: number }>(),
      deferred<{ delay?: number }>(),
    ]
    const probe = vi.fn(() => requests[probe.mock.calls.length - 1]!.promise)
    const scheduler = createNodeLatencyScheduler(probe)
    const submit = (timeout: number) =>
      scheduler.submit({
        nodes: ['A'],
        url: 'url',
        timeout,
        concurrency: 20,
      })

    const tasks = [
      submit(Number.NaN),
      submit(Number.POSITIVE_INFINITY),
      submit(Number.NEGATIVE_INFINITY),
    ]
    await tick()
    expect(probe).toHaveBeenCalledTimes(3)

    requests.forEach((request) => request.resolve({ delay: 1 }))
    await Promise.all(tasks.map((task) => task.done))
  })

  it.each(['', 'A\u0000B', '\ud800'])(
    'passes the special node name %j unchanged to a factory probe',
    async (name) => {
      const probe = vi.fn(async () => ({ delay: 1 }))
      const scheduler = createNodeLatencyScheduler(probe)
      let task: ReturnType<typeof scheduler.submit> | undefined

      expect(() => {
        task = scheduler.submit({ nodes: [name], url: 'url\u0000part', timeout: 1, concurrency: 1 })
      }).not.toThrow()
      await expect(task!.done).resolves.toMatchObject({ success: 1 })
      expect(probe).toHaveBeenCalledWith(name, 'url\u0000part', 1)
    },
  )

  it('reports singleton name encoding errors as an asynchronous failure', async () => {
    let task: ReturnType<typeof nodeLatencyScheduler.submit> | undefined

    expect(() => {
      task = nodeLatencyScheduler.submit({
        nodes: ['\ud800'],
        url: 'url',
        timeout: 1,
        concurrency: 1,
      })
    }).not.toThrow()
    await expect(task!.done).resolves.toMatchObject({ completed: 1, failure: 1 })
    expect(getProxyDelay).not.toHaveBeenCalledWith('\ud800', 'url', 1)
  })

  it('cancels one subscriber without affecting the shared request', async () => {
    const request = deferred<{ delay?: number }>()
    const probe = vi.fn(() => request.promise)
    const scheduler = createNodeLatencyScheduler(probe)
    const firstResult = vi.fn()
    const secondResult = vi.fn()
    const options = { nodes: ['A'], url: 'url', timeout: 1000, concurrency: 20 }
    const first = scheduler.submit({ ...options, onResult: firstResult })
    const second = scheduler.submit({ ...options, onResult: secondResult })

    first.cancel()
    request.resolve({ delay: 12 })

    await expect(first.done).resolves.toMatchObject({ cancelled: true, success: 0, failure: 0 })
    await expect(second.done).resolves.toMatchObject({ cancelled: false, success: 1 })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(firstResult).not.toHaveBeenCalled()
    expect(secondResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true, name: 'A' }))
  })

  it('releases a shared slot after every subscriber cancels and the request settles', async () => {
    const requests = [
      deferred<{ delay?: number }>(),
      deferred<{ delay?: number }>(),
      deferred<{ delay?: number }>(),
    ]
    const started: string[] = []
    const probe = vi.fn((name: string) => {
      started.push(name)
      return requests[probe.mock.calls.length - 1]!.promise
    })
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { url: 'url', timeout: 1000, concurrency: 1 }
    const first = scheduler.submit({ ...options, nodes: ['A'] })
    const second = scheduler.submit({ ...options, nodes: ['A'] })
    await tick()
    first.cancel()
    second.cancel()
    await Promise.all([first.done, second.done])

    const blocked = scheduler.submit({ ...options, nodes: ['B'] })
    await tick()
    expect(started).toEqual(['A'])

    requests[0]!.resolve({ delay: 1 })
    await tick()
    await tick()
    expect(started).toEqual(['A', 'B'])
    requests[1]!.resolve({ delay: 1 })
    await blocked.done

    const repeated = scheduler.submit({ ...options, nodes: ['A'] })
    await tick()
    expect(started).toEqual(['A', 'B', 'A'])
    requests[2]!.resolve({ delay: 1 })
    await repeated.done
  })

  it('shares both retryable attempts between tasks', async () => {
    const requests = [deferred<{ delay?: number }>(), deferred<{ delay?: number }>()]
    const probe = vi.fn(() => requests[probe.mock.calls.length - 1]!.promise)
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { nodes: ['A'], url: 'url', timeout: 1000, concurrency: 20 }
    const first = scheduler.submit(options)
    const second = scheduler.submit(options)
    await tick()

    requests[0]!.reject(new Error('request timeout'))
    await tick()
    await tick()
    expect(probe).toHaveBeenCalledTimes(2)

    requests[1]!.resolve({ delay: 9 })
    await expect(Promise.all([first.done, second.done])).resolves.toEqual([
      expect.objectContaining({ success: 1 }),
      expect.objectContaining({ success: 1 }),
    ])
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('attaches a later task initial attempt to an active retry and keeps logical attempts separate', async () => {
    const sharedRetry = deferred<{ delay?: number }>()
    const laterRetry = deferred<{ delay?: number }>()
    let calls = 0
    const probe = vi.fn(() => {
      calls++
      if (calls === 1) return Promise.reject(new Error('request timeout'))
      if (calls === 2) return sharedRetry.promise
      return laterRetry.promise
    })
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { nodes: ['A'], url: 'url', timeout: 1000, concurrency: 20 }
    const firstResult = vi.fn()
    const secondResult = vi.fn()
    const first = scheduler.submit({ ...options, onResult: firstResult })
    await tick()
    await tick()
    await tick()
    expect(probe).toHaveBeenCalledTimes(2)

    const second = scheduler.submit({ ...options, onResult: secondResult })
    await tick()
    expect(probe).toHaveBeenCalledTimes(2)

    sharedRetry.reject(new Error('request timeout'))
    await expect(first.done).resolves.toMatchObject({ failure: 1 })
    await tick()
    expect(firstResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false, attempts: 2 }))
    expect(secondResult).not.toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(3)

    laterRetry.resolve({ delay: 10 })
    await expect(second.done).resolves.toMatchObject({ success: 1 })
    expect(secondResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attempts: 2 }))
  })

  it('starts a new request after a shared request is cleaned up', async () => {
    const probe = vi.fn(async () => ({ delay: 12 }))
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { nodes: ['A'], url: 'url', timeout: 1000, concurrency: 20 }

    await scheduler.submit(options).done
    await scheduler.submit(options).done

    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('starts a new request after a rejected request is cleaned up', async () => {
    const probe = vi.fn(async () => {
      throw new Error('connection refused')
    })
    const scheduler = createNodeLatencyScheduler(probe)
    const options = { nodes: ['A'], url: 'url', timeout: 1000, concurrency: 20 }

    await expect(scheduler.submit(options).done).resolves.toMatchObject({ failure: 1 })
    await expect(scheduler.submit(options).done).resolves.toMatchObject({ failure: 1 })

    expect(probe).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['NaN', Number.NaN, 1],
    ['Infinity', Number.POSITIVE_INFINITY, 1],
    ['zero', 0, 1],
    ['negative', -2, 1],
    ['fraction', 2.9, 2],
  ])('normalizes %s concurrency', async (_label, concurrency, expectedStarted) => {
    const pending = [deferred<{ delay?: number }>(), deferred<{ delay?: number }>()]
    let started = 0
    const scheduler = createNodeLatencyScheduler(() => pending[started++]!.promise)
    const task = scheduler.submit({ nodes: ['A', 'B'], url: 'url', timeout: 1, concurrency })

    await tick()
    expect(started).toBe(expectedStarted)
    pending.forEach((probe) => probe.resolve({ delay: 1 }))
    await expect(task.done).resolves.toMatchObject({ completed: 2 })
  })
})
