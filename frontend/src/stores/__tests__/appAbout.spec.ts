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
