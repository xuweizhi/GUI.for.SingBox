import { getProxyDelay } from '@/api/kernel'
import { normalizeErrorMessage } from '@/utils/others'
import { classifyDelayError, isRetryableDelayError } from '@/views/HomeView/nodeController'

import type { DelayErrorCategory } from '@/views/HomeView/nodeController'

export type LatencyNodePhase =
  | 'queued'
  | 'testing'
  | 'retry-queued'
  | 'success'
  | 'failed'
  | 'cancelled'

export interface LatencySuccessResult {
  ok: true
  name: string
  delay: number
  attempts: number
}

export interface LatencyFailureResult {
  ok: false
  name: string
  category: DelayErrorCategory
  message: string
  attempts: number
  maxAttempts: number
}

export type LatencyResult = LatencySuccessResult | LatencyFailureResult

export interface LatencyTaskSummary {
  total: number
  completed: number
  success: number
  failure: number
  retryQueued: number
  cancelled: boolean
}

export interface SubmitLatencyTaskOptions {
  nodes: string[]
  url: string
  timeout: number
  concurrency: number
  onState?: (name: string, phase: LatencyNodePhase) => void
  onResult?: (result: LatencyResult) => void
}

export interface LatencyTaskHandle {
  done: Promise<LatencyTaskSummary>
  cancel: () => void
}

export type LatencyProbe = (
  name: string,
  url: string,
  timeout: number,
) => Promise<{ delay?: number }>

export interface NodeLatencyScheduler {
  submit: (options: SubmitLatencyTaskOptions) => LatencyTaskHandle
}

interface Task {
  options: SubmitLatencyTaskOptions
  queue: string[]
  retryQueue: string[]
  running: Set<string>
  summary: LatencyTaskSummary
  cancelled: boolean
  resolve: (summary: LatencyTaskSummary) => void
}

interface ProbeSubscriber {
  task: Task
  name: string
  attempts: number
}

interface ActiveProbe {
  subscribers: Set<ProbeSubscriber>
}

export const createNodeLatencyScheduler = (probe: LatencyProbe): NodeLatencyScheduler => {
  const tasks = new Set<Task>()
  const activeProbes = new Map<string, Map<string, Map<number, ActiveProbe>>>()
  const activeProbeSet = new Set<ActiveProbe>()
  let running = 0
  let currentLimit = 1
  let pumping = false
  let lastSelected: Task | undefined

  const notify = (callback: (() => void) | undefined) => {
    try {
      callback?.()
    } catch {
      // Consumer callbacks cannot affect scheduler bookkeeping.
    }
  }

  const finishIfComplete = (task: Task) => {
    if (task.summary.completed !== task.summary.total || task.running.size) return
    tasks.delete(task)
    task.resolve({ ...task.summary })
  }

  const completeProbe = (
    task: Task,
    name: string,
    attempts: number,
    result?: { delay?: number },
    error?: unknown,
  ) => {
    task.running.delete(name)

    if (task.cancelled) {
      finishIfComplete(task)
    } else {
      const message = error === undefined ? undefined : normalizeErrorMessage(error)
      const category = message === undefined ? undefined : classifyDelayError(message)
      if (attempts === 1 && category !== undefined && isRetryableDelayError(category)) {
        task.retryQueue.push(name)
        task.summary.retryQueued++
        notify(() => task.options.onState?.(name, 'retry-queued'))
        return
      }

      let latencyResult: LatencyResult
      if (error !== undefined) {
        latencyResult = {
          ok: false,
          name,
          category: category!,
          message: message!,
          attempts,
          maxAttempts: attempts,
        }
      } else if (!(result?.delay && result.delay > 0)) {
        latencyResult = {
          ok: false,
          name,
          category: 'unknown',
          message: 'home.nodes.unavailable',
          attempts,
          maxAttempts: attempts,
        }
      } else {
        latencyResult = { ok: true, name, delay: result.delay, attempts }
      }

      task.summary.completed++
      if (latencyResult.ok) task.summary.success++
      else task.summary.failure++
      notify(() => task.options.onResult?.(latencyResult))
      notify(() => task.options.onState?.(name, latencyResult.ok ? 'success' : 'failed'))
    }

    finishIfComplete(task)
  }

  const findActiveProbe = (task: Task, name: string) =>
    activeProbes.get(name)?.get(task.options.url)?.get(task.options.timeout)

  const addActiveProbe = (task: Task, name: string, active: ActiveProbe) => {
    let urls = activeProbes.get(name)
    if (!urls) activeProbes.set(name, (urls = new Map()))
    let timeouts = urls.get(task.options.url)
    if (!timeouts) urls.set(task.options.url, (timeouts = new Map()))
    timeouts.set(task.options.timeout, active)
    activeProbeSet.add(active)
  }

  const deleteActiveProbe = (task: Task, name: string) => {
    const urls = activeProbes.get(name)
    const timeouts = urls?.get(task.options.url)
    const active = timeouts?.get(task.options.timeout)
    if (!active) return
    timeouts!.delete(task.options.timeout)
    if (!timeouts!.size) urls!.delete(task.options.url)
    if (!urls!.size) activeProbes.delete(name)
    activeProbeSet.delete(active)
  }

  const start = (task: Task, name: string, attempts: number) => {
    task.running.add(name)
    if (attempts === 2) task.summary.retryQueued--
    const subscriber = { task, name, attempts }
    const active = findActiveProbe(task, name)
    if (active) {
      active.subscribers.add(subscriber)
      notify(() => task.options.onState?.(name, 'testing'))
      return
    }

    const created: ActiveProbe = { subscribers: new Set([subscriber]) }
    addActiveProbe(task, name, created)
    notify(() => task.options.onState?.(name, 'testing'))
    if (!created.subscribers.size) {
      deleteActiveProbe(task, name)
      return
    }

    running++
    Promise.resolve()
      .then(() => probe(name, task.options.url, task.options.timeout))
      .then(
        (result) => {
          deleteActiveProbe(task, name)
          running--
          for (const item of created.subscribers) {
            completeProbe(item.task, item.name, item.attempts, result)
          }
          pump()
        },
        (error) => {
          deleteActiveProbe(task, name)
          running--
          for (const item of created.subscribers) {
            completeProbe(item.task, item.name, item.attempts, undefined, error)
          }
          pump()
        },
      )
  }

  const pump = () => {
    if (pumping) return
    pumping = true
    try {
      while (tasks.size) {
        const activeTasks = Array.from(tasks)
        const startIndex =
          lastSelected && activeTasks.includes(lastSelected)
            ? activeTasks.indexOf(lastSelected) + 1
            : 0
        const initialPriority = activeTasks.some(
          (candidate) =>
            !candidate.cancelled &&
            candidate.queue.length > 0,
        )
        let task: Task | undefined
        let attempts = initialPriority ? 1 : 2
        for (let offset = 0; offset < activeTasks.length; offset++) {
          const candidate = activeTasks[(startIndex + offset) % activeTasks.length]!
          const queue = initialPriority ? candidate.queue : candidate.retryQueue
          const name = queue[0]
          if (
            !candidate.cancelled &&
            name !== undefined &&
            (running < currentLimit || findActiveProbe(candidate, name) !== undefined)
          ) {
            task = candidate
            break
          }
        }
        if (!task) break
        lastSelected = task
        start(task, (initialPriority ? task.queue : task.retryQueue).shift()!, attempts)
      }
    } finally {
      pumping = false
    }
  }

  const submit = (options: SubmitLatencyTaskOptions): LatencyTaskHandle => {
    const queue = [...new Set(options.nodes)]
    const concurrency =
      Number.isFinite(options.concurrency) && options.concurrency > 0
        ? Math.max(1, Math.floor(options.concurrency))
        : 1
    currentLimit = concurrency
    let resolve!: (summary: LatencyTaskSummary) => void
    const done = new Promise<LatencyTaskSummary>((resolvePromise) => {
      resolve = resolvePromise
    })
    const task: Task = {
      options: { ...options, concurrency },
      queue,
      retryQueue: [],
      running: new Set(),
      summary: {
        total: queue.length,
        completed: 0,
        success: 0,
        failure: 0,
        retryQueued: 0,
        cancelled: false,
      },
      cancelled: false,
      resolve,
    }

    queue.forEach((name) => notify(() => options.onState?.(name, 'queued')))
    tasks.add(task)
    finishIfComplete(task)
    pump()

    return {
      done,
      cancel: () => {
        if (task.cancelled || task.summary.completed === task.summary.total) return
        task.cancelled = true
        task.summary.cancelled = true
        for (const name of task.queue.splice(0)) {
          task.summary.completed++
          notify(() => task.options.onState?.(name, 'cancelled'))
        }
        for (const name of task.retryQueue.splice(0)) {
          task.summary.retryQueued--
          task.summary.completed++
          notify(() => task.options.onState?.(name, 'cancelled'))
        }
        for (const name of task.running) {
          notify(() => task.options.onState?.(name, 'cancelled'))
          for (const active of activeProbeSet) {
            for (const subscriber of active.subscribers) {
              if (subscriber.task === task && subscriber.name === name) {
                active.subscribers.delete(subscriber)
              }
            }
          }
          task.running.delete(name)
          task.summary.completed++
        }
        finishIfComplete(task)
        pump()
      },
    }
  }

  return { submit }
}

export const nodeLatencyScheduler = createNodeLatencyScheduler((name, url, timeout) =>
  getProxyDelay(encodeURIComponent(name), url, timeout),
)
