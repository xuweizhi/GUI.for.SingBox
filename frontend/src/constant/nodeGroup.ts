import { sampleID } from '@/utils/others'

export const DefaultNodeGroup = (): App.NodeGroup => ({
  id: sampleID(),
  name: '',
  icon: '',
  mode: 'manual',
  members: [],
  source_scope: 'all',
  subscription_ids: [],
  include: '',
  exclude: '',
  max_nodes: 0,
})

export const NodeGroupMemberType = 'NodeGroup' as const
