import { defineStore } from 'pinia'
import { ref } from 'vue'
import { parse } from 'yaml'

import { ReadFile, WriteFile, Requests, GetSystemProxy } from '@/bridge'
import { DefaultSubscribeScript, SubscribesFilePath, ProfilesFilePath } from '@/constant/app'
import { DefaultExcludeProtocols } from '@/constant/kernel'
import { PluginTriggerEvent, RequestMethod, RequestProxyMode } from '@/enums/app'
import { useAppSettingsStore, usePluginsStore, useProfilesStore } from '@/stores'
import {
  sampleID,
  isValidSubJson,
  isValidSubYAML,
  isValidBase64,
  stringifyNoFolding,
  ignoredError,
  omitArray,
  asyncPool,
  eventBus,
  buildSmartRegExp,
  GetRequestProxy,
  migrateSubscribes,
  decryptEncryptedSubscription,
  getHeaderValue,
  isEncryptedSubscription,
  isSubscriptionShareLinkList,
  normalizeSubscriptionProxies,
  reconcileSubscriptionProxyIds,
  SubscriptionEncryptionHeader,
  deepClone,
} from '@/utils'
import { persistConfigFiles, withConfigMutation } from '@/utils/configPersistence'
import { extractSubscriptionConfig, validateSubscriptionEntries } from '@/utils/subscriptionConfig'

import type { ConfigFileWrite } from '@/utils/fileTransaction'

export const useSubscribesStore = defineStore('subscribes', () => {
  const subscribes = ref<App.Subscription[]>([])

  const defaultOutboundIds = ['outbound-select', 'outbound-urltest']

  const setupSubscribes = async () => {
    const data = await ignoredError(ReadFile, SubscribesFilePath)
    data && (subscribes.value = parse(data))

    await migrateSubscribes(subscribes.value, saveSubscribes)
  }

  const serialize = (subscriptions: App.Subscription[]) =>
    stringifyNoFolding(omitArray(subscriptions, ['updating']))
  const saveSubscribes = () =>
    withConfigMutation(() => WriteFile(SubscribesFilePath, serialize(subscribes.value)))

  const reloadFromDisk = (options: { emitChanges?: boolean } = {}) =>
    withConfigMutation(async () => {
      const parsed = parse(await ReadFile(SubscribesFilePath))
      if (!Array.isArray(parsed)) throw new Error('Subscriptions file must contain an array')
      const ids = [
        ...new Set([...subscribes.value, ...parsed].map((subscription) => subscription.id)),
      ]
      subscribes.value = parsed
      if (options.emitChanges) eventBus.emit('subscriptionsChange', { ids })
    })

  const resolveSubscribeRequestProxy = async (
    requestProxyMode: App.RequestProxyMode,
    customProxy: string,
    explicitRequestProxyMode?: App.RequestProxyMode,
  ) => {
    const proxy = await GetRequestProxy(
      requestProxyMode === RequestProxyMode.Global ? undefined : requestProxyMode,
      requestProxyMode === RequestProxyMode.Global ? undefined : customProxy,
    )
    if (proxy || explicitRequestProxyMode) return proxy

    const appSettingsStore = useAppSettingsStore()
    if (
      requestProxyMode !== RequestProxyMode.System ||
      appSettingsStore.app.requestProxyMode !== RequestProxyMode.Kernel
    ) {
      return proxy
    }

    if (await GetSystemProxy().catch(() => '')) return ''
    return GetRequestProxy(RequestProxyMode.Kernel)
  }

  const addSubscribeToDefaultOutbounds = (s: App.Subscription, profile?: App.Profile) => {
    if (!profile) return false
    let changed = false
    defaultOutboundIds.forEach((id) => {
      const outbound = profile.outbounds.find((item) => item.id === id)
      if (!outbound || !['selector', 'urltest'].includes(outbound.type)) return
      if (outbound.outbounds.some((item) => item.type === 'Subscription' && item.id === s.id))
        return
      outbound.outbounds.push({ id: s.id, tag: s.id, type: 'Subscription' })
      changed = true
    })
    return changed
  }

  const publishProfiles = (profiles: App.Profile[]) => {
    const store = useProfilesStore()
    profiles.forEach((profile, index) => Object.assign(store.profiles[index]!, profile))
  }

  const syncSubscribeOutboundRefs = () =>
    withConfigMutation(async () => {
      const profilesStore = useProfilesStore()
      const profiles = deepClone(profilesStore.profiles)
      const currentProfile = profiles.find(
        (profile) => profile.id === profilesStore.currentProfile?.id,
      )
      const subscriptionIds = new Set(subscribes.value.map((item) => item.id))
      const changed = new Set<string>()
      let added = 0
      let removed = 0
      profiles.forEach((profile) =>
        profile.outbounds.forEach((outbound) => {
          outbound.outbounds = outbound.outbounds.filter((item) => {
            if (item.type !== 'Subscription' || subscriptionIds.has(item.id)) return true
            removed++
            changed.add(profile.id)
            return false
          })
        }),
      )
      if (currentProfile) {
        const before = currentProfile.outbounds.reduce(
          (n, outbound) => n + outbound.outbounds.length,
          0,
        )
        subscribes.value.forEach((subscription) =>
          addSubscribeToDefaultOutbounds(subscription, currentProfile),
        )
        added =
          currentProfile.outbounds.reduce((n, outbound) => n + outbound.outbounds.length, 0) -
          before
        if (added) changed.add(currentProfile.id)
      }
      if (added || removed) {
        await WriteFile(ProfilesFilePath, stringifyNoFolding(profiles))
        publishProfiles(profiles)
        changed.forEach((id) => eventBus.emit('profileChange', { id }))
      }
      return { added, removed }
    })

  const addSubscribe = (s: App.Subscription) =>
    withConfigMutation(async () => {
      const profilesStore = useProfilesStore()
      const profiles = deepClone(profilesStore.profiles)
      const current = profiles.find((profile) => profile.id === profilesStore.currentProfile?.id)
      const changed = addSubscribeToDefaultOutbounds(s, current)
      await persistConfigFiles([
        { path: SubscribesFilePath, content: serialize([...subscribes.value, s]) },
        ...(changed ? [{ path: ProfilesFilePath, content: stringifyNoFolding(profiles) }] : []),
      ])
      subscribes.value.push(s)
      if (changed) publishProfiles(profiles)
      // A new HTTP subscription has no runtime nodes until its first successful refresh.
      if (s.proxies.length) eventBus.emit('subscriptionChange', { id: s.id })
    })

  const importSubscribe = async (name: string, url: string) => {
    await addSubscribe(getSubscribeTemplate(name, { url }))
  }

  const deleteSubscribe = (id: string) =>
    withConfigMutation(async () => {
      const idx = subscribes.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const profilesStore = useProfilesStore()
      const profiles = deepClone(profilesStore.profiles)
      const changed = new Set<string>()
      profiles.forEach((profile) =>
        profile.outbounds.forEach((outbound) => {
          outbound.outbounds = outbound.outbounds.filter((item) => {
            if (item.type !== 'Subscription' || item.id !== id) return true
            changed.add(profile.id)
            return false
          })
        }),
      )
      await persistConfigFiles([
        {
          path: SubscribesFilePath,
          content: serialize(subscribes.value.filter((s) => s.id !== id)),
        },
        ...(changed.size
          ? [{ path: ProfilesFilePath, content: stringifyNoFolding(profiles) }]
          : []),
      ])
      subscribes.value.splice(idx, 1)
      if (changed.size) publishProfiles(profiles)
      changed.forEach((id) => eventBus.emit('profileChange', { id }))
      eventBus.emit('subscriptionChange', { id })
    })

  const editSubscribe = (id: string, s: App.Subscription) =>
    withConfigMutation(async () => {
      const idx = subscribes.value.findIndex((v) => v.id === id)
      if (idx === -1) return
      const next = subscribes.value.map((value, index) => (index === idx ? s : value))
      await WriteFile(SubscribesFilePath, serialize(next))
      subscribes.value.splice(idx, 1, s)
      eventBus.emit('subscriptionChange', { id })
    })

  const _doUpdateSub = async (s: App.Subscription, options: Partial<App.Subscription> = {}) => {
    s = deepClone(s)
    const expected = serialize([s])
    const originalPath = s.path
    const userInfo: Recordable = {}
    const previousMetadata = deepClone(s.proxies)
    const previousBody = await ignoredError(ReadFile, s.path)
    let previousOutbounds: Recordable[] = []
    if (previousBody) {
      try {
        const parsed = JSON.parse(previousBody)
        previousOutbounds = extractSubscriptionConfig(parsed).outbounds
      } catch {
        // A missing or legacy cache only disables content-based identity matching.
      }
    }
    let body = ''
    let proxies: Record<string, any>[] = []
    let importedDns: App.Subscription['importedDns']
    let preserveCachedDns = false

    if (s.type === 'Manual') {
      body = await ReadFile(s.path)
    }

    if (s.type === 'File') {
      body = await ReadFile(s.url)
    }

    if (s.type === 'Http') {
      const requestProxyMode = options.requestProxyMode ?? s.requestProxyMode
      const { headers: h, body: b } = await Requests({
        method: options.requestMethod ?? s.requestMethod,
        url: options.url ?? s.url,
        headers: { ...s.header.request, ...options.header?.request },
        autoTransformBody: false,
        options: {
          Insecure: options.inSecure ?? s.inSecure,
          Proxy: await resolveSubscribeRequestProxy(
            requestProxyMode,
            options.customProxy ?? s.customProxy,
            options.requestProxyMode,
          ),
          Timeout: options.requestTimeout ?? s.requestTimeout,
        },
      })
      Object.assign(h, s.header.response, options.header?.response)
      if (h['Subscription-Userinfo']) {
        ;(h['Subscription-Userinfo'] as string).split(/\s*;\s*/).forEach((part) => {
          const [key, value] = part.split('=') as [string, string]
          userInfo[key] = parseInt(value) || 0
        })
      }
      body = b
      const encryptionHeader = getHeaderValue(h, SubscriptionEncryptionHeader)
      if (isEncryptedSubscription(encryptionHeader)) {
        const decryptPassword = options.decryptPassword ?? s.decryptPassword
        if (!decryptPassword) {
          throw 'Subscription is encrypted. Set a decrypt password first'
        }

        const decryptedBody = await decryptEncryptedSubscription(decryptPassword, body)
        if (!decryptedBody) {
          throw 'Failed to decrypt subscription. Check the decrypt password'
        }
        body = decryptedBody
      }
    }

    if (isValidSubJson(body)) {
      const extracted = extractSubscriptionConfig(JSON.parse(body))
      proxies = extracted.outbounds
      importedDns = extracted.importedDns
    } else if (isValidSubYAML(body)) {
      const extracted = extractSubscriptionConfig(parse(body))
      proxies = extracted.outbounds
      importedDns = extracted.importedDns
    } else if (isValidBase64(body)) {
      proxies = [{ base64: body }]
    } else if (isSubscriptionShareLinkList(body)) {
      // Treat line-based share links the same as base64 subscriptions.
      proxies = [{ base64: body }]
    } else if (s.type === 'Manual' || s.type === 'File') {
      const parsed = JSON.parse(body)
      const extracted = extractSubscriptionConfig(parsed)
      proxies = extracted.outbounds
      importedDns = extracted.importedDns
      preserveCachedDns = Array.isArray(parsed) && (s.type === 'Manual' || s.url === s.path)
    } else {
      throw 'Not a valid subscription data'
    }

    const pluginStore = usePluginsStore()

    proxies = await pluginStore.onSubscribeTrigger(proxies, s)
    proxies = await normalizeSubscriptionProxies(proxies, {
      resolverTags: (importedDns || (preserveCachedDns ? s.importedDns : undefined))?.servers
        .map((server) => server.tag)
        .filter((tag): tag is string => typeof tag === 'string'),
    })

    if (proxies.some((proxy) => proxy.name && !proxy.tag) || proxies[0]?.base64) {
      throw 'You need to install the [节点转换] plugin first'
    }

    proxies = validateSubscriptionEntries(proxies)

    if (s.type !== 'Manual') {
      const r1 = s.include && buildSmartRegExp(s.include)
      const r2 = s.exclude && buildSmartRegExp(s.exclude)
      const r3 = s.includeProtocol && buildSmartRegExp(s.includeProtocol)
      const r4 = s.excludeProtocol && buildSmartRegExp(s.excludeProtocol)

      proxies = proxies.filter((v) => {
        const flag1 = r1 ? r1.test(v.tag) : true
        const flag2 = r2 ? r2.test(v.tag) : false
        const flag3 = r3 ? r3.test(v.type) : true
        const flag4 = r4 ? r4.test(v.type) : false
        return flag1 && !flag2 && flag3 && !flag4
      })

      if (s.proxyPrefix) {
        const renamed = new Map(
          proxies.map((proxy) => [
            proxy.tag,
            proxy.tag.startsWith(s.proxyPrefix) ? proxy.tag : s.proxyPrefix + proxy.tag,
          ]),
        )
        const reference = (tag: string) => renamed.get(tag) || tag
        proxies.forEach((proxy) => {
          proxy.tag = reference(proxy.tag)
          if (proxy.detour) proxy.detour = reference(proxy.detour)
          if (proxy.default) proxy.default = reference(proxy.default)
          if (Array.isArray(proxy.outbounds)) proxy.outbounds = proxy.outbounds.map(reference)
        })
        importedDns?.servers.forEach((server) => {
          if (server.detour) server.detour = reference(server.detour)
        })
      }
    }

    if (!preserveCachedDns) s.importedDns = importedDns
    s.upload = userInfo.upload ?? 0
    s.download = userInfo.download ?? 0
    s.total = userInfo.total ?? 0
    s.expire = userInfo.expire * 1000
    s.updateTime = Date.now()
    s.proxies = reconcileSubscriptionProxyIds(
      previousMetadata,
      previousOutbounds,
      proxies,
      sampleID,
    )
    const preScriptMetadata = deepClone(s.proxies)
    const preScriptOutbounds = deepClone(proxies)

    const fn = new window.AsyncFunction(
      'proxies',
      'subscription',
      `${s.script}; return await ${PluginTriggerEvent.OnSubscribe}(proxies, subscription)`,
    ) as (
      proxies: Recordable[],
      subscription: App.Subscription,
    ) => Promise<{ proxies: Recordable[]; subscription: App.Subscription }>

    const { proxies: _proxies, subscription } = await fn(proxies, s)

    validateSubscriptionEntries(_proxies)
    Object.assign(s, subscription)
    s.proxies = reconcileSubscriptionProxyIds(
      preScriptMetadata,
      preScriptOutbounds,
      _proxies,
      sampleID,
    )

    const cache: ConfigFileWrite[] =
      s.type !== 'File' || s.url !== s.path
        ? [
            {
              path: s.path,
              content: JSON.stringify(omitArray(_proxies, ['__id__', '__tmp__id__']), null, 2),
            },
          ]
        : []
    return { subscription: s, cache, expected, originalPath, previousBody }
  }

  const assertUnchanged = async (
    id: string,
    prepared: Awaited<ReturnType<typeof _doUpdateSub>>,
  ) => {
    const current = subscribes.value.find((subscription) => subscription.id === id)
    if (
      !current ||
      serialize([current]) !== prepared.expected ||
      (await ignoredError(ReadFile, prepared.originalPath)) !== prepared.previousBody
    )
      throw new Error('Subscription changed while updating; retry the refresh')
    return current
  }

  const updateSubscribe = async (id: string, options: Partial<App.Subscription> = {}) => {
    const s = subscribes.value.find((v) => v.id === id)
    if (!s) throw id + ' Not Found'
    if (s.disabled) throw s.name + ' Disabled'
    try {
      s.updating = true
      const prepared = await _doUpdateSub(s, options)
      await withConfigMutation(async () => {
        const current = await assertUnchanged(id, prepared)
        const next = subscribes.value.map((value) =>
          value.id === id ? prepared.subscription : value,
        )
        await persistConfigFiles([
          ...prepared.cache,
          { path: SubscribesFilePath, content: serialize(next) },
        ])
        Object.assign(current, prepared.subscription)
        eventBus.emit('subscriptionChange', { id })
      })
    } catch (error: any) {
      throw `Failed to update subscription [${s.name}]. Reason: ${error.message || error}`
    } finally {
      s.updating = false
      const current = subscribes.value.find((subscription) => subscription.id === id)
      if (current) current.updating = false
    }
    return `Subscription [${s.name}] updated successfully.`
  }

  const updateSubscribes = async (options: { throwOnFailure?: boolean } = {}) => {
    const prepared = new Map<string, Awaited<ReturnType<typeof _doUpdateSub>>>()
    const update = async (s: App.Subscription) => {
      const result = { ok: true, id: s.id, name: s.name, result: '' }
      try {
        s.updating = true
        prepared.set(s.id, await _doUpdateSub(s))
        result.result = `Subscription [${s.name}] updated successfully.`
      } catch (error: any) {
        result.ok = false
        result.result = `Failed to update subscription [${s.name}]. Reason: ${error.message || error}`
      } finally {
        s.updating = false
      }
      return result
    }
    const result = await asyncPool(
      5,
      subscribes.value.filter((v) => !v.disabled),
      update,
    )
    if (prepared.size)
      await withConfigMutation(async () => {
        for (const [id, value] of prepared) await assertUnchanged(id, value)
        const next = subscribes.value.map((s) => prepared.get(s.id)?.subscription || s)
        await persistConfigFiles([
          ...[...prepared.values()].flatMap((value) => value.cache),
          { path: SubscribesFilePath, content: serialize(next) },
        ])
        subscribes.value.forEach((s) => {
          const updated = prepared.get(s.id)
          if (updated) Object.assign(s, updated.subscription, { updating: false })
        })
        eventBus.emit('subscriptionsChange', { ids: [...prepared.keys()] })
      })
    const output = result.flatMap((v) => (v.ok && v.value) || [])
    if (options.throwOnFailure) {
      const failed = output.filter((item) => !item.ok)
      if (failed.length) throw new Error(failed.map((item) => item.result).join('\n'))
    }
    return output
  }

  const getSubscribeById = (id: string) => subscribes.value.find((v) => v.id === id)

  const getSubscribeTemplate = (name = '', options: { url?: string } = {}): App.Subscription => {
    const id = sampleID()
    return {
      id: id,
      name: name,
      upload: 0,
      download: 0,
      total: 0,
      expire: 0,
      updateTime: 0,
      type: 'Http',
      url: options.url || '',
      website: '',
      decryptPassword: '',
      preferOutboundDns: false,
      outboundDns: [],
      path: `data/subscribes/${id}.json`,
      include: '',
      exclude: '',
      includeProtocol: '',
      excludeProtocol: DefaultExcludeProtocols,
      proxyPrefix: '',
      requestProxyMode: RequestProxyMode.Global,
      customProxy: '',
      disabled: false,
      inSecure: false,
      requestMethod: RequestMethod.Get,
      requestTimeout: 15,
      header: {
        request: {
          'User-Agent': 'clash.meta/mihomo',
        },
        response: {},
      },
      proxies: [],
      script: DefaultSubscribeScript,
    }
  }

  return {
    subscribes,
    setupSubscribes,
    reloadFromDisk,
    saveSubscribes,
    addSubscribe,
    editSubscribe,
    deleteSubscribe,
    syncSubscribeOutboundRefs,
    updateSubscribe,
    updateSubscribes,
    getSubscribeById,
    importSubscribe,
    getSubscribeTemplate,
  }
})
