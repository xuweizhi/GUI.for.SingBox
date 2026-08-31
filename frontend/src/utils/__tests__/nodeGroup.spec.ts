import { describe, expect, it } from 'vitest'

import {
  getNodeGroupDependencies,
  getNodeGroupRuntimeNames,
  removeNodeGroupReferences,
  resolveNodeGroup,
} from '@/utils/nodeGroup'

const subscription = (
  id: string,
  proxies: Array<{ id: string; tag: string; type: string }>,
  options: Partial<App.Subscription> = {},
) =>
  ({
    id,
    name: id,
    proxies,
    disabled: false,
    ...options,
  }) as App.Subscription

const group = (overrides: Partial<App.NodeGroup> = {}): App.NodeGroup => ({
  id: 'group-hk',
  name: 'Hong Kong',
  icon: '',
  mode: 'manual',
  members: [],
  source_scope: 'all',
  subscription_ids: [],
  include: '',
  exclude: '',
  max_nodes: 0,
  ...overrides,
})

describe('node-group resolution', () => {
  it('preserves manual order, deduplicates members, and reports unresolved members', () => {
    const subscriptions = [
      subscription('alpha', [
        { id: 'hk-1', tag: 'HK 01', type: 'vmess' },
        { id: 'jp-1', tag: 'JP 01', type: 'trojan' },
      ]),
    ]
    const result = resolveNodeGroup(
      group({
        members: [
          { subscription_id: 'alpha', node_id: 'jp-1', last_known_tag: 'JP 01' },
          { subscription_id: 'alpha', node_id: 'hk-1', last_known_tag: 'HK 01' },
          { subscription_id: 'alpha', node_id: 'jp-1', last_known_tag: 'JP 01' },
          { subscription_id: 'missing', node_id: 'lost', last_known_tag: 'Lost Node' },
        ],
      }),
      subscriptions,
    )

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['jp-1', 'hk-1'])
    expect(result.issues).toEqual([
      expect.objectContaining({
        type: 'missing-subscription',
        subscription_id: 'missing',
        node_id: 'lost',
        label: 'Lost Node',
      }),
    ])
  })

  it('resolves dynamic groups from selected enabled subscriptions with filters and a limit', () => {
    const subscriptions = [
      subscription(
        'provider-a',
        [
          { id: 'hk-1', tag: 'Hong Kong Premium', type: 'vmess' },
          { id: 'hk-test', tag: 'Hong Kong Test', type: 'vmess' },
          { id: 'jp-1', tag: 'Japan Premium', type: 'trojan' },
        ],
        { name: 'Premium Provider' },
      ),
      subscription('provider-b', [{ id: 'hk-2', tag: 'Hong Kong 02', type: 'hysteria2' }]),
      subscription('disabled', [{ id: 'hk-3', tag: 'Hong Kong 03', type: 'vmess' }], {
        disabled: true,
      }),
    ]

    const result = resolveNodeGroup(
      group({
        mode: 'filter',
        source_scope: 'selected',
        subscription_ids: ['provider-a', 'provider-b', 'disabled'],
        include: 'hong kong|premium provider',
        exclude: 'test',
        max_nodes: 2,
      }),
      subscriptions,
    )

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['hk-1', 'jp-1'])
    expect(result.issues).toEqual([])
  })

  it('reports invalid filters without throwing', () => {
    const result = resolveNodeGroup(
      group({ mode: 'filter', include: '[' }),
      [subscription('alpha', [{ id: 'hk-1', tag: 'HK 01', type: 'vmess' }])],
    )

    expect(result.nodes).toEqual([])
    expect(result.issues).toEqual([
      expect.objectContaining({ type: 'invalid-filter', field: 'include' }),
    ])
  })
})

describe('node-group dependencies', () => {
  const profiles = [
    {
      id: 'profile-a',
      name: 'Default',
      outbounds: [
        {
          id: 'strategy-a',
          tag: 'Auto HK',
          outbounds: [{ id: 'group-hk', tag: 'Hong Kong', type: 'NodeGroup' }],
        },
      ],
    },
  ] as App.Profile[]

  it('finds profile and strategy references', () => {
    expect(getNodeGroupDependencies('group-hk', profiles)).toEqual([
      {
        profileId: 'profile-a',
        profileName: 'Default',
        outboundId: 'strategy-a',
        outboundName: 'Auto HK',
      },
    ])
  })

  it('removes references only after an explicit cascade operation', () => {
    expect(removeNodeGroupReferences('group-hk', profiles)).toBe(1)
    expect(profiles[0]!.outbounds[0]!.outbounds).toEqual([])
  })
})

describe('node-group runtime labels', () => {
  it('maps duplicate tags to the subscription-qualified runtime tag', () => {
    const first = subscription('sub-a', [{ id: 'a', tag: 'Same Node', type: 'socks' }], {
      name: 'Provider A',
    })
    const second = subscription('sub-b', [{ id: 'b', tag: 'Same Node', type: 'socks' }], {
      name: 'Provider B',
    })
    const resolution = resolveNodeGroup(
      group({
        members: [
          { subscription_id: 'sub-b', node_id: 'b', last_known_tag: 'Same Node' },
        ],
      }),
      [first, second],
    )

    expect(
      [...getNodeGroupRuntimeNames(resolution, ['Same Node', 'Same Node [Provider B]'])],
    ).toEqual(['Same Node [Provider B]'])
  })
})
