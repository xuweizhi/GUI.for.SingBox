import { onUnmounted } from 'vue'

import * as Stores from '@/stores'

export const useAppLifecycle = () => {
  const appStore = Stores.useAppStore()

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return

    const closeFn = appStore.modalStack.at(-1)
    if (!closeFn) return
    event.preventDefault()
    void Promise.resolve()
      .then(() => closeFn())
      .catch((error) => console.error(error))
  }

  window.addEventListener('keydown', handleKeydown)

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
