import { defineStore } from 'pinia'
import { ref } from 'vue'
import { parse } from 'yaml'

import { ReadFile, WriteFile, CopyFile, Download, HttpGet } from '@/bridge'
import { RulesetHubFilePath, RulesetsFilePath } from '@/constant/app'
import { EmptyRuleSet } from '@/constant/kernel'
import { RulesetFormat } from '@/enums/kernel'
import {
  asyncPool,
  stringifyNoFolding,
  eventBus,
  ignoredError,
  isValidRulesJson,
  migrateRulesets,
  omitArray,
} from '@/utils'
import { persistConfigFiles, withConfigMutation } from '@/utils/configPersistence'

export const useRulesetsStore = defineStore('rulesets', () => {
  const rulesets = ref<App.RuleSet[]>([])
  const rulesetHub = ref<App.RulesetHub>({ geosite: '', geoip: '', list: [] })

  const setupRulesets = async () => {
    const data = await ignoredError(ReadFile, RulesetsFilePath)
    data && (rulesets.value = parse(data))

    await migrateRulesets(rulesets.value, saveRulesets)

    const list = await ignoredError(ReadFile, RulesetHubFilePath)
    list && (rulesetHub.value = JSON.parse(list))
  }

  const writeRulesets = () => {
    const r = omitArray(rulesets.value, ['updating'])
    return WriteFile(RulesetsFilePath, stringifyNoFolding(r))
  }

  const saveRulesets = () => withConfigMutation(writeRulesets)

  const reloadFromDisk = (options: { emitChanges?: boolean } = {}) =>
    withConfigMutation(async () => {
      const parsed = parse(await ReadFile(RulesetsFilePath))
      if (!Array.isArray(parsed)) throw new Error('Rulesets file must contain an array')
      rulesets.value = parsed
      if (options.emitChanges) eventBus.emit('rulesetsChange', undefined)
    })

  const saveLocalRuleset = (id: string, content: string) =>
    withConfigMutation(async () => {
      const index = rulesets.value.findIndex((rule) => rule.id === id)
      const rule = rulesets.value[index]
      if (!rule) throw new Error(`${id} Not Found`)
      if (rule.format !== RulesetFormat.Source)
        throw new Error('Only source rulesets can be edited')
      let data: { version: number; rules: Record<string, unknown>[] }
      try {
        data = JSON.parse(content)
      } catch {
        throw new Error('Not a valid ruleset data')
      }
      if (
        !data ||
        !Number.isInteger(data.version) ||
        data.version < 1 ||
        !Array.isArray(data.rules) ||
        data.rules.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
      ) {
        throw new Error('Not a valid ruleset data')
      }
      const count = data.rules.reduce(
        (sum, item) =>
          sum +
          Object.values(item).reduce<number>(
            (total, value) => total + (Array.isArray(value) ? value.length : 1),
            0,
          ),
        0,
      )
      const nextRule = { ...rule, count, updateTime: Date.now() }
      const next = rulesets.value.map((item, i) => (i === index ? nextRule : item))
      await persistConfigFiles([
        { path: rule.path, content },
        { path: RulesetsFilePath, content: stringifyNoFolding(omitArray(next, ['updating'])) },
      ])
      rulesets.value.splice(index, 1, nextRule)
      eventBus.emit('rulesetChange', { id })
    })

  const addRuleset = (r: App.RuleSet) =>
    withConfigMutation(async () => {
      rulesets.value.push(r)
      try {
        await writeRulesets()
      } catch (error) {
        const idx = rulesets.value.indexOf(r)
        if (idx !== -1) {
          rulesets.value.splice(idx, 1)
        }
        throw error
      }
    })

  const deleteRuleset = (id: string) =>
    withConfigMutation(async () => {
      const idx = rulesets.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const backup = rulesets.value.splice(idx, 1)[0]!
      try {
        await writeRulesets()
      } catch (error) {
        rulesets.value.splice(idx, 0, backup)
        throw error
      }

      eventBus.emit('rulesetChange', { id })
    })

  const editRuleset = (id: string, r: App.RuleSet) =>
    withConfigMutation(async () => {
      const idx = rulesets.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const backup = rulesets.value.splice(idx, 1, r)[0]!
      try {
        await writeRulesets()
      } catch (error) {
        rulesets.value.splice(idx, 1, backup)
        throw error
      }

      eventBus.emit('rulesetChange', { id })
    })

  const _doUpdateRuleset = async (r: App.RuleSet) => {
    if (r.format === RulesetFormat.Source) {
      let body = ''
      let isExist = true

      if (r.type === 'File') {
        body = await ReadFile(r.url)
      } else if (r.type === 'Http') {
        const { body: b } = await HttpGet(r.url)
        body = b
        if (typeof body !== 'string') {
          body = JSON.stringify(body)
        }
      } else if (r.type === 'Manual') {
        body = await ReadFile(r.path).catch(() => '')
        if (!body) {
          body = JSON.stringify(EmptyRuleSet)
          isExist = false
        }
      }

      if (!isValidRulesJson(body)) {
        throw 'Not a valid ruleset data'
      }

      const ruleset = JSON.parse(body)

      r.count = ruleset.rules.reduce(
        (p: number, c: string[]) =>
          Object.values(c).reduce(
            (p, c: string[] | string) => (Array.isArray(c) ? p + c.length : p + 1),
            0,
          ) + p,
        0,
      )

      if (
        (['Http', 'File'].includes(r.type) && r.url !== r.path) ||
        (r.type === 'Manual' && !isExist)
      ) {
        await WriteFile(r.path, JSON.stringify(ruleset, null, 2))
      }
    }

    if (r.format === RulesetFormat.Binary) {
      if (r.type === 'File' && r.url !== r.path) {
        await CopyFile(r.url, r.path)
      } else if (r.type === 'Http') {
        await Download(r.url, r.path)
      }
    }

    r.updateTime = Date.now()
  }

  const updateRuleset = (id: string) =>
    withConfigMutation(async () => {
      const r = rulesets.value.find((v) => v.id === id)
      if (!r) throw id + ' Not Found'
      if (r.disabled) throw r.name + ' Disabled'
      try {
        r.updating = true
        await _doUpdateRuleset(r)
        await writeRulesets()
      } finally {
        r.updating = false
      }

      eventBus.emit('rulesetChange', { id })

      return `Ruleset [${r.name}] updated successfully.`
    })

  const updateRulesets = () =>
    withConfigMutation(async () => {
      let needSave = false

      const update = async (r: App.RuleSet) => {
        const result = { ok: true, id: r.id, name: r.name, result: '' }
        try {
          r.updating = true
          await _doUpdateRuleset(r)
          needSave = true
          result.result = `Rule-Set [${r.name}] updated successfully.`
        } catch (error: any) {
          result.ok = false
          result.result = `Failed to update rule-set [${r.name}]. Reason: ${error.message || error}`
        } finally {
          r.updating = false
        }
        return result
      }

      const result = await asyncPool(
        5,
        rulesets.value.filter((v) => !v.disabled),
        update,
      )

      if (needSave) await writeRulesets()

      eventBus.emit('rulesetsChange', undefined)

      return result.flatMap((v) => (v.ok && v.value) || [])
    })

  const rulesetHubLoading = ref(false)
  const updateRulesetHub = async () => {
    rulesetHubLoading.value = true
    try {
      const { body } = await HttpGet<string>(
        'https://github.com/GUI-for-Cores/Ruleset-Hub/releases/download/latest/sing-full.json',
      )
      rulesetHub.value = JSON.parse(body)
      await WriteFile(RulesetHubFilePath, body)
    } finally {
      rulesetHubLoading.value = false
    }
  }

  const getRulesetById = (id: string) => rulesets.value.find((v) => v.id === id)

  return {
    rulesets,
    setupRulesets,
    saveRulesets,
    saveLocalRuleset,
    reloadFromDisk,
    addRuleset,
    editRuleset,
    deleteRuleset,
    updateRuleset,
    updateRulesets,
    getRulesetById,

    rulesetHub,
    rulesetHubLoading,
    updateRulesetHub,
  }
})
