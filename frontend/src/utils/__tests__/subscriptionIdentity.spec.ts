import { describe, expect, it } from 'vitest'

import { reconcileSubscriptionProxyIds } from '@/utils/subscriptionIdentity'

const previousMetadata: App.Subscription['proxies'] = [
  { id: 'stable-id', tag: 'Old Name', type: 'vmess' },
]

const reconcile = (previous: Recordable[], next: Recordable[]) =>
  reconcileSubscriptionProxyIds(previousMetadata, previous, next, () => 'new-id')

describe('subscription proxy identity reconciliation', () => {
  it('retains an ID when only the presentation tag changes', () => {
    const previous = [
      { type: 'vmess', tag: 'Old Name', server: 'hk.example.com', server_port: 443, uuid: 'a' },
    ]
    const next = [
      { type: 'vmess', tag: 'New Name', server: 'hk.example.com', server_port: 443, uuid: 'a' },
    ]

    expect(reconcile(previous, next)).toEqual([
      { id: 'stable-id', tag: 'New Name', type: 'vmess' },
    ])
  })

  it('retains an ID by a unique protocol and endpoint when credentials rotate', () => {
    const previous = [
      { type: 'vmess', tag: 'Old Name', server: 'hk.example.com', server_port: 443, uuid: 'a' },
    ]
    const next = [
      {
        type: 'vmess',
        tag: 'Renamed and Rotated',
        server: 'hk.example.com',
        server_port: 443,
        uuid: 'b',
      },
    ]

    expect(reconcile(previous, next)[0]!.id).toBe('stable-id')
  })

  it('retains an ID by a unique name when an endpoint rotates', () => {
    const previous = [
      { type: 'vmess', tag: 'Old Name', server: 'old.example.com', server_port: 443, uuid: 'a' },
    ]
    const next = [
      { type: 'vmess', tag: 'Old Name', server: 'new.example.com', server_port: 8443, uuid: 'b' },
    ]

    expect(reconcile(previous, next)[0]!.id).toBe('stable-id')
  })
})
