import { describe, expect, it } from 'vitest'

import type { CoreApiConnectionRecord } from '@/types/kernel'
import {
  buildRulesetCheckItems,
  matchLatestConnection,
} from '@/views/NetCheckView/networkCheckRuntime'

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
  it('marks missing and disabled rulesets as failed', () => {
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
        status: 'failed',
        summary: 'ruleset missing',
        detail: 'https://example.com/missing.json',
      },
      {
        id: 'ruleset-disabled',
        title: 'Disabled Ruleset',
        status: 'failed',
        summary: 'ruleset disabled',
        detail: 'data/rulesets/disabled.json',
      },
    ])
  })
})
