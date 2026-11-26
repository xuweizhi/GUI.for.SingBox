import { DefaultRouteRule, DefaultRouteRuleset } from '@/constant/profile'
import { RulesetType, RuleType } from '@/enums/kernel'
import { useProfilesStore } from '@/stores'
import { deepClone, message, picker } from '@/utils'

export type AddRulesetToProfileInput =
  | {
      kind: 'local'
      id: string
      name: string
      format: App.RuleSet['format']
    }
  | {
      kind: 'remote'
      url: string
      tag: string
      format: App.RuleSet['format']
    }

const uniqueRulesetTag = (existing: App.ProfileRuleSet[], baseTag: string) => {
  const used = new Set(existing.map((item) => item.tag))
  if (!used.has(baseTag)) return baseTag
  let index = 2
  while (used.has(`${baseTag}-${index}`)) index += 1
  return `${baseTag}-${index}`
}

export const addRulesetToProfile = async (input: AddRulesetToProfileInput) => {
  const profilesStore = useProfilesStore()

  const selected = await picker
    .resource('profile', 'profiles.select', { min: 1, max: 1 })
    .catch(() => undefined)
  const profile = selected?.items[0]
  if (!profile) return

  const insertionPointIndex = profile.route.rules.findIndex(
    (rule) => rule.type === RuleType.InsertionPoint,
  )

  if (insertionPointIndex === -1) {
    message.warn('kernel.missingInsertionPoint')
    return
  }

  const profileRuleset =
    input.kind === 'local'
      ? profile.route.rule_set.find(
          (item) => item.type === RulesetType.Local && item.path === input.id,
        )
      : profile.route.rule_set.find(
          (item) => item.type === RulesetType.Remote && item.url === input.url,
        )

  if (
    profileRuleset &&
    profile.route.rules.some(
      (rule) =>
        rule.type === RuleType.RuleSet && rule.payload.split(',').includes(profileRuleset.id),
    )
  ) {
    message.info('common.added')
    return
  }

  const outboundOptions = profile.outbounds.map((outbound) => ({
    label: outbound.tag,
    value: outbound.id,
    description: outbound.type,
  }))
  if (!outboundOptions.length) {
    message.warn('kernel.route.rules.invalid')
    return
  }
  const target = await picker
    .single('kernel.route.rules.outbound', outboundOptions, [outboundOptions[0]!.value])
    .catch(() => undefined)
  if (!target) return

  const nextProfile = deepClone(profile)
  let rulesetReferenceId = profileRuleset?.id
  if (!rulesetReferenceId) {
    const baseTag = input.kind === 'local' ? input.name : input.tag
    const rulesetReference: App.ProfileRuleSet =
      input.kind === 'local'
        ? {
            ...DefaultRouteRuleset(),
            type: RulesetType.Local,
            tag: uniqueRulesetTag(nextProfile.route.rule_set, baseTag),
            format: input.format,
            path: input.id,
          }
        : {
            ...DefaultRouteRuleset(),
            type: RulesetType.Remote,
            tag: uniqueRulesetTag(nextProfile.route.rule_set, baseTag),
            format: input.format,
            url: input.url,
          }
    nextProfile.route.rule_set.unshift(rulesetReference)
    rulesetReferenceId = rulesetReference.id
  }

  nextProfile.route.rules.splice(insertionPointIndex + 1, 0, {
    ...DefaultRouteRule(),
    payload: rulesetReferenceId,
    outbound: target,
  })

  await profilesStore.editProfile(nextProfile.id, nextProfile)
  message.success('common.success')
}
