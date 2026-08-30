import { onUnmounted } from 'vue'

import * as Stores from '@/stores'

export const useAppLifecycle = () => {
  const appStore = Stores.useAppStore()

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return

    const closeFn = appStore.modalStack.at(-1)
    void Promise.resolve()
      .then(() => closeFn?.())
      .catch((error) => console.error(error))
  }

  window.addEventListener('keydown', handleKeydown)

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
