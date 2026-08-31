import { describe, expect, it } from 'vitest'

import { ensureNodeGroupOutlet } from '@/utils/nodeGroupOutlet'

const group = { id: 'group-hk', name: 'Hong Kong' } as App.NodeGroup

describe('node-group outlet shortcut', () => {
  it('creates a visible manual selector linked to the source group', () => {
    const outbounds: App.Outbound[] = []

    const outbound = ensureNodeGroupOutlet(outbounds, group, 'manual', 'Manual')

    expect(outbound).toMatchObject({
      type: 'selector',
      tag: 'Hong Kong · Manual',
      role: 'custom',
      hidden: false,
      source_node_group: group.id,
      outbounds: [{ id: group.id, tag: group.name, type: 'NodeGroup' }],
    })
    expect(outbounds).toEqual([outbound])
  })

  it('reuses only a matching source and behavior while preserving unique tags', () => {
    const outbounds: App.Outbound[] = []
    const manual = ensureNodeGroupOutlet(outbounds, group, 'manual', 'Manual')
    const reused = ensureNodeGroupOutlet(outbounds, group, 'manual', 'Manual')
    const automatic = ensureNodeGroupOutlet(outbounds, group, 'auto', 'Automatic')

    expect(reused).toBe(manual)
    expect(automatic.type).toBe('urltest')
    expect(outbounds).toHaveLength(2)
  })
})
