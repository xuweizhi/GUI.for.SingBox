import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { parse } from 'yaml'

import { ReadFile, WriteFile } from '@/bridge'
import { ProfilesFilePath } from '@/constant/app'
import { DefaultOutboundIds } from '@/constant/outbound'
import * as Defaults from '@/constant/profile'
import { ignoredError, eventBus, stringifyNoFolding, migrateProfiles, sampleID } from '@/utils'
import { withConfigMutation } from '@/utils/configPersistence'

import { useAppSettingsStore } from './appSettings'

export const useProfilesStore = defineStore('profiles', () => {
  const appSettingsStore = useAppSettingsStore()

  const profiles = ref<App.Profile[]>([])
  const currentProfile = computed(() => getProfileById(appSettingsStore.app.kernel.profile))

  const setupProfiles = async () => {
    const data = await ignoredError(ReadFile, ProfilesFilePath)
    data && (profiles.value = parse(data))

    await migrateProfiles(profiles.value, saveProfiles)
  }

  const saveProfiles = () =>
    withConfigMutation(() => WriteFile(ProfilesFilePath, stringifyNoFolding(profiles.value)))

  const reloadFromDisk = (options: { emitChanges?: boolean } = {}) =>
    withConfigMutation(async () => {
      const parsed = parse(await ReadFile(ProfilesFilePath))
      if (!Array.isArray(parsed)) throw new Error('Profiles file must contain an array')
      const changed = new Set([...profiles.value, ...parsed].map((profile) => profile.id))
      profiles.value = parsed
      if (options.emitChanges) changed.forEach((id) => eventBus.emit('profileChange', { id }))
    })

  const addProfile = (p: App.Profile) =>
    withConfigMutation(async () => {
      const next = [...profiles.value, p]
      await WriteFile(ProfilesFilePath, stringifyNoFolding(next))
      profiles.value.push(p)
    })

  const deleteProfile = (id: string) =>
    withConfigMutation(async () => {
      const idx = profiles.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const next = profiles.value.filter((v) => v.id !== id)
      await WriteFile(ProfilesFilePath, stringifyNoFolding(next))
      profiles.value.splice(idx, 1)
      eventBus.emit('profileChange', { id })
    })

  const editProfile = (id: string, p: App.Profile) =>
    withConfigMutation(async () => {
      const idx = profiles.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const next = profiles.value.map((profile, index) => (index === idx ? p : profile))
      await WriteFile(ProfilesFilePath, stringifyNoFolding(next))
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
    addProfile,
    editProfile,
    deleteProfile,
    getProfileById,
    getProfileTemplate,
  }
})
