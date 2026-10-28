import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ subscriptions: vi.fn(), tasks: vi.fn(), order: [] as string[] }))
vi.mock('@/bridge', () => ({ IsStartup: vi.fn().mockResolvedValue(false) }))
vi.mock('@/utils', () => ({ message: { error: vi.fn() }, sleep: vi.fn() }))
vi.mock('@/stores', () => ({
  useEnvStore: () => ({ setupEnv: vi.fn() }),
  useAppSettingsStore: () => ({ setupAppSettings: vi.fn() }),
  useProfilesStore: () => ({ setupProfiles: vi.fn() }),
  useSubscribesStore: () => ({ setupSubscribes: mocks.subscriptions }),
  useRulesetsStore: () => ({ setupRulesets: vi.fn() }),
  useNodeGroupsStore: () => ({ setupNodeGroups: vi.fn() }),
  usePluginsStore: () => ({
    setupPlugins: vi.fn(),
    onReadyTrigger: vi.fn().mockResolvedValue(undefined),
  }),
  useScheduledTasksStore: () => ({ setupScheduledTasks: mocks.tasks }),
  useKernelApiStore: () => ({ initCoreState: vi.fn() }),
}))
import { useAppBootstrap } from '../useAppBootstrap'
it('waits for dependency stores before initializing scheduled tasks', async () => {
  let finish!: () => void
  mocks.subscriptions.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const bootstrap = useAppBootstrap()
  const initialized = bootstrap.initialize()
  await flushPromises()
  expect(mocks.tasks).not.toHaveBeenCalled()
  finish()
  expect(await initialized).toBe(true)
  expect(mocks.tasks).toHaveBeenCalledOnce()
})
