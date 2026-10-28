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

  const fieldSubscriptions = [
    subscription('provider-a', [
      { id: 'hk', tag: 'HK 01', type: 'vless' },
      { id: 'jp', tag: 'JP 01', type: 'trojan' },
      { id: 'hk-test', tag: 'HK Test', type: 'trojan' },
    ], { name: 'HK trojan Provider' }),
    subscription('provider-b', [{ id: 'other', tag: 'Other 01', type: 'trojan' }], {
      name: 'Another Provider',
    }),
  ]

  it('matches only node names when a subscription name contains the same region', () => {
    const result = resolveNodeGroup(
      group({ mode: 'filter', match_field: 'name', include: '^hk', exclude: 'test' }),
      fieldSubscriptions,
    )

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['hk'])
    expect(result.nodes[0]!.match).toEqual({ field: 'name', value: 'HK 01' })
  })

  it('matches and excludes only the selected protocol field', () => {
    const result = resolveNodeGroup(
      group({ mode: 'filter', match_field: 'protocol', include: 'trojan', exclude: 'HK' }),
      fieldSubscriptions,
    )

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['jp', 'hk-test', 'other'])
    expect(result.nodes[0]!.match).toEqual({ field: 'protocol', value: 'trojan' })
    expect(resolveNodeGroup(
      group({ mode: 'filter', match_field: 'protocol', exclude: '^TROJAN$' }),
      fieldSubscriptions,
    ).nodes.map((node) => node.proxy.id)).toEqual(['hk'])
  })

  it('matches only source subscription names with include and exclude filters', () => {
    const result = resolveNodeGroup(
      group({ mode: 'filter', match_field: 'subscription', include: 'provider$', exclude: '^hk' }),
      fieldSubscriptions,
    )

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['other'])
    expect(result.nodes[0]!.match).toEqual({ field: 'subscription', value: 'Another Provider' })
    expect(resolveNodeGroup(
      group({ mode: 'filter', match_field: 'subscription', include: 'JP' }),
      fieldSubscriptions,
    ).nodes).toEqual([])
  })

  it('preserves legacy combined text including regexes spanning multiple fields', () => {
    const legacy = group({ mode: 'filter', include: 'provider JP 01 trojan$' })
    const result = resolveNodeGroup(legacy, fieldSubscriptions)

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['jp'])
    expect(result.nodes[0]!.match).toEqual({ field: 'all', value: 'HK trojan Provider JP 01 trojan' })
    expect(resolveNodeGroup({ ...legacy, match_field: 'all' }, fieldSubscriptions)).toEqual(result)
  })

  it('still restricts explicit-field matching to selected enabled sources and the node limit', () => {
    const result = resolveNodeGroup(
      group({
        mode: 'filter',
        match_field: 'protocol',
        include: '^trojan$',
        source_scope: 'selected',
        subscription_ids: ['disabled', 'provider-a'],
        max_nodes: 1,
      }),
      [
        subscription('disabled', [{ id: 'disabled', tag: 'Disabled', type: 'trojan' }], {
          disabled: true,
        }),
        ...fieldSubscriptions,
      ],
    )

    expect(result.nodes.map((node) => node.proxy.id)).toEqual(['jp'])
  })

  it('reports invalid exclusions with an explicit field without returning partial matches', () => {
    const result = resolveNodeGroup(
      group({ mode: 'filter', match_field: 'name', exclude: '[' }),
      fieldSubscriptions,
    )

    expect(result.nodes).toEqual([])
    expect(result.issues).toEqual([{ type: 'invalid-filter', field: 'exclude', expression: '[' }])
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
  const runtimeResolution = (tag = 'HK 01', provider = 'Provider') => resolveNodeGroup(
    group({ members: [{ subscription_id: 'sub', node_id: 'node', last_known_tag: tag }] }),
    [subscription('sub', [{ id: 'node', tag, type: 'socks' }], { name: provider })],
  )

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

  it('retains every direct and chained variant including numeric collision suffixes', () => {
    const runtime = ['HK 01', 'HK 01 [via Upstream]', 'HK 01 [via Backup] 2', 'Unrelated']

    expect([...getNodeGroupRuntimeNames(runtimeResolution(), runtime)]).toEqual(runtime.slice(0, 3))
    expect([...getNodeGroupRuntimeNames(runtimeResolution(), ['HK 01 [via Upstream]'])]).toEqual([
      'HK 01 [via Upstream]',
    ])
  })

  it('recognizes subscription aliases and all their chained variants', () => {
    const runtime = [
      'HK 01',
      'HK 01 [via Other provider upstream]',
      'HK 01 [Provider]',
      'HK 01 [Provider] [via Upstream]',
      'HK 01 [Provider 2] [via Nested [via Outer]]',
      'HK 01 [Provider] 2 [via Backup] 3',
    ]

    expect([...getNodeGroupRuntimeNames(runtimeResolution(), runtime)]).toEqual(runtime.slice(2))
  })

  it('does not confuse subscription-name prefixes or regular expression characters', () => {
    expect([...getNodeGroupRuntimeNames(runtimeResolution(), [
      'HK 01 [Provider Extra]', 'HK 01 [Provider Extra] [via Upstream]',
    ])]).toEqual([])
    expect([...getNodeGroupRuntimeNames(runtimeResolution('HK [A]+', 'Provider (1)'), [
      'HK [A]+ [Provider (1)] [via Upstream]',
      'HK A [Provider 1] [via Upstream]',
    ])]).toEqual(['HK [A]+ [Provider (1)] [via Upstream]'])
  })

  it('preserves literal user tags containing a chain marker before matching further variants', () => {
    const runtime = [
      'HK [via Office]',
      'HK [via Office] [via Upstream]',
      'HK [via Office] [Provider] [via Upstream] 2',
    ]
    // Qualified names still take priority when a duplicate requires them.
    expect([...getNodeGroupRuntimeNames(runtimeResolution('HK [via Office]'), runtime)]).toEqual([
      runtime[2],
    ])
    expect([...getNodeGroupRuntimeNames(runtimeResolution('HK [via Office]'), runtime.slice(0, 2))]).toEqual(
      runtime.slice(0, 2),
    )
  })

  it('rejects partial or malformed chain suffixes', () => {
    expect([...getNodeGroupRuntimeNames(runtimeResolution(), [
      'HK 010 [via Upstream]', 'HK 01 [via ]', 'HK 01 [via Upstream', 'HK 01 [via Upstream] extra',
    ])]).toEqual([])
  })

  it('uses complete source metadata to exclude another node with a literal chain marker', () => {
    const literal = subscription('literal-source', [
      { id: 'literal', tag: 'HK 01 [via Office]', type: 'trojan' },
    ])
    const runtime = [
      'HK 01', 'HK 01 [via Upstream]',
      'HK 01 [via Office]', 'HK 01 [via Office] [via Upstream]',
    ]

    expect([...getNodeGroupRuntimeNames(runtimeResolution(), runtime, [literal])]).toEqual(runtime.slice(0, 2))
    expect([...getNodeGroupRuntimeNames(runtimeResolution('HK 01 [via Office]'), runtime, [literal])]).toEqual(runtime.slice(2))
  })
})
