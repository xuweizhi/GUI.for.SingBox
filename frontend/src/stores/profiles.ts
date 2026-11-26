import sha256 from 'crypto-js/sha256'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { FileExists, ReadFile, WriteFile } from '@/bridge'
import { ProfilesFilePath } from '@/constant/app'
import { DefaultOutboundIds } from '@/constant/outbound'
import * as Defaults from '@/constant/profile'
import { RuleAction, RuleType } from '@/enums/kernel'
import {
  applyDnsPreset,
  applyProfilePreset,
  deepClone,
  ensureNodeGroupOutlet,
  eventBus,
  migrateProfiles,
  normalizeQuickRules,
  sampleID,
  stringifyNoFolding,
  type NodeGroupOutletBehavior,
} from '@/utils'
import { withConfigMutation, parseResourceList } from '@/utils/configPersistence'

import { useAppSettingsStore } from './appSettings'

export const useProfilesStore = defineStore('profiles', () => {
  const appSettingsStore = useAppSettingsStore()

  const profiles = ref<App.Profile[]>([])
  const currentProfile = computed(() => getProfileById(appSettingsStore.app.kernel.profile))

  let revision = 'missing'

  const setupProfiles = async () => {
    const data = (await FileExists(ProfilesFilePath)) ? await ReadFile(ProfilesFilePath) : undefined
    profiles.value = parseResourceList(data)
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
      const parsed = parseResourceList<App.Profile>(content)
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

  const getProfileTemplate = (name = '', preset?: App.ProfilePreset): App.Profile => {
    const profile: App.Profile = {
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
    if (preset) {
      applyProfilePreset(profile, preset)
      applyDnsPreset(profile, 'smart')
    }
    return profile
  }

  const addQuickRuleToProfile = (
    profileId: string,
    bucket: keyof App.QuickRuleLists,
    entries: string[],
  ) =>
    withConfigMutation(async () => {
      const idx = profiles.value.findIndex((item) => item.id === profileId)
      if (idx === -1) throw new Error(`Profile not found: ${profileId}`)
      const cleaned = [...new Set(entries.map((item) => item.trim()).filter(Boolean))]
      if (!cleaned.length) return 0
      const updated = deepClone(profiles.value[idx]!)
      const quick = normalizeQuickRules(updated.route.quick_rules)
      for (const other of ['direct', 'proxy', 'block'] as const) {
        if (other !== bucket) {
          quick[other] = quick[other].filter((entry) => !cleaned.includes(entry))
        }
      }
      let added = 0
      for (const entry of cleaned) {
        if (!quick[bucket].includes(entry)) {
          quick[bucket].push(entry)
          added += 1
        }
      }
      updated.route.quick_rules = quick
      const next = profiles.value.map((profile, index) => (index === idx ? updated : profile))
      await writeProfiles(next)
      profiles.value.splice(idx, 1, updated)
      eventBus.emit('profileChange', { id: profileId })
      return added
    })

  const addNodeGroupRuleToProfile = (
    profileId: string,
    payloads: Record<string, any>[],
    group: Pick<App.NodeGroup, 'id' | 'name'>,
    behavior: NodeGroupOutletBehavior,
    behaviorLabel: string,
  ) =>
    withConfigMutation(async () => {
      const idx = profiles.value.findIndex((item) => item.id === profileId)
      if (idx === -1) throw new Error(`Profile not found: ${profileId}`)
      const updated = deepClone(profiles.value[idx]!)
      const outlet = ensureNodeGroupOutlet(updated.outbounds, group, behavior, behaviorLabel, {
        role: 'outlet',
      })
      const insertIdx = updated.route.rules.findIndex(
        (rule) => rule.type === RuleType.InsertionPoint,
      )
      const created: App.Rule[] = []
      const fieldToRuleType: Array<[string, RuleType]> = [
        ['domain', RuleType.Domain],
        ['domain_suffix', RuleType.DomainSuffix],
        ['ip_cidr', RuleType.IPCidr],
        ['process_path', RuleType.ProcessPath],
      ]
      for (const payload of payloads) {
        for (const [key, ruleType] of fieldToRuleType) {
          const val = typeof payload[key] === 'string' ? payload[key].trim() : ''
          if (!val) continue
          const exists = updated.route.rules.some(
            (rule) =>
              rule.enable &&
              rule.type === ruleType &&
              rule.action === RuleAction.Route &&
              rule.payload === val &&
              rule.outbound === outlet.id,
          )
          if (exists) continue
          created.push({
            ...Defaults.DefaultRouteRule(),
            type: ruleType,
            payload: val,
            action: RuleAction.Route,
            outbound: outlet.id,
          })
        }
      }
      if (!created.length) return 0
      if (insertIdx !== -1) {
        updated.route.rules.splice(insertIdx + 1, 0, ...created)
      } else {
        const preambleEnd = updated.route.rules.findIndex(
          (rule) =>
            rule.action !== RuleAction.Sniff &&
            rule.action !== RuleAction.HijackDNS &&
            rule.type !== RuleType.ClashMode,
        )
        const targetIdx = preambleEnd === -1 ? updated.route.rules.length : preambleEnd
        updated.route.rules.splice(targetIdx, 0, ...created)
      }
      const next = profiles.value.map((profile, index) => (index === idx ? updated : profile))
      await writeProfiles(next)
      profiles.value.splice(idx, 1, updated)
      eventBus.emit('profileChange', { id: profileId })
      return created.length
    })

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
    addQuickRuleToProfile,
    addNodeGroupRuleToProfile,
  }
})
