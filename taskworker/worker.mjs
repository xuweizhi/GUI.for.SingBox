import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import readline from 'node:readline'

const execFileAsync = promisify(execFile)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

globalThis.window = globalThis
globalThis.AsyncFunction = AsyncFunction

const toBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return Buffer.from(String(value ?? ''))
}

class WorkerBlob {
  constructor(parts = [], options = {}) {
    this.buffer = Buffer.concat(parts.map(toBuffer))
    this.type = options.type || 'application/octet-stream'
  }

  async text() {
    return this.buffer.toString('utf8')
  }

  async arrayBuffer() {
    return this.buffer.buffer.slice(
      this.buffer.byteOffset,
      this.buffer.byteOffset + this.buffer.byteLength,
    )
  }
}

const nativeCreateObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL)
const nativeRevokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)
globalThis.Blob = WorkerBlob
if (globalThis.URL) {
  globalThis.URL.createObjectURL = (value) => {
    if (value instanceof WorkerBlob) {
      return `data:${value.type};base64,${value.buffer.toString('base64')}`
    }
    if (!nativeCreateObjectURL) {
      throw new Error('URL.createObjectURL is not available')
    }
    return nativeCreateObjectURL(value)
  }
  globalThis.URL.revokeObjectURL = (value) => {
    if (typeof value === 'string' && value.startsWith('data:')) {
      return
    }
    nativeRevokeObjectURL?.(value)
  }
}

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const withBrowserLikeGlobals = async (fn) => {
  const hasProcess = Object.prototype.hasOwnProperty.call(globalThis, 'process')
  const previousProcess = globalThis.process
  try {
    globalThis.process = undefined
    return await fn()
  } finally {
    if (hasProcess) {
      globalThis.process = previousProcess
    } else {
      delete globalThis.process
    }
  }
}

const state = {
  basePath: process.cwd(),
  env: {},
}

const supportedTypes = ['run::script', 'run::plugin']

const reply = (id, result = null, error = '') => {
  process.stdout.write(
    JSON.stringify({
      type: 'response',
      id,
      result,
      error,
    }) + '\n',
  )
}

const failMessage = (error) => {
  if (error instanceof Error) {
    return error.message || error.toString()
  }
  return String(error)
}

const resolvePath = (target = '') => {
  if (!target) return state.basePath
  return path.isAbsolute(target) ? path.normalize(target) : path.join(state.basePath, target)
}

const ensureParentDir = async (target) => {
  await mkdir(path.dirname(target), { recursive: true })
}

const toHeaderObject = (headers) => {
  const result = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

const normalizeResponseBody = async (response, autoTransformBody = true) => {
  const text = await response.text()
  if (!autoTransformBody) return text

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return text
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const request = async (options = {}) => {
  const method = (options.method || 'GET').toUpperCase()
  const headers = { ...(options.headers || {}) }
  const timeout = Number(options.options?.Timeout || 15) * 1000
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(timeout),
  }

  let url = options.url || ''
  let body = options.body ?? ''
  const contentType = String(headers['Content-Type'] || headers['content-type'] || '')

  if (['GET', 'HEAD', 'DELETE'].includes(method)) {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const query = new URLSearchParams(body).toString()
      if (query) {
        url += (url.includes('?') ? '&' : '?') + query
      }
    }
  } else if (body !== undefined && body !== null) {
    if (contentType.includes('application/json') && typeof body !== 'string') {
      body = JSON.stringify(body)
    } else if (
      contentType.includes('application/x-www-form-urlencoded') &&
      typeof body !== 'string' &&
      body &&
      typeof body === 'object'
    ) {
      body = new URLSearchParams(body).toString()
    }
    init.body = typeof body === 'string' ? body : String(body)
  }

  const response = await fetch(url, init)
  return {
    status: response.status,
    headers: toHeaderObject(response.headers),
    body: await normalizeResponseBody(response, options.autoTransformBody !== false),
  }
}

const resolveExecPath = (command = '') => {
  if (!command) return command
  if (path.isAbsolute(command)) {
    return resolvePath(command)
  }
  return command
}

const notSupported = (name) => {
  throw new Error(`${name} is not supported by the node scheduled-task worker yet`)
}

const plugins = new Proxy(
  {
    YAML: {
      parse: (value) => JSON.parse(String(value || 'null')),
      stringify: (value) => JSON.stringify(value, null, 2),
    },
    APP_TITLE: state.env.appName || 'GUI.for.SingBox',
    message: {
      success: (...args) => console.info(...args),
      info: (...args) => console.info(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
    },
    AbsolutePath: async (target) => resolvePath(target),
    FileExists: async (target) => {
      try {
        await access(resolvePath(target))
        return true
      } catch {
        return false
      }
    },
    ReadFile: async (target, options = {}) => {
      const mode = options.Mode || 'Text'
      const buffer = await readFile(resolvePath(target))
      return mode === 'Binary' ? buffer.toString('base64') : buffer.toString('utf8')
    },
    WriteFile: async (target, content, options = {}) => {
      const mode = options.Mode || 'Text'
      const resolved = resolvePath(target)
      await ensureParentDir(resolved)
      const payload =
        mode === 'Binary' ? Buffer.from(String(content || ''), 'base64') : String(content || '')
      await writeFile(resolved, payload)
      return 'Success'
    },
    MoveFile: async (source, target) => {
      const resolvedTarget = resolvePath(target)
      await ensureParentDir(resolvedTarget)
      await rename(resolvePath(source), resolvedTarget)
      return 'Success'
    },
    RemoveFile: async (target) => {
      await rm(resolvePath(target), { recursive: true, force: true })
      return 'Success'
    },
    CopyFile: async (source, target) => {
      const resolvedTarget = resolvePath(target)
      await ensureParentDir(resolvedTarget)
      await copyFile(resolvePath(source), resolvedTarget)
      return 'Success'
    },
    MakeDir: async (target) => {
      await mkdir(resolvePath(target), { recursive: true })
      return 'Success'
    },
    ReadDir: async (target) => {
      const entries = await readdir(resolvePath(target), { withFileTypes: true })
      return Promise.all(
        entries.map(async (entry) => {
          const info = await stat(path.join(resolvePath(target), entry.name))
          return {
            name: entry.name,
            size: info.size,
            isDir: entry.isDirectory(),
          }
        }),
      )
    },
    GetEnv: async (key = '') => {
      if (!key) return state.env
      return process.env[key] || ''
    },
    Exec: async (command, args = [], options = {}) => {
      const cwd = options.WorkingDirectory ? resolvePath(options.WorkingDirectory) : state.basePath
      const env = { ...process.env, ...(options.Env || {}) }
      const { stdout, stderr } = await execFileAsync(resolveExecPath(command), args, {
        cwd,
        env,
        maxBuffer: 10 * 1024 * 1024,
      })
      return `${stdout}${stderr}`.trim()
    },
    Requests: request,
    HttpGet: async (url, headers = {}, options = {}) =>
      request({ method: 'GET', url, headers, options, autoTransformBody: true }),
    HttpHead: async (url, headers = {}, options = {}) =>
      request({ method: 'HEAD', url, headers, options, autoTransformBody: false }),
    HttpDelete: async (url, headers = {}, options = {}) =>
      request({ method: 'DELETE', url, headers, options, autoTransformBody: true }),
    HttpPut: async (url, headers = {}, body = {}, options = {}) =>
      request({ method: 'PUT', url, headers, body, options, autoTransformBody: true }),
    HttpPost: async (url, headers = {}, body = {}, options = {}) =>
      request({ method: 'POST', url, headers, body, options, autoTransformBody: true }),
    HttpPatch: async (url, headers = {}, body = {}, options = {}) =>
      request({ method: 'PATCH', url, headers, body, options, autoTransformBody: true }),
    Download: async (method, url, target, headers = {}, _event = '', options = {}) => {
      const timeout = Number(options.Timeout || 20 * 60) * 1000
      const response = await fetch(url, {
        method: (method || 'GET').toUpperCase(),
        headers,
        signal: AbortSignal.timeout(timeout),
      })
      const body = Buffer.from(await response.arrayBuffer())
      const resolvedTarget = resolvePath(target)
      await ensureParentDir(resolvedTarget)
      await writeFile(resolvedTarget, body)
      return {
        status: response.status,
        headers: toHeaderObject(response.headers),
        body: 'Success',
      }
    },
  },
  {
    get(target, property) {
      if (property in target) {
        return target[property]
      }
      return () => notSupported(`Plugins.${String(property)}`)
    },
  },
)

globalThis.Plugins = plugins

const normalizeScriptResult = (result) => {
  if (typeof result === 'string') return result
  if (result === undefined) return 'Success'
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

const runScriptTask = async (task) => {
  try {
    const result = await new AsyncFunction(task.script || '')()
    if (Array.isArray(result)) {
      return result
    }
    return [{ ok: true, result: normalizeScriptResult(result) }]
  } catch (error) {
    return [{ ok: false, result: failMessage(error) }]
  }
}

const resolvePluginHandler = async (plugin, handlerName, pluginSettings = {}) => {
  const { module, pluginContext } = await withBrowserLikeGlobals(() =>
    loadPluginModule(plugin, pluginSettings[plugin.id] || {}),
  )
  const moduleDefault =
    typeof module.default === 'function'
      ? await withBrowserLikeGlobals(() => module.default(pluginContext))
      : module.default
  const handler = moduleDefault?.[handlerName] || module[handlerName]
  if (typeof handler !== 'function') {
    throw new Error(`${handlerName} is not defined`)
  }
  return {
    handler: (...args) => withBrowserLikeGlobals(() => handler(...args)),
    pluginContext,
  }
}

const buildPluginContext = (plugin, pluginSettings = {}) => {
  const configuration = {}
  for (const item of plugin.configuration || []) {
    configuration[item.key] = item.value
  }
  return {
    ...plugin,
    ...configuration,
    ...pluginSettings,
  }
}

const transformPluginSource = (code) =>
  code
    .replace(/^const\s+(on[A-Z]\w*)\b/gm, 'export const $1')
    .replace(/^function\s+(on[A-Z]\w*)\b/gm, 'export function $1')
    .replace(/^async\s+function\s+(on[A-Z]\w*)\b/gm, 'export async function $1')

const loadPluginModule = async (plugin, pluginSettings = {}) => {
  const code = await readFile(resolvePath(plugin.path), 'utf8').catch(() => '')
  const pluginContext = buildPluginContext(plugin, pluginSettings)
  globalThis.__GUI_FOR_CORES_PLUGIN_CONTEXT__ ||= {}
  globalThis.__GUI_FOR_CORES_PLUGIN_CONTEXT__[plugin.id] = pluginContext

  const source = [
    `const Plugin = globalThis.__GUI_FOR_CORES_PLUGIN_CONTEXT__?.[${JSON.stringify(plugin.id)}]`,
    transformPluginSource(code),
    `//# sourceURL=${plugin.path}`,
  ].join('\n')
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

  try {
    const module = await import(dataUrl)
    return { module, pluginContext }
  } finally {
    if (globalThis.__GUI_FOR_CORES_PLUGIN_CONTEXT__) {
      delete globalThis.__GUI_FOR_CORES_PLUGIN_CONTEXT__[plugin.id]
    }
  }
}

const runPluginTask = async (task, pluginList = [], pluginSettings = {}) => {
  const result = []
  const pluginUpdates = []

  for (const pluginId of task.plugins || []) {
    const plugin = pluginList.find((item) => item.id === pluginId)
    if (!plugin) {
      result.push({ ok: false, result: `${pluginId} Not Found` })
      continue
    }
    if (plugin.disabled) {
      result.push({ ok: false, result: `${plugin.name} is Disabled` })
      continue
    }
    if (plugin.hasUI) {
      result.push({ ok: false, result: `${plugin.name} requires UI and is not supported by the node worker` })
      continue
    }

    try {
      const { handler, pluginContext } = await resolvePluginHandler(plugin, 'onTask', pluginSettings)
      const exitCode = await handler()
      if (typeof exitCode === 'number' && exitCode !== plugin.status) {
        pluginUpdates.push({ id: plugin.id, status: exitCode })
      } else if (typeof pluginContext.status === 'number' && pluginContext.status !== plugin.status) {
        pluginUpdates.push({ id: plugin.id, status: pluginContext.status })
      }

      result.push({ ok: true, result: `Plugin [${plugin.name}] executed successfully.` })
    } catch (error) {
      result.push({ ok: false, result: `${plugin.name} : ${failMessage(error)}` })
    }
  }

  return { result, pluginUpdates }
}

const applySubscriptionPlugins = async (payload = {}, pluginList = [], pluginSettings = {}) => {
  let proxies = Array.isArray(payload.proxies) ? payload.proxies : []
  const subscription = cloneValue(payload.subscription || {})

  for (const plugin of pluginList) {
    if (!plugin || plugin.disabled) continue

    const { handler } = await resolvePluginHandler(plugin, 'onSubscribe', pluginSettings)
    const nextProxies = await handler(cloneValue(proxies), cloneValue(subscription))
    if (!Array.isArray(nextProxies)) {
      throw new Error(`${plugin.name} : Wrong result`)
    }
    proxies = nextProxies
  }

  return proxies
}

const runSubscriptionScript = async (payload = {}) => {
  const proxies = Array.isArray(payload.proxies) ? cloneValue(payload.proxies) : []
  const subscription = cloneValue(payload.subscription || {})
  const script = String(payload.script || '').trim()

  if (!script) {
    return { proxies, subscription }
  }

  const fn = new AsyncFunction(
    'proxies',
    'subscription',
    `${script}; return await onSubscribe(proxies, subscription)`,
  )
  const result = await fn(proxies, subscription)
  if (!result || typeof result !== 'object' || !Array.isArray(result.proxies)) {
    throw new Error('subscription script returned invalid result')
  }

  return {
    proxies: result.proxies,
    subscription: result.subscription || subscription,
  }
}

const runTask = async (task, pluginList = [], pluginSettings = {}) => {
  switch (task.type) {
    case 'run::script':
      return runScriptTask(task)
    case 'run::plugin':
      return runPluginTask(task, pluginList, pluginSettings)
    default:
      return [{ ok: false, result: `Unsupported scheduled task type: ${task.type}` }]
  }
}

const handleRequest = async (message) => {
  switch (message.method) {
    case 'worker.init': {
      state.basePath = message.params?.basePath || state.basePath
      state.env = message.params?.env || {}
      return { success: true }
    }
    case 'worker.info':
      return { supportedTypes }
    case 'task.run':
      return runTask(
        message.params?.task || {},
        message.params?.plugins || [],
        message.params?.pluginSettings || {},
      )
    case 'subscription.applyPlugins':
      return applySubscriptionPlugins(
        message.params || {},
        message.params?.plugins || [],
        message.params?.pluginSettings || {},
      )
    case 'subscription.runScript':
      return runSubscriptionScript(message.params || {})
    case 'worker.shutdown':
      setTimeout(() => process.exit(0), 0)
      return { success: true }
    default:
      throw new Error(`Unknown worker method: ${message.method}`)
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', async (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch (error) {
    console.error(`invalid worker message: ${failMessage(error)}`)
    return
  }

  if (message.type !== 'request') return

  try {
    const result = await handleRequest(message)
    reply(message.id, result, '')
  } catch (error) {
    reply(message.id, null, failMessage(error))
  }
})

process.on('uncaughtException', (error) => {
  console.error(`uncaughtException: ${failMessage(error)}`)
})

process.on('unhandledRejection', (error) => {
  console.error(`unhandledRejection: ${failMessage(error)}`)
})
