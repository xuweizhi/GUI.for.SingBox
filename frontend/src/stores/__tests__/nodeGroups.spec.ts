import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFile, writeFile } = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/bridge', () => ({
  ReadFile: readFile,
  WriteFile: writeFile,
}))

vi.mock('@/stores/appSettings', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { profile: '' } } }),
}))

import { NodeGroupsFilePath, ProfilesFilePath } from '@/constant/app'
import { DefaultNodeGroup } from '@/constant/nodeGroup'
import { useNodeGroupsStore, NodeGroupInUseError } from '@/stores/nodeGroups'
import { useProfilesStore } from '@/stores/profiles'

const profileWithGroup = () =>
  ({
    id: 'profile-a',
    name: 'Default',
    outbounds: [
      {
        id: 'strategy-a',
        tag: 'Auto HK',
        outbounds: [{ id: 'group-hk', tag: 'Old Hong Kong', type: 'NodeGroup' }],
      },
    ],
  }) as App.Profile

const createGroup = (overrides: Partial<App.NodeGroup> = {}): App.NodeGroup => ({
  ...DefaultNodeGroup(),
  id: 'group-hk',
  name: 'Hong Kong',
  ...overrides,
})

describe('node-groups store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    readFile.mockReset()
    writeFile.mockReset()
    writeFile.mockResolvedValue(undefined)
  })

  it('treats a missing data file as an empty node-group list', async () => {
    readFile.mockRejectedValue(new Error('missing'))
    const store = useNodeGroupsStore()

    await store.setupNodeGroups()

    expect(store.nodeGroups).toEqual([])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('validates filters and IDs before persisting', async () => {
    const store = useNodeGroupsStore()
    store.nodeGroups.push(createGroup())

    await expect(store.addNodeGroup(createGroup())).rejects.toThrow('duplicate')
    await expect(
      store.addNodeGroup(createGroup({ id: 'invalid', mode: 'filter', include: '[' })),
    ).rejects.toThrow('include')
    await expect(
      store.addNodeGroup(createGroup({ id: 'negative', max_nodes: -1 })),
    ).rejects.toThrow('max_nodes')
  })

  it('propagates renames to profile display snapshots', async () => {
    const profilesStore = useProfilesStore()
    profilesStore.profiles.push(profileWithGroup())
    const store = useNodeGroupsStore()
    store.nodeGroups.push(createGroup({ name: 'Old Hong Kong' }))

    await store.editNodeGroup('group-hk', createGroup({ name: 'Hong Kong Premium' }))

    expect(profilesStore.profiles[0]!.outbounds[0]!.outbounds[0]!.tag).toBe(
      'Hong Kong Premium',
    )
    expect(writeFile).toHaveBeenCalledWith(ProfilesFilePath, expect.any(String))
    expect(writeFile).toHaveBeenCalledWith(NodeGroupsFilePath, expect.any(String))
  })

  it('blocks referenced deletion and cascades only when explicitly requested', async () => {
    const profilesStore = useProfilesStore()
    profilesStore.profiles.push(profileWithGroup())
    const store = useNodeGroupsStore()
    store.nodeGroups.push(createGroup())

    await expect(store.deleteNodeGroup('group-hk')).rejects.toBeInstanceOf(NodeGroupInUseError)
    expect(store.nodeGroups).toHaveLength(1)
    expect(profilesStore.profiles[0]!.outbounds[0]!.outbounds).toHaveLength(1)

    const result = await store.deleteNodeGroup('group-hk', { cascade: true })

    expect(result.removedReferences).toBe(1)
    expect(store.nodeGroups).toEqual([])
    expect(profilesStore.profiles[0]!.outbounds[0]!.outbounds).toEqual([])
  })
})
