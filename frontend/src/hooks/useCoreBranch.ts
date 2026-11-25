import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  Download,
  HttpCancel,
  UnzipZIPFile,
  UnzipTarGZFile,
  HttpGet,
  Exec,
  MoveFile,
  RemoveFile,
  AbsolutePath,
  BrowserOpenURL,
  MakeDir,
  FileExists,
} from '@/bridge'
import { CoreConfigFilePath, CoreWorkingDirectory } from '@/constant/kernel'
import { Branch } from '@/enums/app'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import {
  getGitHubApiAuthorization,
  confirm,
  message,
  getKernelFileName,
  getKernelAssetFileName,
  getKernelRuntimeEnv,
  replaceFileWithRollback,
} from '@/utils'
import { downloadProgressText, parseReleaseSha256 } from '@/utils/releaseAsset'

const StableUrl = 'https://api.github.com/repos/SagerNet/sing-box/releases/latest'
const AlphaUrl = 'https://api.github.com/repos/SagerNet/sing-box/releases?per_page=3'

const StablePage = 'https://github.com/SagerNet/sing-box/releases/latest'
const AlphaPage = 'https://github.com/SagerNet/sing-box/releases'

export { parseReleaseSha256 } from '@/utils/releaseAsset'

export const parseCoreVersionOutput = (output: string) => {
  return output.match(/\bversion\s+v?(\S+)/i)?.[1] || ''
}

export const useCoreBranch = (isAlpha = false) => {
  const releaseUrl = isAlpha ? AlphaUrl : StableUrl

  const localVersion = ref('')
  const remoteVersion = ref('')
  const versionDetail = ref('')

  const localVersionLoading = ref(false)
  const remoteVersionLoading = ref(false)
  const downloading = ref(false)
  const downloadCompleted = ref(false)
  const downloadProgress = ref('')
  const cancelDownload = ref<() => void>()

  const rollbackable = ref(false)
  const rollingBack = ref(false)

  const { t } = useI18n()
  const appSettings = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()

  const restartable = computed(() => {
    const { branch } = appSettings.app.kernel
    if (!kernelApiStore.running) return false
    return localVersion.value && downloadCompleted.value && (branch === Branch.Alpha) === isAlpha
  })

  const updatable = computed(
    () => remoteVersion.value && localVersion.value !== remoteVersion.value,
  )

  const CoreFilePath = `${CoreWorkingDirectory}/${getKernelFileName(isAlpha)}`
  const CoreBakFilePath = `${CoreFilePath}.bak`

  const downloadCore = async () => {
    if (downloading.value || rollingBack.value) return
    downloading.value = true
    downloadProgress.value = ''
    cancelDownload.value = undefined
    let downloadCacheFile = ''
    let extractedPath = ''
    let candidatePath = ''
    try {
      const { body } = await HttpGet<Record<string, any>>(releaseUrl, {
        Authorization: getGitHubApiAuthorization(),
      })
      if (body.message) throw body.message

      const release = isAlpha ? body.find((v: any) => v.prerelease === true) : body
      if (!release) throw 'Not Found'
      const { assets, tag_name } = release
      const releaseVersion = String(tag_name).replace(/^v/, '')
      const assetName = getKernelAssetFileName(releaseVersion)
      const asset = assets.find((v: any) => v.name === assetName)
      if (!asset) throw 'Asset Not Found:' + assetName
      const sha256 = parseReleaseSha256(asset.digest)
      if (asset.uploader?.login !== 'github-actions[bot]') {
        await confirm('common.warning', 'settings.kernel.risk', {
          type: 'text',
          okText: 'settings.kernel.stillDownload',
        })
      }

      downloadCacheFile = `data/.cache/${assetName}`
      candidatePath = `${downloadCacheFile}.candidate${CoreFilePath.endsWith('.exe') ? '.exe' : ''}`

      cancelDownload.value = () => {
        HttpCancel(downloadCacheFile)
        cancelDownload.value = undefined
      }

      await MakeDir(CoreWorkingDirectory)
      await RemoveFile(candidatePath).catch(() => undefined)

      await Download(
        asset.browser_download_url,
        downloadCacheFile,
        undefined,
        (progress, total) => {
          downloadProgress.value = downloadProgressText(t('common.downloading'), progress, total)
        },
        {
          CancelId: downloadCacheFile,
          Sha256: sha256,
        },
      )

      const stableFileName = getKernelFileName()

      if (assetName.endsWith('.zip')) {
        extractedPath = `data/.cache/${assetName.replace(/\.zip$/, '')}`
        await RemoveFile(extractedPath).catch(() => undefined)
        await UnzipZIPFile(downloadCacheFile, 'data/.cache')
        await MoveFile(`${extractedPath}/${stableFileName}`, candidatePath)
      } else if (assetName.endsWith('.tar.gz')) {
        extractedPath = `data/.cache/${assetName.replace(/\.tar\.gz$/, '')}`
        await RemoveFile(extractedPath).catch(() => undefined)
        await UnzipTarGZFile(downloadCacheFile, 'data/.cache')
        await MoveFile(`${extractedPath}/${stableFileName}`, candidatePath)
      } else {
        throw new Error(`Unsupported release asset: ${assetName}`)
      }

      if (!candidatePath.endsWith('.exe')) {
        await Exec('chmod', ['+x', await AbsolutePath(candidatePath)])
      }

      const candidateVersion = parseCoreVersionOutput(await Exec(candidatePath, ['version']))
      if (!candidateVersion || candidateVersion !== releaseVersion) {
        throw new Error(
          `Downloaded core version mismatch: expected ${releaseVersion}, got ${candidateVersion || 'unknown'}`,
        )
      }

      if (await FileExists(CoreConfigFilePath)) {
        await Exec(
          candidatePath,
          [
            'check',
            '--disable-color',
            '-c',
            await AbsolutePath(CoreConfigFilePath),
            '-D',
            await AbsolutePath(CoreWorkingDirectory),
          ],
          {
            Env: getKernelRuntimeEnv(isAlpha),
            WorkingDirectory: CoreWorkingDirectory,
          },
        )
      }

      await replaceFileWithRollback(
        {
          activePath: CoreFilePath,
          replacementPath: candidatePath,
          backupPath: CoreBakFilePath,
        },
        { exists: FileExists, move: MoveFile, remove: RemoveFile },
      )

      await refreshLocalVersion()
      downloadCompleted.value = true
      message.success('common.success')
    } catch (error: any) {
      console.log(error)
      message.error(error.message || error)
      downloadCompleted.value = false
    } finally {
      cancelDownload.value = undefined
      await Promise.all(
        [candidatePath, extractedPath, downloadCacheFile]
          .filter(Boolean)
          .map((path) => RemoveFile(path).catch(() => undefined)),
      )
      downloading.value = false
    }
  }

  const getLocalVersion = async (showTips = false) => {
    localVersionLoading.value = true
    try {
      const res = await Exec(CoreFilePath, ['version'])
      versionDetail.value = res.trim()
      return parseCoreVersionOutput(res)
    } catch (error: any) {
      console.log(error)
      showTips && message.error(error)
    } finally {
      localVersionLoading.value = false
    }
    return ''
  }

  const getRemoteVersion = async (showTips = false) => {
    remoteVersionLoading.value = true
    try {
      const { body } = await HttpGet<Record<string, any>>(releaseUrl, {
        Authorization: getGitHubApiAuthorization(),
      })
      const release = isAlpha ? body.find((v: any) => v.prerelease === true) : body
      if (!release) throw 'Not Found'
      const { tag_name } = release
      return tag_name.replace(/^v/, '') as string
    } catch (error: any) {
      console.log(error)
      showTips && message.error(error)
    } finally {
      remoteVersionLoading.value = false
    }
    return ''
  }

  const restartCore = async () => {
    if (!kernelApiStore.running) return
    try {
      await kernelApiStore.restartCore()
      downloadCompleted.value = false
    } catch (error: any) {
      message.error(error)
    }
  }

  const refreshLocalVersion = async (showTips = false) => {
    localVersion.value = await getLocalVersion(showTips)
  }

  const refreshRemoteVersion = async (showTips = false) => {
    remoteVersion.value = await getRemoteVersion(showTips)
  }

  const rollbackCore = async () => {
    if (rollingBack.value || downloading.value) return
    rollingBack.value = true
    try {
      const confirmed = await confirm('common.warning', 'settings.kernel.rollback').then(
        () => true,
        () => false,
      )
      if (!confirmed) return
      const doRollback = () => MoveFile(CoreBakFilePath, CoreFilePath)
      const { branch } = appSettings.app.kernel
      if (kernelApiStore.running && (branch === Branch.Alpha) === isAlpha) {
        await kernelApiStore.restartCore(doRollback)
      } else {
        await doRollback()
      }
      await refreshLocalVersion()
      downloadCompleted.value = false
      message.success('common.success')
    } catch (error: any) {
      message.error(error.message || error)
    } finally {
      await refreshRollbackable()
      rollingBack.value = false
    }
  }

  const openReleasePage = () => {
    BrowserOpenURL(isAlpha ? AlphaPage : StablePage)
  }

  watch(
    () => appSettings.app.kernel.branch,
    () => (downloadCompleted.value = false),
  )

  const refreshRollbackable = async () => {
    rollbackable.value = await FileExists(CoreBakFilePath).catch(() => false)
  }
  watch([localVersion, downloadCompleted], refreshRollbackable, { immediate: true })

  refreshLocalVersion()
  refreshRemoteVersion()

  return {
    restartable,
    updatable,
    rollbackable,
    rollingBack,
    versionDetail,
    localVersion,
    localVersionLoading,
    remoteVersion,
    remoteVersionLoading,
    downloading,
    downloadProgress,
    refreshLocalVersion,
    refreshRemoteVersion,
    downloadCore,
    cancelDownload,
    restartCore,
    rollbackCore,
    openReleasePage,
  }
}
