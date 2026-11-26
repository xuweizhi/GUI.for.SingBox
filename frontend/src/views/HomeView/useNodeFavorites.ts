import { computed } from 'vue'

import { useAppSettingsStore, useKernelApiStore } from '@/stores'

export function useNodeFavorites() {
  const appSettingsStore = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()
  const favoriteKeys = computed(() => new Set(appSettingsStore.app.nodePreferences.favorites))
  const toggleFavorite = (name: string) => {
    const key = kernelApiStore.getNodePreferenceKey(name)
    const prefs = appSettingsStore.app.nodePreferences
    prefs.favorites = favoriteKeys.value.has(key)
      ? prefs.favorites.filter((entry) => entry !== key)
      : [...prefs.favorites, key]
  }
  const isFavorite = (name: string) =>
    favoriteKeys.value.has(kernelApiStore.getNodePreferenceKey(name))
  return { isFavorite, toggleFavorite }
}
