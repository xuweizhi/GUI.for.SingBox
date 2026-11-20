import { describe, expect, it } from 'vitest'

import {
  legacyNodeKeys,
  makeNodeCatalog,
  readNodeCatalog,
  rememberNode,
  subscriptionNodeKey,
} from '../nodePreferences'

describe('runtime node catalog', () => {
  it('rejects stale or malformed catalogs on reconnect, including a missing legacy file', () => {
    const keys = new Map([['__proto__', subscriptionNodeKey('a', '1')]])
    const catalog = makeNodeCatalog('running config', 'profile', keys)
    const serialized = JSON.stringify(catalog)
    expect(readNodeCatalog('running config', serialized)).toEqual(catalog)
    expect(readNodeCatalog('changed config', serialized)).toBeUndefined()
    expect(readNodeCatalog('running config', '')).toBeUndefined()
    expect(
      readNodeCatalog('running config', JSON.stringify({ ...catalog, nodes: [true] })),
    ).toBeUndefined()
  })

  it('avoids attributing ambiguous tags on older cores and bounds the recent list', () => {
    const subscriptions = ['a', 'b'].map((id) => ({
      id,
      name: id.toUpperCase(),
      proxies: [{ tag: 'same', id: '1' }],
    })) as App.Subscription[]
    const keys = legacyNodeKeys(undefined, subscriptions)
    expect(keys.get('same')).toBeUndefined()
    expect(keys.get('same [B]')).toBe(subscriptionNodeKey('b', '1'))
    expect(
      rememberNode(
        Array.from({ length: 30 }, (_, i) => String(i)),
        'new',
      ),
    ).toHaveLength(30)
  })
})
