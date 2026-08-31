import { DefaultOutbound } from '@/constant/profile'
import { Outbound } from '@/enums/kernel'

export type NodeGroupOutletBehavior = 'manual' | 'auto'

const uniqueOutboundTag = (outbounds: App.Outbound[], desired: string, currentId = '') => {
  const occupied = new Set(
    outbounds.filter((outbound) => outbound.id !== currentId).map((outbound) => outbound.tag),
  )
  if (!occupied.has(desired)) return desired
  let sequence = 2
  while (occupied.has(`${desired} (${sequence})`)) sequence += 1
  return `${desired} (${sequence})`
}

export const ensureNodeGroupOutlet = (
  outbounds: App.Outbound[],
  group: Pick<App.NodeGroup, 'id' | 'name'>,
  behavior: NodeGroupOutletBehavior,
  behaviorLabel: string,
) => {
  const type = behavior === 'auto' ? Outbound.Urltest : Outbound.Selector
  let outbound = outbounds.find(
    (candidate) => candidate.source_node_group === group.id && candidate.type === type,
  )
  if (!outbound) {
    outbound = DefaultOutbound()
    outbound.type = type
    outbounds.push(outbound)
  }

  outbound.tag = uniqueOutboundTag(
    outbounds,
    `${group.name} · ${behaviorLabel}`,
    outbound.id,
  )
  outbound.role = 'custom'
  outbound.hidden = false
  outbound.source_node_group = group.id
  outbound.outbounds = [{ id: group.id, tag: group.name, type: 'NodeGroup' }]
  return outbound
}
