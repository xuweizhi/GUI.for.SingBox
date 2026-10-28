import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFile, writeFile } = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/bridge', () => ({
  FileExists: vi.fn().mockResolvedValue(false),
  RemoveFile: vi.fn().mockResolvedValue(undefined),
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
import { useSubscribesStore } from '@/stores/subscribes'

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
    await expect(
      store.addNodeGroup(
        createGroup({ id: 'invalid-field', match_field: 'server' as App.NodeGroupMatchField }),
      ),
    ).rejects.toThrow('match_field')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('loads existing groups without a match field using the original combined behavior', async () => {
    readFile.mockResolvedValue(
      JSON.stringify([{ id: 'legacy', name: 'Legacy', mode: 'filter', include: 'HK' }]),
    )
    const store = useNodeGroupsStore()
    useSubscribesStore().subscribes = [
      {
        id: 'provider',
        name: 'HK Provider',
        disabled: false,
        proxies: [{ id: 'jp', tag: 'JP 01', type: 'trojan' }],
      },
    ] as App.Subscription[]

    await store.setupNodeGroups()

    expect(store.nodeGroups[0]!.match_field).toBe('all')
    expect(store.resolveGroup('legacy').nodes.map((node) => node.proxy.id)).toEqual(['jp'])
  })

  it('persists the selected field through create, edit and reload without widening the filter', async () => {
    const subscriptions = [
      {
        id: 'provider',
        name: 'HK Provider',
        disabled: false,
        proxies: [
          { id: 'hk', tag: 'HK 01', type: 'vless' },
          { id: 'jp', tag: 'JP 01', type: 'trojan' },
        ],
      },
    ] as App.Subscription[]
    useSubscribesStore().subscribes = subscriptions
    const store = useNodeGroupsStore()
    await store.addNodeGroup(
      createGroup({ mode: 'filter', match_field: 'protocol', include: '^trojan$' }),
    )
    expect(store.resolveGroup('group-hk').nodes.map((node) => node.proxy.id)).toEqual(['jp'])

    await store.editNodeGroup(
      'group-hk',
      createGroup({ mode: 'filter', match_field: 'name', include: '^HK' }),
    )
    const saved = writeFile.mock.calls.findLast(([path]) => path === NodeGroupsFilePath)![1]
    readFile.mockResolvedValue(saved)
    setActivePinia(createPinia())
    useSubscribesStore().subscribes = subscriptions
    const reloaded = useNodeGroupsStore()
    await reloaded.setupNodeGroups()

    expect(reloaded.nodeGroups[0]!.match_field).toBe('name')
    expect(reloaded.resolveGroup('group-hk').nodes.map((node) => node.proxy.id)).toEqual(['hk'])
  })

  it('propagates renames to profile display snapshots', async () => {
    const profilesStore = useProfilesStore()
    profilesStore.profiles.push(profileWithGroup())
    const store = useNodeGroupsStore()
    store.nodeGroups.push(createGroup({ name: 'Old Hong Kong' }))

    await store.editNodeGroup('group-hk', createGroup({ name: 'Hong Kong Premium' }))

    expect(profilesStore.profiles[0]!.outbounds[0]!.outbounds[0]!.tag).toBe('Hong Kong Premium')
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
