import { FontPresetOptions, MaxCustomFontPresets } from '@/constant/app'

const MAX_FONT_STYLESHEET_URL_LENGTH = 2048

export const normalizeFontStylesheetUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_FONT_STYLESHEET_URL_LENGTH) return undefined
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !/[\r\n]/.test(trimmed)) {
    return trimmed
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString()
  } catch {
    return undefined
  }
  return undefined
}

export const normalizeCustomFontPresets = (raw: unknown): App.CustomFontPreset[] => {
  if (!Array.isArray(raw)) return []
  const seenIds = new Set<string>()
  const seenFamilies = new Set<string>()
  const result: App.CustomFontPreset[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 32) : ''
    const fontFamily =
      typeof record.fontFamily === 'string' ? record.fontFamily.trim().slice(0, 240) : ''
    if (!label || !fontFamily || seenFamilies.has(fontFamily)) continue

    let id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim().slice(0, 48)
        : `font-${result.length + 1}`
    while (seenIds.has(id)) id = `${id}-${result.length + 1}`
    seenIds.add(id)
    seenFamilies.add(fontFamily)

    const stylesheetUrl = normalizeFontStylesheetUrl(record.stylesheetUrl)
    result.push(
      stylesheetUrl ? { id, label, fontFamily, stylesheetUrl } : { id, label, fontFamily },
    )
    if (result.length >= MaxCustomFontPresets) break
  }

  return result
}

export const createCustomFontPresetId = (existing: readonly App.CustomFontPreset[]): string => {
  const taken = new Set(existing.map((item) => item.id))
  let index = existing.length + 1
  while (taken.has(`custom-font-${index}`)) index += 1
  return `custom-font-${index}`
}

export const suggestFontPresetLabel = (fontFamily: string): string => {
  const first = fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
  return first.slice(0, 32)
}

export const matchedFontPresetKey = (
  fontFamily: string,
  customPresets: readonly App.CustomFontPreset[] = [],
): string => {
  const builtin = FontPresetOptions.find((opt) => opt.value === fontFamily)
  if (builtin) return builtin.key
  const custom = customPresets.find((opt) => opt.fontFamily === fontFamily)
  if (custom) return `preset:${custom.id}`
  return 'custom'
}

export const syncCustomFontStylesheets = (presets: readonly App.CustomFontPreset[]): void => {
  if (typeof document === 'undefined' || !document.head) return
  const desired = new Set(
    presets
      .map((item) => normalizeFontStylesheetUrl(item.stylesheetUrl))
      .filter((url): url is string => Boolean(url)),
  )
  const existing = document.head.querySelectorAll<HTMLLinkElement>('link[data-gfs-font-css="1"]')
  const present = new Set<string>()

  existing.forEach((link) => {
    const href = link.getAttribute('data-gfs-font-href') ?? link.href
    if (!desired.has(href)) {
      link.remove()
    } else {
      present.add(href)
    }
  })

  desired.forEach((href) => {
    if (present.has(href)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.gfsFontCss = '1'
    link.dataset.gfsFontHref = href
    document.head.appendChild(link)
  })
}
