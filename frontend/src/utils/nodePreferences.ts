import { md5 } from 'js-md5'

export const subscriptionNodeKey = (subscriptionId: string, nodeId: string) =>
  JSON.stringify(['subscription', subscriptionId, nodeId])

export const profileNodeKey = (profileId: string, kind: 'outbound' | 'tag', id: string) =>
  JSON.stringify([kind, profileId, id])

export const makeNodeCatalog = (
  configText: string,
  profileId: string,
  keys: Map<string, string>,
) => ({
  configDigest: md5(configText),
  profileId,
  nodes: Array.from(keys),
})
export type NodeCatalog = ReturnType<typeof makeNodeCatalog>

export const readNodeCatalog = (
  configText: string,
  catalogText: string,
): NodeCatalog | undefined => {
  try {
    const value = JSON.parse(catalogText)
    if (
      value?.configDigest === md5(configText) &&
      typeof value.profileId === 'string' &&
      Array.isArray(value.nodes) &&
      value.nodes.every(
        (entry: unknown) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((part) => typeof part === 'string'),
      )
    )
      return value
  } catch {
    /* An older runtime can have no catalog. */
  }
}

// Existing cores may have been started before runtime tag identities were saved.
// Only attribute unambiguous subscription names. Preserve profile-native tags.
export const legacyNodeKeys = (
  profile: App.Profile | undefined,
  subscriptions: App.Subscription[],
) => {
  const matches = new Map<string, string | undefined>()
  for (const sub of subscriptions) {
    for (const proxy of sub.proxies || []) {
      if (!proxy.id) continue
      const key = subscriptionNodeKey(sub.id, proxy.id)
      for (const tag of [proxy.tag, `${proxy.tag} [${sub.name || sub.id}]`]) {
        matches.set(tag, matches.has(tag) ? undefined : key)
      }
    }
  }
  if (profile) {
    for (const entry of profile.outbounds)
      matches.set(entry.tag, profileNodeKey(profile.id, 'outbound', entry.id))
    for (const entry of [
      ...(profile.native?.outbounds || []),
      ...(profile.native?.endpoints || []),
    ])
      matches.set(entry.tag, profileNodeKey(profile.id, 'tag', entry.tag))
  }
  return matches
}

export const rememberNode = (recent: string[], key: string) =>
  [key, ...recent.filter((entry) => entry !== key)].slice(0, 30)
