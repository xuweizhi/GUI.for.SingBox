import type { CoreApiConnectionRecord } from '@/types/kernel'

export const connectionFilterFields = {
  network: 'home.connections.network',
  source: 'home.connections.sourceIP',
  host: 'home.connections.hostOrIP',
  port: 'home.connections.destinationPort',
  process: 'home.connections.processPath',
  rule: 'home.connections.rule',
  chain: 'home.connections.chains',
}

type Field = keyof typeof connectionFilterFields
export type ConnectionFilters = Partial<Record<Field, string[]>>

const valuesFor = (
  { metadata, rule, rulePayload, chains }: CoreApiConnectionRecord,
  field: Field,
) => {
  switch (field) {
    case 'network':
      return [metadata.network?.toUpperCase()]
    case 'source':
      return [metadata.sourceIP]
    case 'host':
      return [metadata.host, metadata.destinationIP]
    case 'port':
      return [String(metadata.destinationPort ?? '')]
    case 'process':
      return [metadata.processPath]
    case 'rule':
      return rulePayload ? [rule, `${rule}::${rulePayload}`] : [rule]
    case 'chain':
      return chains || []
  }
}

const fields = Object.keys(connectionFilterFields) as Field[]

export const connectionOptions = (
  records: CoreApiConnectionRecord[],
  selected: ConnectionFilters,
) => {
  return Object.fromEntries(
    fields.map((field) => {
      const values = new Set(selected[field])
      for (const record of records) {
        for (const value of valuesFor(record, field)) if (value) values.add(value)
      }
      return [field, [...values].sort().map((value) => ({ label: value, value }))]
    }),
  ) as Record<Field, { label: string; value: string }[]>
}

export const filterConnections = (
  records: CoreApiConnectionRecord[],
  keywords: string,
  filters: ConnectionFilters,
) => {
  const query = keywords.trim().toLowerCase()
  const activeFields = fields.filter((field) => filters[field]?.length)
  if (!query && !activeFields.length) return records
  return records.filter((record) => {
    if (
      !activeFields.every((field) =>
        valuesFor(record, field).some((value) => filters[field]!.includes(value)),
      )
    )
      return false
    return (
      !query ||
      [
        ...Object.values(record.metadata),
        record.rule,
        record.rulePayload,
        ...(record.chains || []),
      ].some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(query),
      )
    )
  })
}
