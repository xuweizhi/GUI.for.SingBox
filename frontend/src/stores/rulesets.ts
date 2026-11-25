import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  ReadFile,
  WriteFile,
  CopyFile,
  Download,
  HttpGet,
  FileExists,
  MoveFile,
  RemoveFile,
} from '@/bridge'
import { RulesetHubFilePath, RulesetsFilePath } from '@/constant/app'
import { EmptyRuleSet } from '@/constant/kernel'
import { RulesetFormat } from '@/enums/kernel'
import {
  asyncPool,
  sampleID,
  stringifyNoFolding,
  eventBus,
  ignoredError,
  isValidRulesJson,
  migrateRulesets,
  omitArray,
} from '@/utils'
import {
  persistConfigFiles,
  withConfigMutation,
  parseResourceList,
} from '@/utils/configPersistence'

export const useRulesetsStore = defineStore('rulesets', () => {
  const rulesets = ref<App.RuleSet[]>([])
  const rulesetHub = ref<App.RulesetHub>({ geosite: '', geoip: '', list: [] })

  const setupRulesets = async () => {
    const data = await ignoredError(ReadFile, RulesetsFilePath)
    rulesets.value = parseResourceList(data)

    await migrateRulesets(rulesets.value, saveRulesets)

    const list = await ignoredError(ReadFile, RulesetHubFilePath)
    if (list) {
      try {
        const cached = JSON.parse(list)
        if (Array.isArray(cached?.list)) rulesetHub.value = cached
      } catch (error) {
        console.warn('Invalid ruleset hub cache:', error)
      }
    }
  }

  const writeRulesets = () => {
    const r = omitArray(rulesets.value, ['updating'])
    return WriteFile(RulesetsFilePath, stringifyNoFolding(r))
  }

  const saveRulesets = () => withConfigMutation(writeRulesets)

  const reloadFromDisk = (options: { emitChanges?: boolean } = {}) =>
    withConfigMutation(async () => {
      const parsed = parseResourceList<App.RuleSet>(await ReadFile(RulesetsFilePath))
      if (!Array.isArray(parsed)) throw new Error('Rulesets file must contain an array')
      rulesets.value = parsed
      if (options.emitChanges) eventBus.emit('rulesetsChange', undefined)
    })

  const persistLocalRuleset = async (rule: App.RuleSet, content: string) => {
    if (rule.format !== RulesetFormat.Source) throw new Error('Only source rulesets can be edited')
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
    const index = rulesets.value.findIndex((item) => item.id === rule.id)
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
    const next = [...rulesets.value]
    next.splice(index < 0 ? next.length : index, index < 0 ? 0 : 1, nextRule)
    await persistConfigFiles([
      { path: rule.path, content },
      { path: RulesetsFilePath, content: stringifyNoFolding(omitArray(next, ['updating'])) },
    ])
    rulesets.value = next
    eventBus.emit('rulesetChange', { id: rule.id })
  }

  const saveLocalRuleset = (id: string, content: string) =>
    withConfigMutation(async () => {
      const rule = getRulesetById(id)
      if (!rule) throw new Error(`${id} Not Found`)
      await persistLocalRuleset(rule, content)
    })

  const appendRules = (id: 'direct' | 'reject' | 'proxy', payloads: Recordable[]) =>
    withConfigMutation(async () => {
      if (!payloads.length) return
      const rule = getRulesetById(id) ?? {
        id,
        name: id,
        updateTime: 0,
        type: 'Manual',
        format: RulesetFormat.Source,
        url: '',
        path: `data/rulesets/${id}.json`,
        count: 0,
        disabled: false,
      }
      const data = (await FileExists(rule.path))
        ? JSON.parse(await ReadFile(rule.path))
        : { version: 1, rules: [] }
      if (!Array.isArray(data.rules)) throw new Error('Not a valid ruleset data')
      const first = (data.rules[0] ??= {})
      for (const payload of payloads) {
        for (const key of ['domain', 'ip_cidr', 'process_path', 'domain_suffix']) {
          if (payload[key]) first[key] = [...new Set([first[key] ?? [], payload[key]].flat())]
        }
      }
      await persistLocalRuleset(rule, JSON.stringify(data, null, 2))
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

  const updateRuleset = async (id: string) => {
    const rule = rulesets.value.find((item) => item.id === id)
    if (!rule) throw new Error(id + ' Not Found')
    if (rule.disabled) throw new Error(rule.name + ' Disabled')
    if (rule.updating) throw new Error(rule.name + ' is already updating')
    rule.updating = true
    const snapshot = { ...rule }
    const temp = snapshot.path + '.update-' + sampleID()
    let staged = false
    let source: string | undefined
    try {
      if (snapshot.format === RulesetFormat.Source && snapshot.type === 'Http') {
        const { body } = await HttpGet(snapshot.url)
        source = typeof body === 'string' ? body : JSON.stringify(body)
      } else if (snapshot.format === RulesetFormat.Binary) {
        if (snapshot.type === 'Http') {
          await Download(snapshot.url, temp)
          staged = true
        } else if (snapshot.type === 'File' && snapshot.url !== snapshot.path) {
          await CopyFile(snapshot.url, temp)
          staged = true
        }
      }
      await withConfigMutation(async () => {
        const current = rulesets.value.find((item) => item.id === id)
        if (
          current !== rule ||
          current.disabled ||
          current.type !== snapshot.type ||
          current.path !== snapshot.path ||
          current.url !== snapshot.url ||
          current.format !== snapshot.format
        ) {
          throw new Error('Ruleset changed during update')
        }
        let count = rule.count
        const files: { path: string; content: string }[] = []
        if (rule.format === RulesetFormat.Source) {
          let write = rule.type !== 'Manual' && rule.url !== rule.path
          if (rule.type === 'File') source = await ReadFile(rule.url)
          if (rule.type === 'Manual') {
            write = !(await FileExists(rule.path))
            source = write ? JSON.stringify(EmptyRuleSet) : await ReadFile(rule.path)
          }
          if (!source || !isValidRulesJson(source)) throw new Error('Not a valid ruleset data')
          const data = JSON.parse(source)
          count = data.rules.reduce(
            (total: number, item: Record<string, unknown>) =>
              total +
              Object.values(item).reduce<number>(
                (n, v) => n + (Array.isArray(v) ? v.length : 1),
                0,
              ),
            0,
          )
          if (write) files.push({ path: rule.path, content: JSON.stringify(data, null, 2) })
        }
        const updateTime = Date.now()
        const next = rulesets.value.map((item) =>
          item === rule ? { ...item, count, updateTime } : item,
        )
        files.push({
          path: RulesetsFilePath,
          content: stringifyNoFolding(omitArray(next, ['updating'])),
        })
        const backup = temp + '.bak'
        const hadFile = staged && (await FileExists(rule.path))
        if (hadFile) await MoveFile(rule.path, backup)
        try {
          if (staged) await MoveFile(temp, rule.path)
          await persistConfigFiles(files)
        } catch (error) {
          if (staged) {
            if (hadFile) await MoveFile(backup, rule.path)
            else await RemoveFile(rule.path).catch(() => undefined)
          }
          throw error
        }
        if (hadFile) await RemoveFile(backup).catch(console.warn)
        Object.assign(rule, { count, updateTime })
        eventBus.emit('rulesetChange', { id })
      })
      return `Ruleset [${rule.name}] updated successfully.`
    } finally {
      rule.updating = false
      const current = getRulesetById(id)
      if (current) current.updating = false
      if (staged) await RemoveFile(temp).catch(() => undefined)
    }
  }

  const updateRulesets = async () => {
    const result = await asyncPool(
      5,
      rulesets.value.filter((item) => !item.disabled),
      async ({ id, name }) => {
        try {
          return { ok: true, id, name, result: await updateRuleset(id) }
        } catch (error) {
          return {
            ok: false,
            id,
            name,
            result: `Failed to update rule-set [${name}]. Reason: ${error}`,
          }
        }
      },
    )
    return result.flatMap((item) => (item.ok && item.value ? [item.value] : []))
  }

  const rulesetHubLoading = ref(false)
  const updateRulesetHub = async () => {
    rulesetHubLoading.value = true
    try {
      const { body } = await HttpGet<string>(
        'https://github.com/GUI-for-Cores/Ruleset-Hub/releases/download/latest/sing-full.json',
      )
      const next = typeof body === 'string' ? JSON.parse(body) : body
      if (!Array.isArray(next?.list)) throw new Error('Invalid ruleset hub')
      await WriteFile(RulesetHubFilePath, JSON.stringify(next))
      rulesetHub.value = next
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
    appendRules,
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
