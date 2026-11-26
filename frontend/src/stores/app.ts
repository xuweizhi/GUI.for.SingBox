import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  Download,
  HttpGet,
  MoveFile,
  UnzipTarGZFile,
  RemoveFile,
  HttpCancel,
  ReadDir,
  FileExists,
} from '@/bridge'
import { LanguageOptions, LocalesFilePath } from '@/constant/app'
import i18n, { loadLocale } from '@/lang'
import {
  APP_TITLE,
  APP_VERSION,
  APP_VERSION_API,
  getGitHubApiAuthorization,
  confirm,
  message,
  sampleID,
  sleep,
  modal,
} from '@/utils'
import { downloadProgressText, parseReleaseSha256 } from '@/utils/releaseAsset'

import { AboutView } from '@/components'

import { useEnvStore } from './env'

export const useAppStore = defineStore('app', () => {
  const isAppReloading = ref(false)

  /* Global Menu */
  const menuShow = ref(false)
  const menuList = ref<App.Menu[]>([])
  const menuPosition = ref<{ x: number; y: number; align?: 'end' }>({
    x: 0,
    y: 0,
  })

  /* Global Tips */
  const tipsShow = ref(false)
  const tipsMessage = ref('')
  const tipsPosition = ref({
    x: 0,
    y: 0,
  })

  /* Modal Stack */
  const modalStack = ref<(() => MaybePromise<void>)[]>([])
  const modalZIndexCounter = ref(999)
  const modalMinimizers = ref(new Set<() => void>())
  const modalMaximized = ref(new Set<string>())
  const modalMinimized = ref<
    {
      id: string
      title: () => string
      openFn: () => void
      closeFn: () => MaybePromise<void>
      minimizeFn: () => void
    }[]
  >([])

  /* i18n */
  const localesLoading = ref(false)
  const locales = ref<{ label: string; value: string }[]>([])
  const loadLocales = async (delay = true, reload = true) => {
    localesLoading.value = true
    try {
      const dirs = await ReadDir(LocalesFilePath).catch(() => [])
      const localLanguage = dirs.flatMap((file) => {
        if (file.isDir || !file.name.endsWith('.json')) return []
        const name = file.name.slice(0, -'.json'.length)
        return name ? { label: name, value: name } : []
      })
      locales.value = [...LanguageOptions, ...localLanguage]
      reload && (await loadLocale())
      delay && (await sleep(200))
    } finally {
      localesLoading.value = false
    }
  }

  /* Actions */
  const customActions = ref({
    core_state: [] as (App.CustomAction | App.CustomActionFn)[],
    title_bar: [] as (App.CustomAction | App.CustomActionFn)[],
    profiles_header: [] as (App.CustomAction | App.CustomActionFn)[],
    subscriptions_header: [] as (App.CustomAction | App.CustomActionFn)[],
  })
  const addCustomActions = (
    target: keyof typeof customActions.value,
    actions: App.CustomAction | App.CustomAction[] | App.CustomActionFn | App.CustomActionFn[],
  ) => {
    if (!customActions.value[target]) throw new Error('Target does not exist: ' + target)
    const _actions = Array.isArray(actions) ? actions : [actions]
    _actions.forEach((action) => !action.id && (action.id = sampleID()))
    customActions.value[target].push(..._actions)
    const remove = () => {
      customActions.value[target] = customActions.value[target].filter(
        (a) => !_actions.some((added) => added.id === a.id),
      )
    }
    return remove
  }
  const removeCustomActions = (target: keyof typeof customActions.value, id: string | string[]) => {
    if (!customActions.value[target]) throw new Error('Target does not exist: ' + target)
    const ids = Array.isArray(id) ? id : [id]
    customActions.value[target] = customActions.value[target].filter((a) => !ids.includes(a.id!))
  }

  const t = (key: string) => i18n?.global?.t?.(key) ?? key
  const envStore = useEnvStore()

  /* About Page */
  const showAbout = ref(false)
  const lastCheckTime = ref(0)
  const checkForUpdatesLoading = ref(false)
  const restartable = ref(false)
  const downloading = ref(false)
  const downloadUrl = ref('')
  const downloadDigest = ref('')
  const remoteVersion = ref(APP_VERSION)
  const updatable = computed(() => Boolean(downloadUrl.value && APP_VERSION !== remoteVersion.value))

  const downloadApp = async () => {
    if (downloading.value || checkForUpdatesLoading.value || !updatable.value) return
    downloading.value = true
    const { appName, os, arch } = envStore.env
    const archiveName = `${APP_TITLE}-${os}-${arch}.tar.gz`
    const downloadCacheFile = `data/.cache/${archiveName}`
    const extractedDirectory = `data/.cache/${APP_TITLE}-${os}-${arch}`
    const extractedBinary = `${extractedDirectory}/${APP_TITLE}`
    const backupBinary = `${appName}.bak`
    try {
      const sha256 = parseReleaseSha256(downloadDigest.value)

      const { update, destroy } = message.info('common.downloading', 10 * 60 * 1_000, () => {
        HttpCancel(downloadCacheFile)
        setTimeout(() => void RemoveFile(downloadCacheFile).catch(() => undefined), 1000)
      })

      await Download(
        downloadUrl.value,
        downloadCacheFile,
        undefined,
        (progress, total) => {
          update(downloadProgressText(t('common.downloading'), progress, total))
        },
        {
          CancelId: downloadCacheFile,
          Sha256: sha256,
        },
      ).finally(destroy)

      await RemoveFile(extractedDirectory).catch(() => undefined)
      await UnzipTarGZFile(downloadCacheFile, 'data/.cache')
      if (!(await FileExists(extractedBinary))) {
        throw new Error(`Release archive does not contain ${extractedBinary}`)
      }

      await RemoveFile(backupBinary).catch(() => undefined)
      await MoveFile(appName, backupBinary)
      try {
        await MoveFile(extractedBinary, appName)
      } catch (error) {
        await MoveFile(backupBinary, appName).catch(() => undefined)
        throw error
      }
      message.success('about.updateSuccessfulRestart')
      restartable.value = true
    } catch (error: any) {
      console.error(error)
      message.error(error.message || error, 5_000)
    } finally {
      await RemoveFile(downloadCacheFile).catch(() => undefined)
      await RemoveFile(extractedDirectory).catch(() => undefined)
      downloading.value = false
    }
  }

  const checkForUpdates = async (showTips = false) => {
    if (checkForUpdatesLoading.value || downloading.value) return
    checkForUpdatesLoading.value = true
    remoteVersion.value = APP_VERSION
    downloadDigest.value = ''
    downloadUrl.value = ''
    try {
      const { body } = await HttpGet<Record<string, any>>(APP_VERSION_API, {
        Authorization: getGitHubApiAuthorization(),
      })
      if (body.message) throw body.message

      const { tag_name, assets } = body

      const { os, arch } = envStore.env
      const assetName = `${APP_TITLE}-${os}-${arch}.tar.gz`

      const asset = assets.find((v: any) => v.name === assetName)
      if (!asset) throw 'Asset Not Found:' + assetName
      parseReleaseSha256(asset.digest)
      if (asset.uploader?.login !== 'github-actions[bot]') {
        try {
          await confirm('common.warning', 'settings.kernel.risk', {
            type: 'text',
            okText: 'settings.kernel.stillDownload',
          })
        } catch {
          return
        }
      }

      remoteVersion.value = tag_name
      downloadUrl.value = asset.browser_download_url
      downloadDigest.value = asset.digest
      lastCheckTime.value = Date.now()

      if (showTips) {
        message.info(updatable.value ? 'about.newVersion' : 'about.latestVersion')
      }
    } catch (error: any) {
      console.error(error)
      if (showTips) {
        message.error(error.message || error)
      }
    } finally {
      checkForUpdatesLoading.value = false
    }
  }

  let aboutModal: ReturnType<typeof modal> | undefined
  watch(showAbout, (v) => {
    if (v) {
      if (aboutModal) return
      const m = modal({
        title: 'router.about',
        size: 'sm',
        footer: false,
        cancel: false,
        submit: false,
        maskClosable: true,
        afterDestroy() {
          aboutModal = undefined
          showAbout.value = false
        },
      })
      aboutModal = m
      m.setContent(AboutView).open()
    } else if (aboutModal) {
      const current = aboutModal
      aboutModal = undefined
      void current.destroy?.()
    }
  })

  return {
    isAppReloading,
    menuShow,
    menuPosition,
    menuList,
    tipsShow,
    tipsMessage,
    tipsPosition,
    modalStack,
    modalMinimized,
    modalMinimizers,
    modalMaximized,
    modalZIndexCounter,
    showAbout,
    lastCheckTime,
    checkForUpdatesLoading,
    restartable,
    downloading,
    remoteVersion,
    updatable,
    checkForUpdates,
    downloadApp,
    customActions,
    addCustomActions,
    removeCustomActions,
    localesLoading,
    locales,
    loadLocales,
  }
})
