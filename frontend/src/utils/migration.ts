import { RequestProxyMode } from '@/enums/app'

import { getOutboundRole, getPrimaryProxyOutbound } from './outboundPolicy'

export const migrateProfiles = async (profiles: App.Profile[], save: () => Promise<string>) => {
  let needSync = false

  profiles.forEach((profile) => {
    const cache = profile.experimental?.cache_file
    if (cache && cache.store_rdrc !== undefined) {
      cache.store_dns ??= cache.store_rdrc
      delete cache.store_rdrc
      delete cache.rdrc_timeout
      needSync = true
    }
    profile.outbounds.forEach((outbound) => {
      if (typeof outbound.role === 'undefined') {
        outbound.role = getOutboundRole(outbound)
        needSync = true
      }
    })
    const primaryProxy = getPrimaryProxyOutbound(profile)
    if (primaryProxy && profile.primary_proxy_outbound !== primaryProxy.id) {
      profile.primary_proxy_outbound = primaryProxy.id
      needSync = true
    }
    profile.dns.rules.forEach((rule) => {
      if (typeof rule.enable === 'undefined') {
        rule.enable = true
        needSync = true
      }
    })
    profile.route.rules.forEach((rule) => {
      if (typeof rule.enable === 'undefined') {
        rule.enable = true
        needSync = true
      }
    })
  })

  if (needSync) await save()
}

export const migrateSubscribes = async (
  subscribes: App.Subscription[],
  save: () => Promise<string>,
) => {
  let needSync = false

  subscribes.forEach((subscribe) => {
    if (!Number.isFinite(subscribe.expire)) {
      subscribe.expire = 0
      needSync = true
    }
    if (typeof subscribe.requestProxyMode === 'undefined') {
      subscribe.requestProxyMode = RequestProxyMode.System
      needSync = true
    }
    if (typeof subscribe.customProxy === 'undefined') {
      subscribe.customProxy = ''
      needSync = true
    }
    if (typeof subscribe.decryptPassword === 'undefined') {
      subscribe.decryptPassword = ''
      needSync = true
    }
  })

  if (needSync) await save()
}

export const migrateRulesets = async (rulesets: App.RuleSet[], save: () => Promise<string>) => {
  let needSync = false

  rulesets.forEach((ruleset) => {
    const legacyRuleset = ruleset as App.RuleSet & { tag?: string }

    if (typeof ruleset.name === 'undefined' && legacyRuleset.tag) {
      ruleset.name = legacyRuleset.tag
      delete legacyRuleset.tag
      needSync = true
    }
  })

  if (needSync) await save()
}
