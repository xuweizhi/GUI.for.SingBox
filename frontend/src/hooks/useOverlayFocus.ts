import { onMounted, onUnmounted, type Ref } from 'vue'

const dialogs: HTMLElement[] = []
export const hasActiveOverlay = () => dialogs.length > 0
const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useOverlayFocus(dialog: Ref<HTMLElement | null>, close: () => void) {
  const previous = document.activeElement as HTMLElement | null
  let element: HTMLElement | null = null

  const onKeydown = (event: KeyboardEvent) => {
    if (!element || dialogs.at(-1) !== element || event.isComposing) return
    if (event.key === 'Escape') {
      event.stopImmediatePropagation()
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(element.querySelectorAll<HTMLElement>(selector)).filter(
      (item) => item.tabIndex >= 0 && !item.closest('[hidden], [aria-disabled="true"]'),
    )
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (index === -1 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
      event.preventDefault()
      const next = event.shiftKey ? items.at(-1) : items[0]
      if (next) next.focus()
      else element.focus()
    }
  }

  onMounted(() => {
    element = dialog.value
    if (!element) return
    dialogs.push(element)
    if (!element.contains(document.activeElement)) element.focus()
    window.addEventListener('keydown', onKeydown, true)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown, true)
    if (!element) return
    const top = dialogs.at(-1) === element
    dialogs.splice(dialogs.indexOf(element), 1)
    if (top && previous?.isConnected) previous.focus()
  })
}
