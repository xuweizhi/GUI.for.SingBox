import { defineStore } from 'pinia'
import { ref } from 'vue'
import { parse } from 'yaml'

import { ReadFile, WriteFile } from '@/bridge'
import { NodeGroupsFilePath } from '@/constant/app'
import { DefaultNodeGroup } from '@/constant/nodeGroup'
import { withConfigMutation } from '@/utils/configPersistence'
import { eventBus } from '@/utils/eventBus'
import {
  findNodeGroupGraphIssues,
  getNodeGroupDependencies,
  getNodeGroupPreProxyDependents,
  removeNodeGroupReferences,
  resolveNodeGroup,
  type NodeGroupDependency,
} from '@/utils/nodeGroup'
import { deepClone, ignoredError, stringifyNoFolding } from '@/utils/others'

import { useProfilesStore } from './profiles'
import { useSubscribesStore } from './subscribes'

export class NodeGroupInUseError extends Error {
  dependencies: NodeGroupDependency[]
  dependentGroups: App.NodeGroup[]

  constructor(dependencies: NodeGroupDependency[], dependentGroups: App.NodeGroup[] = []) {
    super('node group is referenced by strategy outbounds or other node groups')
    this.name = 'NodeGroupInUseError'
    this.dependencies = dependencies
    this.dependentGroups = dependentGroups
  }
}

const normalizeNodeGroup = (raw: Partial<App.NodeGroup>): App.NodeGroup => ({
  ...DefaultNodeGroup(),
  ...raw,
  match_field: raw.match_field ?? 'all',
  members: Array.isArray(raw.members) ? raw.members : [],
  subscription_ids: Array.isArray(raw.subscription_ids) ? raw.subscription_ids : [],
  pre_proxy_group_id: raw.pre_proxy_group_id || '',
  pre_proxy_behavior: raw.pre_proxy_behavior === 'auto' ? 'auto' : 'manual',
})

export const validateNodeGroup = (
  group: App.NodeGroup,
  groups: App.NodeGroup[],
  subscriptions: App.Subscription[],
  editingId = '',
) => {
  if (!group.id.trim()) throw new Error('node group id is required')
  if (!group.name.trim()) throw new Error('node group name is required')
  if (groups.some((candidate) => candidate.id === group.id && candidate.id !== editingId)) {
    throw new Error(`duplicate node group id: ${group.id}`)
  }
  if (!['manual', 'filter'].includes(group.mode)) throw new Error('invalid node group mode')
  if (!['all', 'selected'].includes(group.source_scope)) {
    throw new Error('invalid node group source_scope')
  }
  if (!['all', 'name', 'protocol', 'subscription'].includes(group.match_field ?? 'all')) {
    throw new Error('invalid node group match_field')
  }
  if (group.pre_proxy_behavior && !['manual', 'auto'].includes(group.pre_proxy_behavior)) {
    throw new Error('invalid node group pre_proxy_behavior')
  }
  if (group.max_nodes < 0) throw new Error('node group max_nodes must not be negative')
  for (const field of ['include', 'exclude'] as const) {
    if (group.mode !== 'filter' || !group[field]) continue
    try {
      new RegExp(group[field], 'i')
    } catch {
      throw new Error(`node group ${field} is not a valid regular expression`)
    }
  }
  if (group.mode === 'filter' && group.source_scope === 'selected') {
    const ids = new Set(subscriptions.map((subscription) => subscription.id))
    const missing = group.subscription_ids.find((id) => !ids.has(id))
    if (missing) throw new Error(`node group subscription not found: ${missing}`)
  }
  if (group.pre_proxy_group_id) {
    if (group.pre_proxy_group_id === group.id) {
      throw new Error('node group cannot use itself as pre-proxy')
    }
    const nextGroups = editingId
      ? groups.map((candidate) => (candidate.id === editingId ? group : candidate))
      : [...groups, group]
    const issue = findNodeGroupGraphIssues(nextGroups).find(
      (item) => item.groupId === group.id || item.chain.includes(group.id),
    )
    if (issue?.type === 'missing-pre-proxy') {
      throw new Error(`pre-proxy node group not found: ${issue.targetId}`)
    }
    if (issue?.type === 'pre-proxy-cycle') {
      throw new Error(`circular pre-proxy node group reference: ${issue.chain.join(' → ')}`)
    }
  }
}

export const useNodeGroupsStore = defineStore('nodeGroups', () => {
  const nodeGroups = ref<App.NodeGroup[]>([])

  const setupNodeGroups = async () => {
    const data = await ignoredError(ReadFile, NodeGroupsFilePath)
    if (!data) {
      nodeGroups.value = []
      return
    }
    const parsed = parse(data)
    nodeGroups.value = Array.isArray(parsed) ? parsed.map(normalizeNodeGroup) : []
  }

  const saveNodeGroups = () =>
    withConfigMutation(() => WriteFile(NodeGroupsFilePath, stringifyNoFolding(nodeGroups.value)))

  const getNodeGroupById = (id: string) => nodeGroups.value.find((group) => group.id === id)

  const getDependencies = (id: string) =>
    getNodeGroupDependencies(id, useProfilesStore().profiles, nodeGroups.value)

  const getPreProxyDependents = (id: string) =>
    getNodeGroupPreProxyDependents(id, nodeGroups.value)

  const resolveGroup = (group: App.NodeGroup | string) => {
    const value = typeof group === 'string' ? getNodeGroupById(group) : group
    return value
      ? resolveNodeGroup(value, useSubscribesStore().subscribes)
      : { nodes: [], issues: [] }
  }

  const addNodeGroup = (group: App.NodeGroup) =>
    withConfigMutation(async () => {
      const next = normalizeNodeGroup(group)
      validateNodeGroup(next, nodeGroups.value, useSubscribesStore().subscribes)
      await WriteFile(NodeGroupsFilePath, stringifyNoFolding([...nodeGroups.value, next]))
      nodeGroups.value.push(next)
      eventBus.emit('nodeGroupChange', { id: next.id })
    })

  const editNodeGroup = (id: string, group: App.NodeGroup) =>
    withConfigMutation(async () => {
      const index = nodeGroups.value.findIndex((candidate) => candidate.id === id)
      if (index === -1) throw new Error(`${id} Not Found`)
      const next = normalizeNodeGroup(group)
      validateNodeGroup(next, nodeGroups.value, useSubscribesStore().subscribes, id)
      const profilesStore = useProfilesStore()
      const profiles = deepClone(profilesStore.profiles)
      profiles.forEach((profile) =>
        profile.outbounds.forEach((outbound) => {
          outbound.outbounds.forEach((member) => {
            if (member.type === 'NodeGroup' && member.id === id) member.tag = next.name
          })
        }),
      )
      const groups = nodeGroups.value.map((value, idx) => (idx === index ? next : value))
      await profilesStore.writeProfiles(profiles, [
        { path: NodeGroupsFilePath, content: stringifyNoFolding(groups) },
      ])
      nodeGroups.value.splice(index, 1, next)
      profilesStore.profiles = profiles
      eventBus.emit('nodeGroupChange', { id })
    })

  const deleteNodeGroup = (id: string, options: { cascade?: boolean } = {}) =>
    withConfigMutation(async () => {
      const index = nodeGroups.value.findIndex((candidate) => candidate.id === id)
      if (index === -1) return { dependencies: [], dependentGroups: [], removedReferences: 0 }
      const profilesStore = useProfilesStore()
      const dependencies = getNodeGroupDependencies(id, profilesStore.profiles, nodeGroups.value)
      const dependentGroups = getNodeGroupPreProxyDependents(id, nodeGroups.value)
      if ((dependencies.length > 0 || dependentGroups.length > 0) && !options.cascade) {
        throw new NodeGroupInUseError(dependencies, dependentGroups)
      }
      const profiles = deepClone(profilesStore.profiles)
      const groups = nodeGroups.value
        .filter((group) => group.id !== id)
        .map((group) =>
          group.pre_proxy_group_id === id ? { ...group, pre_proxy_group_id: '' } : group,
        )
      const removedReferences = removeNodeGroupReferences(id, profiles)
      const content = stringifyNoFolding(groups)
      if (removedReferences)
        await profilesStore.writeProfiles(profiles, [{ path: NodeGroupsFilePath, content }])
      else await WriteFile(NodeGroupsFilePath, content)
      nodeGroups.value = groups
      profilesStore.profiles = profiles
      new Set(dependencies.map((dependency) => dependency.profileId)).forEach((profileId) =>
        eventBus.emit('profileChange', { id: profileId }),
      )
      dependentGroups.forEach((group) => eventBus.emit('nodeGroupChange', { id: group.id }))
      eventBus.emit('nodeGroupChange', { id })
      return { dependencies, dependentGroups, removedReferences }
    })

  const addMember = (groupId: string, member: App.NodeGroupMember) =>
    withConfigMutation(async () => {
      const group = getNodeGroupById(groupId)
      if (!group) throw new Error(`${groupId} Not Found`)
      if (
        group.members.some(
          (candidate) =>
            candidate.subscription_id === member.subscription_id &&
            candidate.node_id === member.node_id,
        )
      )
        return false
      const next = deepClone(group)
      next.mode = 'manual'
      next.members.push(member)
      await WriteFile(
        NodeGroupsFilePath,
        stringifyNoFolding(nodeGroups.value.map((value) => (value.id === groupId ? next : value))),
      )
      Object.assign(group, next)
      eventBus.emit('nodeGroupChange', { id: groupId })
      return true
    })

  return {
    nodeGroups,
    setupNodeGroups,
    saveNodeGroups,
    getNodeGroupById,
    getDependencies,
    getPreProxyDependents,
    resolveGroup,
    addNodeGroup,
    editNodeGroup,
    deleteNodeGroup,
    addMember,
  }
})
