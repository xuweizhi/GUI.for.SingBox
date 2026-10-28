type NodeKind = 'endpoints' | 'outbounds'
type NodeContext = { kind: NodeKind; index: number; tag?: string; type?: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// Only labels may be added to a core error. Never include node objects or their credentials.
const safeLabel = (value: unknown) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160) : undefined

const getNodes = (config: unknown, kind: NodeKind): unknown[] =>
  isRecord(config) && Array.isArray(config[kind]) ? config[kind] : []

const nodeContext = (config: unknown, kind: NodeKind, index: number): NodeContext => {
  const node = getNodes(config, kind)[index]
  return {
    kind,
    index,
    ...(isRecord(node) ? { tag: safeLabel(node.tag), type: safeLabel(node.type) } : {}),
  }
}

const describeNode = ({ kind, index, tag, type }: NodeContext) =>
  `${kind}[${index}]${tag ? ` ${JSON.stringify(tag)}` : ''}${type ? ` (${type})` : ''}`

const compatibilityFailure =
  /\b(?:unknown|unsupported|unrecognized)\s+(?:(?:endpoint|outbound|inbound|dns(?: server)?)\s+)?(?:type|field|protocol|feature)\b|\b(?:not (?:included|compiled|supported|available)|disabled) in this build\b|\brebuild (?:it )?with\b|\b(?:protocol|feature)\b[^\n]*\bnot supported\b/i

/** Add context only after the selected binary has rejected the staged configuration. */
export const explainCoreConfigCheckError = (error: unknown, config: unknown): unknown => {
  const message = typeof error === 'string'
    ? error
    : isRecord(error) && typeof error.message === 'string' ? error.message : ''
  if (!message || /\b(?:permission denied|no such file or directory|file does not exist|access is denied)\b/i.test(message)) {
    return error
  }

  const contexts: NodeContext[] = []
  const path = message.match(/\b(endpoints?|outbounds?)\s*\[\s*(\d+)\s*\]/i)
  const unsupported = compatibilityFailure.test(message)
  if (path) {
    const kind: NodeKind = path[1]!.toLowerCase().startsWith('endpoint') ? 'endpoints' : 'outbounds'
    contexts.push(nodeContext(config, kind, Number(path[2])))
  } else if (unsupported) {
    const unknownEndpoints = /\bunknown field\s*[:=]?\s*["']endpoints["']/i.test(message)
    const unknownType = message.match(/\b(?:unknown|unsupported|unrecognized)\s+(endpoint|outbound)\s+type\s*[:=]?\s*["']?([a-z0-9_-]+)/i)
    for (const kind of ['endpoints', 'outbounds'] as const) {
      getNodes(config, kind).forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.type !== 'string') return
        const matchesType = unknownType
          ? kind.startsWith(unknownType[1]!.toLowerCase()) && entry.type.toLowerCase() === unknownType[2]!.toLowerCase()
          : /^[a-z][a-z0-9_-]{0,63}$/i.test(entry.type) && new RegExp(`\\b${entry.type}\\b`, 'i').test(message)
        if ((unknownEndpoints && kind === 'endpoints') || matchesType) {
          contexts.push(nodeContext(config, kind, index))
        }
      })
    }
  } else {
    return error
  }

  const context = contexts.length
    ? `Core rejected ${contexts.slice(0, 5).map(describeNode).join(', ')}${contexts.length > 5 ? ` and ${contexts.length - 5} more nodes` : ''}.`
    : 'The selected core rejected a protocol, feature or configuration field.'
  const action = unsupported
    ? 'Update or switch to a core build that supports this protocol and its fields, or change the node configuration to match the selected core.'
    : 'Check this node configuration and the reported field. If the protocol or field is unavailable, update or switch to a core build that supports it.'
  return new Error(`${message}\n\n${context} ${action}`, { cause: error })
}
