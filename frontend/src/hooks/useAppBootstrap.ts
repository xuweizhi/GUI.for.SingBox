import { ref } from 'vue'

import { IsStartup } from '@/bridge'
import * as Stores from '@/stores'
import { message, sleep } from '@/utils'

const MIN_SPLASH_DURATION = 1000

export const useAppBootstrap = () => {
  const loading = ref(false)
  const percent = ref(0)
  const hasError = ref(false)
  const initialized = ref(false)

  const envStore = Stores.useEnvStore()
  const appSettings = Stores.useAppSettingsStore()
  const profilesStore = Stores.useProfilesStore()
  const subscribesStore = Stores.useSubscribesStore()
  const rulesetsStore = Stores.useRulesetsStore()
  const nodeGroupsStore = Stores.useNodeGroupsStore()
  const pluginsStore = Stores.usePluginsStore()
  const scheduledTasksStore = Stores.useScheduledTasksStore()
  const kernelApiStore = Stores.useKernelApiStore()

  const showError = (error: unknown) => {
    hasError.value = true
    message.error(error)
  }

  let session = 0
  const reset = () => {
    ++session
    initialized.value = false
    loading.value = false
    scheduledTasksStore.stopSession()
    kernelApiStore.detachCore()
  }

  const initialize = async () => {
    const revision = session
    if (loading.value || initialized.value) return initialized.value

    loading.value = true
    hasError.value = false
    percent.value = 0

    try {
      await envStore.setupEnv()

      if (revision !== session) return false
      await Promise.all([
        appSettings.setupAppSettings(),
        profilesStore.setupProfiles(),
        subscribesStore.setupSubscribes(),
        rulesetsStore.setupRulesets(),
        nodeGroupsStore.setupNodeGroups(),
        pluginsStore.setupPlugins(),
      ])
      // Task ownership depends on the loaded proxy settings, subscriptions and plugins.
      if (revision !== session) return false
      await scheduledTasksStore.setupScheduledTasks()

      if (revision !== session) return false
      const startTime = performance.now()
      percent.value = 20

      const startup = await IsStartup()
      if (revision !== session) return false
      if (startup) {
        await pluginsStore.onStartupTrigger().catch(showError)
      }

      if (revision !== session) return false
      percent.value = 40
      await pluginsStore.onReadyTrigger().catch(showError)

      if (revision !== session) return false
      const duration = performance.now() - startTime
      percent.value = duration < 500 ? 80 : 100
      await sleep(Math.max(0, MIN_SPLASH_DURATION - duration))
      if (revision !== session) return false
      try {
        await kernelApiStore.initCoreState()
      } catch (error) {
        if (revision === session) message.error(error)
      }

      if (revision !== session) return false
      initialized.value = true
      return true
    } catch (error) {
      if (revision === session) showError(error)
      return false
    } finally {
      if (revision === session) loading.value = false
    }
  }

  return {
    loading,
    percent,
    hasError,
    initialized,
    initialize,
    reset,
  }
}
