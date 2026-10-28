import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebSockets } from '../websocket'

const instances: FakeSocket[] = []
class FakeSocket {
  onclose: (() => void) | null = null
  onmessage: ((data: any) => void) | null = null
  close = vi.fn()
  constructor(public url: string) {
    instances.push(this)
  }
}
beforeEach(() => {
  instances.length = 0
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('review UI WebSocket lifecycle', () => {
  it('must not reopen a disconnected stream with a pending reconnect timer', () => {
    const channel = new WebSockets({ base: 'ws://core' }).createWS({ url: '/traffic', cb: vi.fn() })
    channel.connect()
    instances[0]!.onclose!()
    vi.advanceTimersByTime(1000)
    channel.disconnect()
    vi.advanceTimersByTime(3000)
    expect(instances).toHaveLength(1)
  })
  it('must reconnect after a previously disconnected channel is subscribed again', () => {
    const channel = new WebSockets({ base: 'ws://core' }).createWS({ url: '/traffic', cb: vi.fn() })
    channel.connect()
    channel.disconnect()
    channel.connect()
    instances[1]!.onclose!()
    vi.advanceTimersByTime(4000)
    expect(instances).toHaveLength(3)
  })
})

it('ignores messages and close callbacks from an earlier connection generation', () => {
  const cb = vi.fn()
  const sockets = new WebSockets({ base: 'ws://core', bearer: 'old' })
  const channel = sockets.createWS({ url: '/traffic', cb })
  channel.connect()
  const oldMessage = instances[0]!.onmessage!
  const oldClose = instances[0]!.onclose!
  sockets.bearer = 'new'
  channel.connect()
  oldMessage({ data: '{"old":true}' })
  oldClose()
  vi.advanceTimersByTime(4000)
  expect(instances).toHaveLength(2)
  expect(instances[1]!.url).toContain('token=new')
  expect(cb).not.toHaveBeenCalled()
  instances[1]!.onmessage!({ data: '{"current":true}' })
  expect(cb).toHaveBeenCalledWith({ current: true })
  channel.disconnect()
})
