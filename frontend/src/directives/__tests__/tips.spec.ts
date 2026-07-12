import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectDirective } from 'vue'

import tips from '@/directives/tips'

const tipsDirective = tips as ObjectDirective

const appStore = vi.hoisted(() => ({
  tipsPosition: { x: 0, y: 0 },
  tipsMessage: '',
  tipsShow: false,
}))

vi.mock('@/stores', () => ({
  useAppStore: () => appStore,
}))

vi.mock('@/utils', () => ({
  debounce: (fn: (...args: unknown[]) => void, wait: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    return (...args: unknown[]) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), wait)
    }
  },
}))

const binding = (value?: string) => ({ value, modifiers: { fast: true } })

describe('v-tips', () => {
  const elements: HTMLElement[] = []

  const mountTips = (value?: string) => {
    const el = document.createElement('button')
    elements.push(el)
    tipsDirective.mounted?.(el, binding(value) as never, null as never, null as never)
    return el
  }

  beforeEach(() => {
    vi.useFakeTimers()
    appStore.tipsMessage = ''
    appStore.tipsShow = false
  })

  afterEach(() => {
    elements.splice(0).forEach((el) =>
      tipsDirective.beforeUnmount?.(el, binding() as never, null as never, null as never),
    )
    vi.useRealTimers()
  })

  it('uses the latest value after repeated updates', () => {
    const el = mountTips()
    tipsDirective.updated?.(el, binding('first error') as never, null as never, null as never)

    el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 10, clientY: 20 }))
    vi.advanceTimersByTime(199)
    expect(appStore.tipsShow).toBe(false)
    vi.advanceTimersByTime(1)
    expect(appStore.tipsMessage).toBe('first error')

    el.dispatchEvent(new MouseEvent('mouseleave'))
    tipsDirective.updated?.(el, binding('second error') as never, null as never, null as never)
    el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 30, clientY: 40 }))
    vi.advanceTimersByTime(200)

    expect(appStore.tipsMessage).toBe('second error')
    expect(appStore.tipsPosition).toEqual({ x: 30, y: 40 })
  })

  it('shows on focus and hides on blur', () => {
    const el = mountTips('keyboard error')

    el.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(200)
    expect(appStore.tipsMessage).toBe('keyboard error')
    expect(appStore.tipsShow).toBe(true)

    el.dispatchEvent(new FocusEvent('blur'))
    expect(appStore.tipsShow).toBe(false)
  })

  it('immediately hides its visible tooltip when the value is cleared', () => {
    const el = mountTips('old error')

    el.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(200)
    expect(appStore.tipsShow).toBe(true)
    expect(appStore.tipsMessage).toBe('old error')

    tipsDirective.updated?.(el, binding() as never, null as never, null as never)

    expect(appStore.tipsShow).toBe(false)
    expect(el.dataset.tipsMessage).toBe('')
    expect(el.dataset.showTips).toBe('false')
  })

  it('keeps the current tooltip visible when a previous element blurs', () => {
    const a = mountTips('error A')
    const b = mountTips('error B')

    a.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(200)
    b.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(200)
    a.dispatchEvent(new FocusEvent('blur'))

    expect(appStore.tipsShow).toBe(true)
    expect(appStore.tipsMessage).toBe('error B')
  })

  it('prevents a previous element pending timer from overwriting the owner', () => {
    const a = mountTips('error A')
    const b = mountTips('error B')

    a.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(100)
    b.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(100)
    expect(appStore.tipsMessage).not.toBe('error A')
    vi.advanceTimersByTime(100)

    expect(appStore.tipsShow).toBe(true)
    expect(appStore.tipsMessage).toBe('error B')
  })

  it('ignores clear and unmount cleanup from a previous element', () => {
    const a = mountTips('error A')
    const b = mountTips('error B')

    a.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(200)
    b.dispatchEvent(new FocusEvent('focus'))
    vi.advanceTimersByTime(200)

    tipsDirective.updated?.(a, binding() as never, null as never, null as never)
    tipsDirective.beforeUnmount?.(a, binding() as never, null as never, null as never)

    expect(appStore.tipsShow).toBe(true)
    expect(appStore.tipsMessage).toBe('error B')

    tipsDirective.beforeUnmount?.(b, binding() as never, null as never, null as never)
    expect(appStore.tipsShow).toBe(false)
  })
})
