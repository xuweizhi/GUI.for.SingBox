import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const modalMock = vi.hoisted(() => vi.fn())
const setContentMock = vi.hoisted(() => vi.fn())
const openMock = vi.hoisted(() => vi.fn())

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/bridge', () => ({
  Download: vi.fn(),
  HttpGet: vi.fn(),
  MoveFile: vi.fn(),
  UnzipTarGZFile: vi.fn(),
  RemoveFile: vi.fn(),
  HttpCancel: vi.fn(),
  ReadDir: vi.fn().mockResolvedValue([]),
  FileExists: vi.fn(),
}))

vi.mock('@/constant/app', () => ({
  LanguageOptions: [],
  LocalesFilePath: '',
}))

vi.mock('@/lang', () => ({ loadLocale: vi.fn() }))
vi.mock('@/components', () => ({ AboutView: {} }))
vi.mock('@/stores/env', () => ({
  useEnvStore: () => ({ env: { appName: '', os: 'linux', arch: '' } }),
}))
vi.mock('@/utils', () => ({
  APP_TITLE: 'GUI.for.SingBox',
  APP_VERSION: 'v1',
  APP_VERSION_API: '',
  getGitHubApiAuthorization: vi.fn(),
  confirm: vi.fn(),
  message: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  sampleID: vi.fn(() => 'id'),
  sleep: vi.fn(),
  modal: modalMock,
}))

describe('app store About modal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    modalMock.mockReset()
    setContentMock.mockReset()
    openMock.mockReset()
    setContentMock.mockReturnValue({ open: openMock })
    modalMock.mockReturnValue({ setContent: setContentMock })
  })

  it('creates one command modal per About open lifecycle', async () => {
    const { useAppStore } = await import('@/stores/app')
    const appStore = useAppStore()

    appStore.showAbout = true
    await nextTick()
    appStore.showAbout = true
    await nextTick()

    expect(modalMock).toHaveBeenCalledOnce()
    expect(setContentMock).toHaveBeenCalledOnce()
    expect(openMock).toHaveBeenCalledOnce()

    const options = modalMock.mock.calls[0]![0]
    options.afterDestroy()
    await nextTick()
    expect(appStore.showAbout).toBe(false)

    appStore.showAbout = true
    await nextTick()

    expect(modalMock).toHaveBeenCalledTimes(2)
    expect(setContentMock).toHaveBeenCalledTimes(2)
    expect(openMock).toHaveBeenCalledTimes(2)
  })
})

it('rejects an unverified release and clears the previous download selection', async () => {
  setActivePinia(createPinia())
  const { HttpGet, Download } = await import('@/bridge')
  const { useAppStore } = await import('@/stores/app')
  const store = useAppStore()
  const asset = {
    name: 'GUI.for.SingBox-linux-.tar.gz',
    browser_download_url: 'release',
    uploader: { login: 'github-actions[bot]' },
  }
  const release = (digest: string) => ({ body: { tag_name: 'v2', assets: [{ ...asset, digest }] } })
  vi.mocked(HttpGet).mockResolvedValueOnce(release('sha256:' + '1'.repeat(64)) as any)
  await store.checkForUpdates()
  expect(store.updatable).toBeTruthy()
  vi.mocked(HttpGet).mockResolvedValueOnce(release('sha256:') as any)
  await store.checkForUpdates()
  await store.downloadApp()
  expect(store.updatable).toBeFalsy()
  expect(Download).not.toHaveBeenCalled()
})

it('clears locale loading when the language file cannot be loaded', async () => {
  setActivePinia(createPinia())
  const { loadLocale } = await import('@/lang')
  vi.mocked(loadLocale).mockRejectedValueOnce(new Error('invalid locale'))
  const { useAppStore } = await import('@/stores/app')
  const store = useAppStore()
  await expect(store.loadLocales(false)).rejects.toThrow('invalid locale')
  expect(store.localesLoading).toBe(false)
})
