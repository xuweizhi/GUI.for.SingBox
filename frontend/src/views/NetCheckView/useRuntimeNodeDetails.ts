import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

import { ReadFile } from '@/bridge/io'

import { CoreConfigFilePath } from '@/constant/kernel'

import { resolveRuntimeNodeDetails } from './runtimeNodeDetails'

export const useRuntimeNodeDetails = (
  ready: Ref<boolean>,
  leafName: Ref<string>,
  selections: Ref<Record<string, { now?: string }>>,
) => {
  const config = ref<Record<string, any>>()
  const unavailable = ref(false)
  let revision = 0

  const refresh = async () => {
    const current = ++revision
    config.value = undefined
    unavailable.value = false
    if (!ready.value) return
    try {
      const parsed = JSON.parse(await ReadFile(CoreConfigFilePath))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid runtime configuration')
      }
      if (current === revision) config.value = parsed
    } catch {
      if (current === revision) unavailable.value = true
    }
  }

  watch(ready, refresh, { immediate: true })
  onScopeDispose(() => {
    revision += 1
  })

  const details = computed(() =>
    config.value
      ? resolveRuntimeNodeDetails(config.value, leafName.value, selections.value)
      : undefined,
  )

  return { details, unavailable, refresh }
}
