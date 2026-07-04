import proxyUtilsSource from '../vendor/proxy-utils.esm.mjs?raw'

type ProxyUtilsModule = {
  parse: (content: string) => Recordable[]
  produce: (proxies: Recordable[], target: string, mode: string) => unknown
}

type RuntimeWithSubStore = typeof globalThis & {
  $Plugins?: {
    SubStoreCache: {
      get: (key: string) => string
      set: (key: string, value: string) => boolean
    }
  }
}

let proxyUtilsModulePromise: Promise<ProxyUtilsModule> | undefined
const browserProxyUtilsSource = proxyUtilsSource.replace(
  /eval\('typeof process !== "undefined"'\)/g,
  'false',
)

const withMutedConsole = async <T>(fn: () => Promise<T>) => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const previous = methods.map((method) => [method, console[method]] as const)

  methods.forEach((method) => {
    console[method] = () => {}
  })

  try {
    return await fn()
  } finally {
    previous.forEach(([method, handler]) => {
      console[method] = handler
    })
  }
}

const toDataURL = (source: string) => {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return `data:text/javascript;base64,${btoa(binary)}`
}

const withSubStoreGlobals = async <T>(fn: () => Promise<T>) => {
  const runtime = globalThis as RuntimeWithSubStore
  const hadPlugins = Object.prototype.hasOwnProperty.call(runtime, '$Plugins')
  const previousPlugins = runtime.$Plugins

  runtime.$Plugins = {
    SubStoreCache: {
      get: () => '{}',
      set: () => true,
    },
  }

  try {
    return await fn()
  } finally {
    if (hadPlugins) {
      runtime.$Plugins = previousPlugins
    } else {
      delete runtime.$Plugins
    }
  }
}

const loadProxyUtilsModule = () => {
  if (!proxyUtilsModulePromise) {
    proxyUtilsModulePromise = withSubStoreGlobals(async () => {
      return (await import(/* @vite-ignore */ toDataURL(browserProxyUtilsSource))) as ProxyUtilsModule
    })
  }

  return proxyUtilsModulePromise
}

const needsNativeSubscriptionConvert = (proxies: Recordable[]) => {
  return (
    proxies.some((proxy) => proxy?.name && !proxy?.tag) || typeof proxies[0]?.base64 === 'string'
  )
}

export const normalizeSubscriptionProxies = async (proxies: Recordable[]) => {
  let next = proxies.map((proxy) => ({ ...proxy }))
  if (!needsNativeSubscriptionConvert(next)) {
    return next
  }

  const { parse, produce } = await loadProxyUtilsModule()

  next = await withMutedConsole(async () => {
    let converted = next

    if (typeof converted[0]?.base64 === 'string') {
      converted = parse(converted[0].base64)
    }

    if (converted.some((proxy) => proxy?.name && !proxy?.tag)) {
      const produced = produce(converted, 'singbox', 'internal')
      if (!Array.isArray(produced)) {
        throw new Error('Failed to convert subscription data')
      }
      converted = produced
    }

    return converted
  })

  next.forEach((proxy) => {
    delete proxy.domain_resolver
  })

  return next
}
