import { describe, expect, it } from 'vitest'

import {
  buildRulesetCheckItems,
  matchLatestConnection,
} from '@/views/NetCheckView/networkCheckRuntime'

import type { CoreApiConnectionRecord } from '@/types/kernel'

describe('matchLatestConnection', () => {
  it('prefers the latest host and port match', () => {
    const connections: CoreApiConnectionRecord[] = [
      {
        id: 'older-host-match',
        chains: ['Proxy'],
        download: 0,
        upload: 0,
        rule: 'RULE-SET',
        rulePayload: 'example',
        start: '2026-07-05T10:00:00.000Z',
        metadata: {
          host: 'example.com',
          destinationIP: '93.184.216.34',
          destinationPort: '443',
          dnsMode: 'normal',
          network: 'tcp',
          processPath: '/bin/app',
          sourceIP: '127.0.0.1',
          sourcePort: '12345',
          type: 'http',
        },
      },
      {
        id: 'latest-host-match',
        chains: ['Proxy'],
        download: 0,
        upload: 0,
        rule: 'RULE-SET',
        rulePayload: 'example',
        start: '2026-07-05T10:05:00.000Z',
        metadata: {
          host: 'example.com',
          destinationIP: '93.184.216.34',
          destinationPort: '443',
          dnsMode: 'normal',
          network: 'tcp',
          processPath: '/bin/app',
          sourceIP: '127.0.0.1',
          sourcePort: '12346',
          type: 'http',
        },
      },
      {
        id: 'wrong-port',
        chains: ['Proxy'],
        download: 0,
        upload: 0,
        rule: 'RULE-SET',
        rulePayload: 'example',
        start: '2026-07-05T10:10:00.000Z',
        metadata: {
          host: 'example.com',
          destinationIP: '93.184.216.34',
          destinationPort: '80',
          dnsMode: 'normal',
          network: 'tcp',
          processPath: '/bin/app',
          sourceIP: '127.0.0.1',
          sourcePort: '12347',
          type: 'http',
        },
      },
    ]

    expect(
      matchLatestConnection(connections, {
        targetHost: 'example.com',
        targetPort: 443,
      }),
    ).toMatchObject({ id: 'latest-host-match' })
  })
})

describe('buildRulesetCheckItems', () => {
  it('distinguishes native remote URLs and disabled GUI registrations from runtime evidence', () => {
    const items = buildRulesetCheckItems(
      [
        {
          id: 'missing',
          type: 'remote',
          tag: 'missing-tag',
          rules: '',
          path: '',
          url: 'https://example.com/missing.json',
          download_detour: '',
          update_interval: '',
          format: 'source',
        },
        {
          id: 'disabled',
          type: 'local',
          tag: 'disabled-tag',
          rules: '',
          path: 'ruleset-disabled',
          url: '',
          download_detour: '',
          update_interval: '',
          format: 'source',
        },
      ],
      [
        {
          id: 'ruleset-disabled',
          name: 'Disabled Ruleset',
          updateTime: 0,
          disabled: true,
          type: 'Manual',
          format: 'source',
          path: 'data/rulesets/disabled.json',
          url: '',
          count: 12,
        },
      ],
    )

    expect(items).toEqual([
      {
        id: 'ruleset-missing',
        title: 'missing-tag',
        status: 'skipped',
        summary: 'diagnostics.profileOnly',
        detail: undefined,
      },
      {
        id: 'ruleset-disabled',
        title: 'disabled-tag',
        status: 'skipped',
        summary: 'diagnostics.registryDisabled',
        detail: 'data/rulesets/disabled.json',
      },
    ])
  })
  it('matches core counts by URL and download failures by tag', () => {
    const url = 'https://host/rules.srs'
    const remote = { id: 'r', tag: 'remote', url, type: 'remote' } as App.ProfileRuleSet
    const evidence = { counts: { [url]: 3 }, cached: { [url]: '2026-07-01' } }
    expect(buildRulesetCheckItems([remote], [], evidence)[0]).toMatchObject({
      status: 'success',
      detail: '3 · 2026-07-01',
    })
    expect(
      buildRulesetCheckItems([remote], [], { ...evidence, failed: { remote: 'offline' } })[0],
    ).toMatchObject({ status: 'failed', detail: '3 · 2026-07-01 · offline' })
    const native = {
      type: 'local',
      path: '/rules/local.srs',
      native_path: '/rules/local.srs',
    } as App.ProfileRuleSet
    const broken = { ...native, path: 'missing-id' }
    expect(buildRulesetCheckItems([native, broken], []).map((row) => row.summary)).toEqual([
      'diagnostics.profileOnly',
      'diagnostics.missingReference',
    ])
  })
})
