const API_BASE = '/__webui/api'

type EventCallback = (...data: any[]) => void
type ServerEvent = {
  name: string
  data: any[]
}

const listeners = new Map<string, Set<EventCallback>>()
let eventSource: EventSource | null = null

const dispatchEvent = (name: string, data: any[] = []) => {
  const callbacks = Array.from(listeners.get(name) ?? [])
  callbacks.forEach((callback) => callback(...data))
}

const ensureEventStream = () => {
  if (eventSource || typeof window === 'undefined') return

  eventSource = new EventSource(`${API_BASE}/events`)
  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data) as ServerEvent
    dispatchEvent(payload.name, payload.data || [])
  }
  eventSource.onerror = () => 0
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
  }
}

export const offRuntimeEvent = (name: string) => {
  listeners.delete(name)
}

export const offAllRuntimeEvents = () => {
  listeners.clear()
}

export const emitRuntimeEvent = (name: string, ...data: any[]) => {
  dispatchEvent(name, data)

  void fetch(`${API_BASE}/emit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, data }),
  }).catch((error) => {
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

  if (!response.ok) {
    const message = await response.text()
    throw message || `Bridge call failed: ${method}`
  }

  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}
