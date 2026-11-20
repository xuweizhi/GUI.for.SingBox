import { describe, expect, it } from 'vitest'

import type { CoreApiConnectionRecord } from '@/types/kernel'

import { connectionOptions, filterConnections } from '../connectionFilters'

const sample = (
  id: string,
  network: string,
  host: string,
  chains: string[],
): CoreApiConnectionRecord => ({
  id,
  chains,
  download: 0,
  upload: 0,
  rule: 'RuleSet',
  rulePayload: 'work-domains',
  start: '',
  metadata: {
    host,
    destinationIP: '203.0.113.4',
    destinationPort: '443',
    dnsMode: '',
    network,
    processPath: '/usr/bin/browser',
    sourceIP: '192.0.2.1',
    sourcePort: '30001',
    type: 'mixed',
  },
})
const records = [
  sample('1', 'udp', 'one.test', ['Tokyo', 'Proxy']),
  sample('2', 'tcp', 'two.test', ['Osaka', 'Proxy']),
  sample('3', 'udp', 'two.test', ['Frankfurt', 'Work']),
]

describe('connection filters', () => {
  it('combines fields and accepts any selected value within a field', () => {
    const selected = filterConnections(records, ' WORK-domains ', {
      network: ['UDP'],
      source: ['192.0.2.1'],
      chain: ['Tokyo', 'Frankfurt'],
      host: ['two.test'],
      rule: ['RuleSet::work-domains'],
      port: ['443'],
      process: ['/usr/bin/browser'],
    })
    expect(selected.map(({ id }) => id)).toEqual(['3'])
    expect(filterConnections(records, 'tokYO', {})).toEqual([records[0]])
    expect(filterConnections(records, 'ruleset', { host: ['203.0.113.4'] })).toHaveLength(3)
  })

  it('retains selected values for closed or expired rows, without duplicates', () => {
    const options = connectionOptions(records, { host: ['expired.test'] })
    expect(options.host.map((item) => item.value)).toEqual([
      '203.0.113.4',
      'expired.test',
      'one.test',
      'two.test',
    ])
    expect(options.network.map((item) => item.value)).toEqual(['TCP', 'UDP'])
    expect(filterConnections([], '', { host: ['expired.test'] })).toEqual([])
  })
})
