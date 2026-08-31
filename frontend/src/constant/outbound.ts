export const DefaultOutboundIds = {
  Select: 'outbound-select',
  Urltest: 'outbound-urltest',
  Direct: 'outbound-direct',
  Block: 'outbound-block',
  Fallback: 'outbound-fallback',
  Global: 'outbound-global',
} as const

export const DefaultOutboundRoleById: Record<string, App.OutboundRole> = {
  [DefaultOutboundIds.Select]: 'proxy',
  [DefaultOutboundIds.Urltest]: 'auto',
  [DefaultOutboundIds.Direct]: 'direct',
  [DefaultOutboundIds.Block]: 'block',
  [DefaultOutboundIds.Fallback]: 'fallback',
  [DefaultOutboundIds.Global]: 'global',
}

export const OutboundRoleOptions: Array<{ label: string; value: App.OutboundRole }> = [
  { label: 'kernel.outbounds.role.proxy', value: 'proxy' },
  { label: 'kernel.outbounds.role.auto', value: 'auto' },
  { label: 'kernel.outbounds.role.direct', value: 'direct' },
  { label: 'kernel.outbounds.role.block', value: 'block' },
  { label: 'kernel.outbounds.role.fallback', value: 'fallback' },
  { label: 'kernel.outbounds.role.global', value: 'global' },
  { label: 'kernel.outbounds.role.custom', value: 'custom' },
]
