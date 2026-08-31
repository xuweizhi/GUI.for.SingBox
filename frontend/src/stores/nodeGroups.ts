import { defineStore } from 'pinia'
import { ref } from 'vue'
import { parse } from 'yaml'

import { ReadFile, WriteFile } from '@/bridge'
import { NodeGroupsFilePath } from '@/constant/app'
import { DefaultNodeGroup } from '@/constant/nodeGroup'
import {
  getNodeGroupDependencies,
  removeNodeGroupReferences,
  resolveNodeGroup,
  type NodeGroupDependency,
} from '@/utils/nodeGroup'
import { deepClone, ignoredError, stringifyNoFolding } from '@/utils/others'

import { useProfilesStore } from './profiles'
import { useSubscribesStore } from './subscribes'

export class NodeGroupInUseError extends Error {
  dependencies: NodeGroupDependency[]

  constructor(dependencies: NodeGroupDependency[]) {
    super('node group is referenced by strategy outbounds')
    this.name = 'NodeGroupInUseError'
    this.dependencies = dependencies
  }
}

const normalizeNodeGroup = (raw: Partial<App.NodeGroup>): App.NodeGroup => ({
  ...DefaultNodeGroup(),
  ...raw,
  members: Array.isArray(raw.members) ? raw.members : [],
  subscription_ids: Array.isArray(raw.subscription_ids) ? raw.subscription_ids : [],
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
  if (group.max_nodes < 0) throw new Error('node group max_nodes must not be negative')
  for (const field of ['include', 'exclude'] as const) {
    if (!group[field]) continue
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

  const saveNodeGroups = () => WriteFile(NodeGroupsFilePath, stringifyNoFolding(nodeGroups.value))

  const getNodeGroupById = (id: string) => nodeGroups.value.find((group) => group.id === id)

  const getDependencies = (id: string) =>
    getNodeGroupDependencies(id, useProfilesStore().profiles)

  const resolveGroup = (group: App.NodeGroup | string) => {
    const value = typeof group === 'string' ? getNodeGroupById(group) : group
    return value
      ? resolveNodeGroup(value, useSubscribesStore().subscribes)
      : { nodes: [], issues: [] }
  }

  const addNodeGroup = async (group: App.NodeGroup) => {
    const next = normalizeNodeGroup(group)
    validateNodeGroup(next, nodeGroups.value, useSubscribesStore().subscribes)
    nodeGroups.value.push(next)
    try {
      await saveNodeGroups()
    } catch (error) {
      nodeGroups.value.pop()
      throw error
    }
  }

  const editNodeGroup = async (id: string, group: App.NodeGroup) => {
    const index = nodeGroups.value.findIndex((candidate) => candidate.id === id)
    if (index === -1) throw new Error(`${id} Not Found`)
    const next = normalizeNodeGroup(group)
    validateNodeGroup(next, nodeGroups.value, useSubscribesStore().subscribes, id)

    const profilesStore = useProfilesStore()
    const groupsBackup = deepClone(nodeGroups.value)
    const profilesBackup = deepClone(profilesStore.profiles)
    nodeGroups.value.splice(index, 1, next)
    profilesStore.profiles.forEach((profile) => {
      profile.outbounds.forEach((outbound) => {
        outbound.outbounds.forEach((member) => {
          if (member.type === 'NodeGroup' && member.id === id) member.tag = next.name
        })
      })
    })

    try {
      await profilesStore.saveProfiles()
      await saveNodeGroups()
    } catch (error) {
      nodeGroups.value = groupsBackup
      profilesStore.profiles = profilesBackup
      throw error
    }
  }

  const deleteNodeGroup = async (id: string, options: { cascade?: boolean } = {}) => {
    const index = nodeGroups.value.findIndex((candidate) => candidate.id === id)
    if (index === -1) return { dependencies: [], removedReferences: 0 }
    const profilesStore = useProfilesStore()
    const dependencies = getNodeGroupDependencies(id, profilesStore.profiles)
    if (dependencies.length > 0 && !options.cascade) throw new NodeGroupInUseError(dependencies)

    const groupsBackup = deepClone(nodeGroups.value)
    const profilesBackup = deepClone(profilesStore.profiles)
    const removedReferences = removeNodeGroupReferences(id, profilesStore.profiles)
    nodeGroups.value.splice(index, 1)
    try {
      if (removedReferences > 0) await profilesStore.saveProfiles()
      await saveNodeGroups()
    } catch (error) {
      nodeGroups.value = groupsBackup
      profilesStore.profiles = profilesBackup
      throw error
    }
    return { dependencies, removedReferences }
  }

  const addMember = async (groupId: string, member: App.NodeGroupMember) => {
    const group = getNodeGroupById(groupId)
    if (!group) throw new Error(`${groupId} Not Found`)
    const exists = group.members.some(
      (candidate) =>
        candidate.subscription_id === member.subscription_id && candidate.node_id === member.node_id,
    )
    if (exists) return false
    group.mode = 'manual'
    group.members.push(member)
    try {
      await saveNodeGroups()
    } catch (error) {
      group.members.pop()
      throw error
    }
    return true
  }

  return {
    nodeGroups,
    setupNodeGroups,
    saveNodeGroups,
    getNodeGroupById,
    getDependencies,
    resolveGroup,
    addNodeGroup,
    editNodeGroup,
    deleteNodeGroup,
    addMember,
  }
})
