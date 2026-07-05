import type { CoreApiConnectionRecord } from '@/types/kernel'

export const formatDnsAnswers = (answers: { data: string }[] = []) =>
  answers.map((item) => item.data)

export const buildRulesetCheckItems = (
  profileRulesets: App.ProfileRuleSet[],
  rulesets: App.RuleSet[],
) => {
  return profileRulesets.map((profileRuleset) => {
    const linkedRuleset =
      profileRuleset.type === 'local'
        ? rulesets.find((item) => item.id === profileRuleset.path)
        : rulesets.find(
            (item) => item.url === profileRuleset.url || item.name === profileRuleset.tag,
          )

    if (!linkedRuleset) {
      return {
        id: `ruleset-${profileRuleset.id}`,
        title: profileRuleset.tag || profileRuleset.id,
        status: 'failed' as const,
        summary: 'ruleset missing',
        detail: profileRuleset.type === 'local' ? profileRuleset.path : profileRuleset.url,
      }
    }

    if (linkedRuleset.disabled) {
      return {
        id: `ruleset-${profileRuleset.id}`,
        title: linkedRuleset.name,
        status: 'failed' as const,
        summary: 'ruleset disabled',
        detail: linkedRuleset.path,
      }
    }

    return {
      id: `ruleset-${profileRuleset.id}`,
      title: linkedRuleset.name,
      status: 'success' as const,
      summary: `${linkedRuleset.count} rules`,
      detail: linkedRuleset.path,
    }
  })
}

export const matchLatestConnection = (
  connections: CoreApiConnectionRecord[],
  target: { targetHost: string; targetPort: number },
) => {
  return connections
    .filter((item) => {
      const port = Number(item.metadata.destinationPort || 0)
      return (
        port === target.targetPort &&
        (item.metadata.host === target.targetHost ||
          item.metadata.destinationIP === target.targetHost)
      )
    })
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0]
}
