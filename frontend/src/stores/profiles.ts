import sha256 from 'crypto-js/sha256'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { parse } from 'yaml'

import { FileExists, ReadFile, WriteFile } from '@/bridge'
import { ProfilesFilePath } from '@/constant/app'
import { DefaultOutboundIds } from '@/constant/outbound'
import * as Defaults from '@/constant/profile'
import { eventBus, stringifyNoFolding, migrateProfiles, sampleID } from '@/utils'
import { withConfigMutation } from '@/utils/configPersistence'

import { useAppSettingsStore } from './appSettings'

export const useProfilesStore = defineStore('profiles', () => {
  const appSettingsStore = useAppSettingsStore()

  const profiles = ref<App.Profile[]>([])
  const currentProfile = computed(() => getProfileById(appSettingsStore.app.kernel.profile))

  let revision = 'missing'

  const setupProfiles = async () => {
    const data = (await FileExists(ProfilesFilePath)) ? await ReadFile(ProfilesFilePath) : undefined
    profiles.value = data ? parse(data) : []
    revision = data === undefined ? 'missing' : sha256(data).toString()
    await migrateProfiles(profiles.value, saveProfiles)
  }

  // The server compares the loaded revision and commits related metadata under the same lock.
  const writeProfiles = async (
    next: App.Profile[],
    related?: { path: string; content: string }[],
  ) => {
    const content = stringifyNoFolding(next)
    const result = await WriteFile(ProfilesFilePath, content, {
      ExpectedSHA256: revision,
      Related: related,
    })
    revision = sha256(content).toString()
    return result
  }

  const saveProfiles = () => withConfigMutation(() => writeProfiles(profiles.value))

  const reloadFromDisk = (options: { emitChanges?: boolean } = {}) =>
    withConfigMutation(async () => {
      const content = await ReadFile(ProfilesFilePath)
      const parsed = parse(content)
      if (!Array.isArray(parsed)) throw new Error('Profiles file must contain an array')
      const changed = new Set([...profiles.value, ...parsed].map((profile) => profile.id))
      profiles.value = parsed
      revision = sha256(content).toString()
      if (options.emitChanges) changed.forEach((id) => eventBus.emit('profileChange', { id }))
    })

  const addProfile = (p: App.Profile) =>
    withConfigMutation(async () => {
      const next = [...profiles.value, p]
      await writeProfiles(next)
      profiles.value.push(p)
    })

  const deleteProfile = (id: string) =>
    withConfigMutation(async () => {
      const idx = profiles.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const next = profiles.value.filter((v) => v.id !== id)
      await writeProfiles(next)
      profiles.value.splice(idx, 1)
      eventBus.emit('profileChange', { id })
    })

  const editProfile = (id: string, p: App.Profile) =>
    withConfigMutation(async () => {
      const idx = profiles.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const next = profiles.value.map((profile, index) => (index === idx ? p : profile))
      await writeProfiles(next)
      profiles.value.splice(idx, 1, p)
      eventBus.emit('profileChange', { id })
    })

  const getProfileById = (id: string) => profiles.value.find((v) => v.id === id)

  const getProfileTemplate = (name = ''): App.Profile => {
    return {
      id: sampleID(),
      name: name,
      primary_proxy_outbound: DefaultOutboundIds.Select,
      log: Defaults.DefaultLog(),
      experimental: Defaults.DefaultExperimental(),
      inbounds: Defaults.DefaultInbounds(),
      outbounds: Defaults.DefaultOutbounds(),
      route: Defaults.DefaultRoute(),
      dns: Defaults.DefaultDns(),
      mixin: Defaults.DefaultMixin(),
      script: Defaults.DefaultScript(),
    }
  }

  return {
    profiles,
    currentProfile,
    setupProfiles,
    reloadFromDisk,
    saveProfiles,
    writeProfiles,
    addProfile,
    editProfile,
    deleteProfile,
    getProfileById,
    getProfileTemplate,
  }
})
