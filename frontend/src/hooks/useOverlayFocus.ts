import { onMounted, onUnmounted, type Ref } from 'vue'

interface OverlayEntry {
  element: HTMLElement
  previous: HTMLElement | null
}

const dialogs: OverlayEntry[] = []
export const hasActiveOverlay = () => dialogs.length > 0
const selector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isVisibleFocusable = (item: HTMLElement) => {
  if (item.tabIndex < 0) return false
  if (item.closest('[hidden], [aria-disabled="true"], [inert], fieldset[disabled]')) return false
  const style = window.getComputedStyle(item)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return item.offsetParent !== null || style.position === 'fixed' || item === document.activeElement
}

export function useOverlayFocus(dialog: Ref<HTMLElement | null>, close: () => void) {
  const previous = document.activeElement as HTMLElement | null
  let entry: OverlayEntry | null = null

  const onKeydown = (event: KeyboardEvent) => {
    if (!entry || dialogs.at(-1) !== entry || event.isComposing) return
    if (event.key === 'Escape') {
      event.stopImmediatePropagation()
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(entry.element.querySelectorAll<HTMLElement>(selector)).filter(
      isVisibleFocusable,
    )
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (index === -1 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
      event.preventDefault()
      const next = event.shiftKey ? items.at(-1) : items[0]
      if (next) next.focus()
      else entry.element.focus()
    }
  }

  onMounted(() => {
    const element = dialog.value
    if (!element) return
    entry = { element, previous }
    dialogs.push(entry)
    if (!element.contains(document.activeElement)) element.focus()
    window.addEventListener('keydown', onKeydown, true)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown, true)
    if (!entry) return
    const idx = dialogs.indexOf(entry)
    const isTop = idx === dialogs.length - 1
    if (idx !== -1) dialogs.splice(idx, 1)
    if (isTop) {
      if (entry.previous?.isConnected) {
        entry.previous.focus()
      } else {
        const fallback = dialogs.at(-1)?.element
        if (fallback?.isConnected) fallback.focus()
      }
    }
  })
}
