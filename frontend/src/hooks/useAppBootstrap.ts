import { ref } from 'vue'

import { IsStartup } from '@/bridge'
import * as Stores from '@/stores'
import { message } from '@/utils'

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
      percent.value = 30

      const startup = await IsStartup()
      if (revision !== session) return false
      if (startup) {
        await pluginsStore.onStartupTrigger().catch(showError)
      }

      if (revision !== session) return false
      percent.value = 65
      await pluginsStore.onReadyTrigger().catch(showError)

      if (revision !== session) return false
      percent.value = 90
      try {
        await kernelApiStore.initCoreState()
      } catch (error) {
        if (revision === session) message.error(error)
      }

      if (revision !== session) return false
      percent.value = 100
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
