import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failPath: '',
  emit: vi.fn(),
  http: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/bridge', () => ({
  FileExists: vi.fn(async (path: string) => mocks.files.has(path)),
  ReadFile: vi.fn(async (path: string) => {
    if (!mocks.files.has(path)) throw new Error('missing')
    return mocks.files.get(path)!
  }),
  WriteFile: vi.fn(async (path: string, content: string) => {
    if (mocks.failPath === path) {
      mocks.failPath = ''
      throw new Error('disk full')
    }
    mocks.files.set(path, content)
  }),
  RemoveFile: vi.fn(async (path: string) => mocks.files.delete(path)),
  CopyFile: vi.fn(),
  Download: vi.fn(),
  HttpGet: mocks.http,
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/utils', async () => ({
  deepClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
  ignoredError: async (fn: (...args: any[]) => any, ...args: any[]) => {
    try {
      return await fn(...args)
    } catch {
      return undefined
    }
  },
  message: { error: mocks.error },
  asyncPool: vi.fn(),
  stringifyNoFolding: JSON.stringify,
  eventBus: { emit: mocks.emit },
  isValidRulesJson: vi.fn(),
  migrateRulesets: vi.fn(),
  omitArray: (items: any[], keys: string[]) =>
    items.map((item) =>
      Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key))),
    ),
}))
vi.mock('@/stores', async () => ({
  useRulesetsStore: (await import('@/stores/rulesets')).useRulesetsStore,
}))
import { RulesetsFilePath } from '@/constant/app'
import { useRulesetsStore } from '@/stores/rulesets'
import RulesetView from '@/views/RulesetsView/components/RulesetView.vue'

const path = 'data/rulesets/test.json'
const original = JSON.stringify({ version: 4, rules: [{ domain: ['old.example'] }] })
const edited = JSON.stringify({
  version: 4,
  rules: [{ domain: ['new.example', 'second.example'] }],
})
const makeRule = (type: 'Http' | 'File' = 'Http'): App.RuleSet => ({
  id: 'rules',
  name: 'Rules',
  type,
  format: 'source',
  path,
  url: 'https://example.invalid/rules.json',
  disabled: false,
  count: 1,
  updateTime: 0,
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.failPath = ''
  mocks.files.clear()
  mocks.files.set(path, original)
  mocks.files.set(RulesetsFilePath, JSON.stringify([makeRule()]))
})

it.each(['Http', 'File'] as const)(
  'saves %s source edits without downloading over them',
  async (type) => {
    const store = useRulesetsStore()
    store.rulesets.push(makeRule(type))
    const submit = vi.fn()
    const wrapper = mount(RulesetView, {
      props: { id: 'rules' },
      global: {
        provide: { cancel: vi.fn(), submit },
        stubs: {
          CodeEditor: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
    await flushPromises()
    await wrapper.get('textarea').setValue(edited)
    await (wrapper.vm as any).modalSlots.submit().props.onClick()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.files.get(path)).toBe(edited)
    expect(store.rulesets[0]?.count).toBe(2)
    expect(parse(mocks.files.get(RulesetsFilePath)!)[0].count).toBe(2)
    expect(mocks.http).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledOnce()
    expect(mocks.emit).toHaveBeenCalledWith('rulesetChange', { id: 'rules' })
    wrapper.unmount()
  },
)

it('rolls source and metadata back when persisting metadata fails', async () => {
  const store = useRulesetsStore()
  store.rulesets.push(makeRule())
  mocks.failPath = RulesetsFilePath
  await expect(store.saveLocalRuleset('rules', edited)).rejects.toThrow('disk full')
  expect(mocks.files.get(path)).toBe(original)
  expect(parse(mocks.files.get(RulesetsFilePath)!)[0].count).toBe(1)
  expect(store.rulesets[0]?.count).toBe(1)
  expect(store.rulesets[0]?.updateTime).toBe(0)
  expect(mocks.emit).not.toHaveBeenCalled()
})

it.each(['{}', '{"rules":{}}', '{"version":4,"rules":[null]}', 'broken'])(
  'rejects malformed ruleset content %s before writing',
  async (content) => {
    const store = useRulesetsStore()
    store.rulesets.push(makeRule())
    await expect(store.saveLocalRuleset('rules', content)).rejects.toThrow(
      'Not a valid ruleset data',
    )
    expect(mocks.files.get(path)).toBe(original)
    expect(mocks.emit).not.toHaveBeenCalled()
  },
)
