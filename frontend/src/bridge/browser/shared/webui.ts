import { useWebuiAuthStore } from '@/stores'

const API_BASE = '/__webui/api'
const EVENT_STREAM_RECONNECT_DELAY = 1000
const EVENT_STREAM_AUTH_PROBE_BODY = JSON.stringify({
  method: 'GetEnv',
  args: [''],
})

type EventCallback = (...data: any[]) => void
type ServerEvent = {
  name: string
  data: any[]
}

const listeners = new Map<string, Set<EventCallback>>()
let eventSource: EventSource | null = null
let reconnectTimer: number | null = null
let probingEventStreamError = false

const dispatchEvent = (name: string, data: any[] = []) => {
  const callbacks = Array.from(listeners.get(name) ?? [])
  callbacks.forEach((callback) => callback(...data))
}

const resetEventStream = () => {
  if (!eventSource) return

  eventSource.close()
  eventSource = null
}

const clearEventStreamReconnect = () => {
  if (reconnectTimer == null) return

  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

const scheduleEventStreamReconnect = () => {
  if (reconnectTimer || typeof window === 'undefined' || listeners.size === 0) return

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    ensureEventStream()
  }, EVENT_STREAM_RECONNECT_DELAY)
}

const closeEventStreamIfUnused = () => {
  if (listeners.size !== 0) return

  clearEventStreamReconnect()
  resetEventStream()
}

const probeEventStreamAuth = async () => {
  const authStore = useWebuiAuthStore()
  const token = authStore.token.trim()
  if (!token) return true

  const response = await fetch(`${API_BASE}/rpc?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: EVENT_STREAM_AUTH_PROBE_BODY,
  })

  if (response.status === 401) {
    await authStore.handleUnauthorized()
    return false
  }

  return true
}

const handleEventStreamError = async () => {
  resetEventStream()

  if (probingEventStreamError) {
    scheduleEventStreamReconnect()
    return
  }

  probingEventStreamError = true
  let shouldReconnect = true
  try {
    shouldReconnect = await probeEventStreamAuth()
  } catch (error) {
    console.warn('Failed to verify WebUI auth after SSE error:', error)
  } finally {
    probingEventStreamError = false
  }

  if (shouldReconnect) {
    scheduleEventStreamReconnect()
  }
}

const ensureEventStream = () => {
  if (eventSource || typeof window === 'undefined') return

  clearEventStreamReconnect()
  eventSource = new EventSource(`${API_BASE}/events`)
  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data) as ServerEvent
    dispatchEvent(payload.name, payload.data || [])
  }
  eventSource.onerror = () => {
    void handleEventStreamError()
  }
}

const handleUnauthorized = async (response: Response) => {
  if (response.status !== 401) return

  await useWebuiAuthStore().handleUnauthorized()
  throw 'auth.invalidToken'
}

export const onRuntimeEvent = (name: string, callback: EventCallback) => {
  ensureEventStream()

  if (!listeners.has(name)) {
    listeners.set(name, new Set())
  }

  listeners.get(name)!.add(callback)

  return () => {
    const callbackSet = listeners.get(name)
    callbackSet?.delete(callback)
    if (!callbackSet?.size) {
      listeners.delete(name)
    }
    closeEventStreamIfUnused()
  }
}

export const offRuntimeEvent = (name: string) => {
  listeners.delete(name)
  closeEventStreamIfUnused()
}

export const offAllRuntimeEvents = () => {
  listeners.clear()
  closeEventStreamIfUnused()
}

export const emitRuntimeEvent = (name: string, ...data: any[]) => {
  dispatchEvent(name, data)

  void fetch(`${API_BASE}/emit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, data }),
  })
    .then(handleUnauthorized)
    .catch((error) => {
      console.warn('Failed to emit runtime event:', error)
    })
}

export const invokeBridge = async <T>(method: string, args: unknown[] = []) => {
  ensureEventStream()

  const response = await fetch(`${API_BASE}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ method, args }),
  })

  await handleUnauthorized(response)

  if (!response.ok) {
    const message = await response.text()
    throw message || `Bridge call failed: ${method}`
  }

  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}
