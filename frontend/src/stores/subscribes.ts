import { defineStore } from 'pinia'
import { ref } from 'vue'
import { parse } from 'yaml'

import { ReadFile, WriteFile, Requests } from '@/bridge'
import { DefaultSubscribeScript, SubscribesFilePath } from '@/constant/app'
import { DefaultExcludeProtocols } from '@/constant/kernel'
import { PluginTriggerEvent, RequestMethod, RequestProxyMode } from '@/enums/app'
import { usePluginsStore, useProfilesStore } from '@/stores'
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
  SubscriptionEncryptionHeader,
} from '@/utils'

export const useSubscribesStore = defineStore('subscribes', () => {
  const subscribes = ref<App.Subscription[]>([])

  const defaultOutboundIds = ['outbound-select', 'outbound-urltest']

  const setupSubscribes = async () => {
    const data = await ignoredError(ReadFile, SubscribesFilePath)
    data && (subscribes.value = parse(data))

    await migrateSubscribes(subscribes.value, saveSubscribes)
  }

  const saveSubscribes = () => {
    const s = omitArray(subscribes.value, ['updating'])
    return WriteFile(SubscribesFilePath, stringifyNoFolding(s))
  }

  const addSubscribeToDefaultOutbounds = async (s: App.Subscription) => {
    const profilesStore = useProfilesStore()
    const profile = profilesStore.currentProfile
    if (!profile) return

    let changed = false
    const ref = { id: s.id, tag: s.id, type: 'Subscription' as const }

    defaultOutboundIds.forEach((id) => {
      const outbound = profile.outbounds.find((item) => item.id === id)
      if (!outbound || !['selector', 'urltest'].includes(outbound.type)) return
      if (outbound.outbounds.some((item) => item.type === 'Subscription' && item.id === s.id)) {
        return
      }
      outbound.outbounds.push({ ...ref })
      changed = true
    })

    if (changed) await profilesStore.saveProfiles()
  }

  const removeSubscribeFromOutbounds = async (id: string) => {
    const profilesStore = useProfilesStore()
    let changed = false

    profilesStore.profiles.forEach((profile) => {
      profile.outbounds.forEach((outbound) => {
        const next = outbound.outbounds.filter(
          (item) => !(item.type === 'Subscription' && item.id === id),
        )
        if (next.length === outbound.outbounds.length) return
        outbound.outbounds = next
        changed = true
      })
    })

    if (changed) await profilesStore.saveProfiles()
  }

  const syncSubscribeOutboundRefs = async () => {
    const profilesStore = useProfilesStore()
    const currentProfile = profilesStore.currentProfile
    const subscriptionIds = new Set(subscribes.value.map((item) => item.id))
    let added = 0
    let removed = 0

    profilesStore.profiles.forEach((profile) => {
      profile.outbounds.forEach((outbound) => {
        const next = outbound.outbounds.filter((item) => {
          const remove = item.type === 'Subscription' && !subscriptionIds.has(item.id)
          if (remove) removed += 1
          return !remove
        })
        if (next.length !== outbound.outbounds.length) {
          outbound.outbounds = next
        }
      })
    })

    if (currentProfile) {
      defaultOutboundIds.forEach((id) => {
        const outbound = currentProfile.outbounds.find((item) => item.id === id)
        if (!outbound || !['selector', 'urltest'].includes(outbound.type)) return
        subscribes.value.forEach((s) => {
          if (outbound.outbounds.some((item) => item.type === 'Subscription' && item.id === s.id)) {
            return
          }
          outbound.outbounds.push({ id: s.id, tag: s.id, type: 'Subscription' })
          added += 1
        })
      })
    }

    if (added || removed) await profilesStore.saveProfiles()

    return { added, removed }
  }

  const addSubscribe = async (s: App.Subscription) => {
    subscribes.value.push(s)
    try {
      await saveSubscribes()
      await addSubscribeToDefaultOutbounds(s)
    } catch (error) {
      const idx = subscribes.value.indexOf(s)
      if (idx !== -1) {
        subscribes.value.splice(idx, 1)
      }
      throw error
    }
  }

  const importSubscribe = async (name: string, url: string) => {
    await addSubscribe(getSubscribeTemplate(name, { url }))
  }

  const deleteSubscribe = async (id: string) => {
    const idx = subscribes.value.findIndex((v) => v.id === id)
    if (idx === -1) return
    const backup = subscribes.value.splice(idx, 1)[0]!
    try {
      await saveSubscribes()
      await removeSubscribeFromOutbounds(id)
    } catch (error) {
      subscribes.value.splice(idx, 0, backup)
      throw error
    }

    eventBus.emit('subscriptionChange', { id })
  }

  const editSubscribe = async (id: string, s: App.Subscription) => {
    const idx = subscribes.value.findIndex((v) => v.id === id)
    if (idx === -1) return
    const backup = subscribes.value.splice(idx, 1, s)[0]!
    try {
      await saveSubscribes()
    } catch (error) {
      subscribes.value.splice(idx, 1, backup)
      throw error
    }

    eventBus.emit('subscriptionChange', { id })
  }

  const _doUpdateSub = async (s: App.Subscription, options: Partial<App.Subscription> = {}) => {
    const userInfo: Recordable = {}
    let body = ''
    let proxies: Record<string, any>[] = []

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
          Proxy: await GetRequestProxy(
            requestProxyMode === RequestProxyMode.Global ? undefined : requestProxyMode,
            requestProxyMode === RequestProxyMode.Global
              ? undefined
              : (options.customProxy ?? s.customProxy),
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
      proxies = JSON.parse(body).outbounds
    } else if (isValidSubYAML(body)) {
      proxies = parse(body).proxies
    } else if (isValidBase64(body)) {
      proxies = [{ base64: body }]
    } else if (isSubscriptionShareLinkList(body)) {
      // Treat line-based share links the same as base64 subscriptions.
      proxies = [{ base64: body }]
    } else if (s.type === 'Manual') {
      proxies = JSON.parse(body)
    } else {
      throw 'Not a valid subscription data'
    }

    const pluginStore = usePluginsStore()

    proxies = await pluginStore.onSubscribeTrigger(proxies, s)
    proxies = await normalizeSubscriptionProxies(proxies)

    if (proxies.some((proxy) => proxy.name && !proxy.tag) || proxies[0]?.base64) {
      throw 'You need to install the [节点转换] plugin first'
    }

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
        proxies.forEach((v) => {
          v.tag = v.tag.startsWith(s.proxyPrefix) ? v.tag : s.proxyPrefix + v.tag
        })
      }
    }

    s.upload = userInfo.upload ?? 0
    s.download = userInfo.download ?? 0
    s.total = userInfo.total ?? 0
    s.expire = userInfo.expire * 1000
    s.updateTime = Date.now()
    s.proxies = proxies.map(({ tag, type }) => {
      // Keep the original ID value of the proxy unchanged
      const id = s.proxies.find((v) => v.tag === tag)?.id || sampleID()
      return { id, tag, type }
    })

    const fn = new window.AsyncFunction(
      'proxies',
      'subscription',
      `${s.script}; return await ${PluginTriggerEvent.OnSubscribe}(proxies, subscription)`,
    ) as (
      proxies: Recordable[],
      subscription: App.Subscription,
    ) => Promise<{ proxies: Recordable[]; subscription: App.Subscription }>

    const { proxies: _proxies, subscription } = await fn(proxies, s)

    Object.assign(s, subscription)
    s.proxies = _proxies.map(({ tag, type }) => {
      // Keep the original ID value of the proxy unchanged
      const id = s.proxies.find((v) => v.tag === tag)?.id || sampleID()
      return { id, tag, type }
    })

    if (s.type === 'Http' || (s.type === 'File' && s.url !== s.path)) {
      proxies = omitArray(_proxies, ['__id__', '__tmp__id__'])
      await WriteFile(s.path, JSON.stringify(proxies, null, 2))
    }
  }

  const updateSubscribe = async (id: string, options: Partial<App.Subscription> = {}) => {
    const s = subscribes.value.find((v) => v.id === id)
    if (!s) throw id + ' Not Found'
    if (s.disabled) throw s.name + ' Disabled'
    try {
      s.updating = true
      await _doUpdateSub(s, options)
      await saveSubscribes()
    } catch (error: any) {
      throw `Failed to update subscription [${s.name}]. Reason: ${error.message || error}`
    } finally {
      s.updating = false
    }

    eventBus.emit('subscriptionChange', { id })

    return `Subscription [${s.name}] updated successfully.`
  }

  const updateSubscribes = async (options: { throwOnFailure?: boolean } = {}) => {
    let needSave = false

    const update = async (s: App.Subscription) => {
      const result = { ok: true, id: s.id, name: s.name, result: '' }
      try {
        s.updating = true
        await _doUpdateSub(s)
        needSave = true
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

    if (needSave) await saveSubscribes()

    eventBus.emit('subscriptionsChange', undefined)

    const output = result.flatMap((v) => (v.ok && v.value) || [])
    if (options.throwOnFailure) {
      const failed = output.filter((item) => !item.ok)
      if (failed.length !== 0) {
        throw new Error(failed.map((item) => item.result).join('\n'))
      }
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
