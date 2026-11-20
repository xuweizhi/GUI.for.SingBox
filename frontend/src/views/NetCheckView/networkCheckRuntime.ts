import type { CoreApiConnectionRecord } from '@/types/kernel'

export const formatDnsAnswers = (answers: { data: string }[] = []) =>
  answers.map((item) => item.data)

type RuleEvidence = {
  counts?: Record<string, number> | null
  cached?: Record<string, string> | null
  failed?: Record<string, string> | null
}

export const buildRulesetCheckItems = (
  profileRulesets: App.ProfileRuleSet[],
  rulesets: App.RuleSet[],
  core: RuleEvidence = {},
) => {
  return profileRulesets.map((item) => {
    const linked =
      item.type === 'local'
        ? rulesets.find((entry) => entry.id === item.path)
        : item.type === 'remote' && item.url
          ? rulesets.find((entry) => entry.url === item.url)
          : undefined
    const base = { id: `ruleset-${item.id}`, title: item.tag || linked?.name || item.id }
    // In the extension, counts and cache times are keyed by URL, download errors by tag.
    if (item.type === 'remote') {
      const error = core.failed?.[item.tag]
      const updated = core.cached?.[item.url]
      const count = core.counts?.[item.url]
      const detail = [typeof count === 'number' ? String(count) : '', updated, error]
        .filter(Boolean)
        .join(' · ')
      if (error)
        return {
          ...base,
          status: 'failed' as const,
          summary: 'diagnostics.coreFetchFailed',
          detail,
        }
      if (count === 0)
        return { ...base, status: 'skipped' as const, summary: 'diagnostics.emptyRuleset', detail }
      if (typeof count === 'number')
        return { ...base, status: 'success' as const, summary: 'diagnostics.coreRuleCount', detail }
      if (updated)
        return {
          ...base,
          status: 'skipped' as const,
          summary: 'diagnostics.coreCache',
          detail: updated,
        }
    }
    if (linked)
      return {
        ...base,
        status: 'skipped' as const,
        summary: linked.disabled ? 'diagnostics.registryDisabled' : 'diagnostics.registryOnly',
        detail: linked.path,
      }
    const missingReference = item.type === 'local' && item.native_path !== item.path
    return {
      ...base,
      status: missingReference ? ('failed' as const) : ('skipped' as const),
      summary: missingReference ? 'diagnostics.missingReference' : 'diagnostics.profileOnly',
      detail: item.type === 'local' ? item.path : undefined,
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
        (item.metadata.host?.toLowerCase() === target.targetHost.toLowerCase() ||
          item.metadata.destinationIP === target.targetHost)
      )
    })
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0]
}
