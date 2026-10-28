type WebSocketsOptions = {
  base?: string
  bearer?: string
  beforeConnect?: () => void
}

type Options = { url: string; cb: (data: any) => void; params?: Record<string, any> }

export class WebSockets {
  public base: string
  public bearer: string
  public beforeConnect: () => void

  constructor(options: WebSocketsOptions) {
    this.base = options.base || ''
    this.bearer = options.bearer || ''
    this.beforeConnect = options.beforeConnect || (() => 0)
  }

  public createWS(options: Options) {
    let active = false
    let generation = 0
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const clearReconnect = () => {
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    const closeSocket = () => {
      if (!ws) return
      ws.onmessage = null
      ws.onclose = null
      ws.close()
      ws = null
    }
    const openSocket = (revision: number) => {
      if (!active || revision !== generation) return
      this.beforeConnect()
      const params = { ...options.params, token: this.bearer }
      const query = new URLSearchParams(params).toString()
      const url = query ? `${options.url}?${query}` : options.url
      const socket = new WebSocket(this.base + url)
      ws = socket
      socket.onmessage = (event) => {
        if (active && revision === generation && socket === ws) {
          options.cb(JSON.parse(event.data))
        }
      }
      socket.onclose = () => {
        if (!active || revision !== generation || socket !== ws) return
        ws = null
        clearReconnect()
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined
          openSocket(revision)
        }, 4000)
      }
    }
    const connect = () => {
      active = true
      generation += 1
      clearReconnect()
      closeSocket()
      openSocket(generation)
    }
    const disconnect = () => {
      active = false
      generation += 1
      clearReconnect()
      closeSocket()
    }

    return { connect, disconnect }
  }
}
