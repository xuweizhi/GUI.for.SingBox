import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({ ReadFile: vi.fn(), WriteFile: vi.fn() }))
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { branch: 'main' } } }),
  usePluginsStore: () => ({ onGenerateTrigger: async (config: unknown) => config }),
  useProfilesStore: () => ({ getProfileTemplate: () => template() }),
  useNodeGroupsStore: () => ({ nodeGroups: [], getNodeGroupById: () => undefined }),
  useRulesetsStore: () => ({ rulesets: [], getRulesetById: () => undefined }),
  useSubscribesStore: () => ({ subscribes: [], getSubscribeById: () => undefined }),
}))

import * as Defaults from '@/constant/profile'
import { generateConfig } from '@/utils/generator'
import { restoreProfile } from '@/utils/restorer'

const template = (): App.Profile => ({
  id: 'roundtrip',
  name: 'Round trip',
  log: Defaults.DefaultLog(),
  experimental: Defaults.DefaultExperimental(),
  inbounds: [],
  outbounds: Defaults.DefaultOutbounds(),
  route: Defaults.DefaultRoute(),
  dns: Defaults.DefaultDns(),
  mixin: Defaults.DefaultMixin(),
  script: Defaults.DefaultScript(),
})

const binaries = (process.env.SING_BOX_TEST_BINARIES || '').split(delimiter).filter(Boolean)

describe.skipIf(binaries.length === 0)('review regressions against installed cores', () => {
  it('round-trips extra match conditions, implicit route targets and a native local ruleset', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gui-review-core-'))
    try {
      const rulesetPath = join(directory, 'rules.json')
      writeFileSync(
        rulesetPath,
        JSON.stringify({ version: 3, rules: [{ domain: ['local.test'] }] }),
      )
      const raw = {
        inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 10800 }],
        outbounds: [{ type: 'direct', tag: 'direct' }],
        dns: {
          servers: [{ type: 'local', tag: 'local' }],
          final: 'local',
          rules: [
            { domain: ['example.com'], query_type: ['AAAA'], server: 'local' },
            { domain: ['example.org'], server: 'local', disable_cache: true },
          ],
        },
        route: {
          final: 'direct',
          default_domain_resolver: 'local',
          rule_set: [{ type: 'local', tag: 'custom', format: 'source', path: rulesetPath }],
          rules: [
            { domain: ['example.com'], auth_user: ['alice'], outbound: 'direct' },
            { rule_set: ['custom'], outbound: 'direct' },
          ],
        },
      }
      const profile = restoreProfile(raw)
      const options = {
        enableStableConfigCompat: false,
        enablePluginProcessing: false,
        enableMixinProcessing: false,
        enableScriptProcessing: false,
      }
      const baseline = await generateConfig(profile, options)
      // Also exercise the existing-profile raw editor path, which reuses native nodes.
      const regenerated = await generateConfig(
        restoreProfile(raw, 'Round trip', { profile, baseline }),
        options,
      )
      expect(regenerated.dns.rules[0]).toMatchObject(raw.dns.rules[0]!)
      expect(regenerated.dns.rules[1]).toMatchObject({ server: 'local', disable_cache: true })
      expect(regenerated.route.rules[0]).toMatchObject(raw.route.rules[0]!)
      expect(regenerated.route.rules[1]).toMatchObject({ outbound: 'direct' })
      expect(regenerated.route.rule_set[0].path).toBe(rulesetPath)
      for (const [name, config] of Object.entries({
        original: raw,
        restored: baseline,
        regenerated,
      })) {
        const path = join(directory, `${name}.json`)
        writeFileSync(path, JSON.stringify(config))
        for (const binary of binaries) {
          try {
            execFileSync(binary, ['check', '--disable-color', '-c', path, '-D', directory], {
              timeout: 30_000,
              stdio: ['ignore', 'pipe', 'pipe'],
            })
          } catch (error: any) {
            throw new Error(`${binary} (${name}): ${String(error.stderr || error.message)}`)
          }
        }
      }
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
