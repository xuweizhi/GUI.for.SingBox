import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, request } from 'node:http'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  subscriptions: [] as App.Subscription[],
  files: {} as Record<string, string>,
}))
vi.mock('@/bridge', () => ({
  ReadFile: async (path: string) => fixture.files[path],
  WriteFile: vi.fn(),
}))
vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { branch: 'main' } } }),
  usePluginsStore: () => ({ onGenerateTrigger: async (config: unknown) => config }),
  useNodeGroupsStore: () => ({ nodeGroups: [], getNodeGroupById: () => undefined }),
  useRulesetsStore: () => ({ getRulesetById: () => undefined }),
  useSubscribesStore: () => ({
    subscribes: fixture.subscriptions,
    getSubscribeById: (id: string) => fixture.subscriptions.find((sub) => sub.id === id),
  }),
}))

import {
  DefaultDns,
  DefaultDnsServer,
  DefaultExperimental,
  DefaultInboundMixed,
  DefaultLog,
  DefaultMixin,
  DefaultOutbound,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { DnsServer, Inbound, Outbound } from '@/enums/kernel'
import { generateConfig } from '@/utils/generator'

// Explicit opt-in only. All traffic stays on loopback and all core state is temporary.
const binaries = (process.env.SING_BOX_TEST_BINARIES || '').split(delimiter).filter(Boolean)
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const listen = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return (server.address() as { port: number }).port
}
const stop = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))

const stopCore = async (core?: ChildProcess) => {
  if (!core || core.exitCode !== null || core.signalCode !== null) return
  const stopped = new Promise<void>((resolve) => core.once('exit', () => resolve()))
  core.kill('SIGTERM')
  await Promise.race([stopped, wait(2000)])
  if (core.exitCode === null && core.signalCode === null) {
    core.kill('SIGKILL')
    await stopped
  }
}

const createSocksForwarder = (
  role: string,
  destinationPort: number,
  events: { role: string; host: string; port: number }[],
  sockets: Set<Socket>,
) =>
  createServer((client) => {
    sockets.add(client)
    client.once('close', () => sockets.delete(client))
    client.on('error', () => client.destroy())
    let stage = 'greeting'
    let buffered = Buffer.alloc(0)
    const receive = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      if (stage === 'greeting') {
        if (buffered.length < 2 || buffered.length < 2 + buffered[1]!) return
        if (buffered[0] !== 5) return client.destroy()
        buffered = buffered.subarray(2 + buffered[1]!)
        client.write(Buffer.from([5, 0]))
        stage = 'request'
      }
      if (stage !== 'request' || buffered.length < 4) return
      const kind = buffered[3]
      let host: string
      let size: number
      if (kind === 1) {
        if (buffered.length < 10) return
        host = [...buffered.subarray(4, 8)].join('.')
        size = 10
      } else if (kind === 3) {
        if (buffered.length < 5 || buffered.length < 7 + buffered[4]!) return
        size = 7 + buffered[4]!
        host = buffered.subarray(5, size - 2).toString()
      } else return client.destroy()
      const port = buffered.readUInt16BE(size - 2)
      // The synthetic proxy deliberately refuses every destination except its loopback fixture.
      if (
        buffered[0] !== 5 ||
        buffered[1] !== 1 ||
        host !== '127.0.0.1' ||
        port !== destinationPort
      )
        return client.destroy()
      events.push({ role, host, port })
      const remainder = buffered.subarray(size)
      stage = 'forwarding'
      client.removeListener('data', receive)
      const upstream = createConnection({ host, port })
      sockets.add(upstream)
      upstream.once('close', () => {
        sockets.delete(upstream)
        client.destroy()
      })
      upstream.on('error', () => {
        upstream.destroy()
        client.destroy()
      })
      client.once('close', () => upstream.destroy())
      upstream.once('connect', () => {
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        if (remainder.length) upstream.write(remainder)
        client.pipe(upstream).pipe(client)
      })
    }
    client.on('data', receive)
  })

const waitForCore = async (core: ChildProcess, port: number, output: () => string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (core.exitCode !== null) throw new Error(`Temporary sing-box exited: ${output()}`)
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.setTimeout(100)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (connected) return
    await wait(30)
  }
  throw new Error(`Temporary sing-box did not listen: ${output()}`)
}

const fetchThroughProxy = (port: number, targetPort: number) =>
  new Promise<string>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: `http://127.0.0.1:${targetPort}/payload`,
        headers: { Host: `127.0.0.1:${targetPort}`, Connection: 'close' },
        agent: false,
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.once('end', () =>
          response.statusCode === 200
            ? resolve(body)
            : reject(new Error(`HTTP ${response.statusCode}: ${body}`)),
        )
      },
    )
    req.setTimeout(5000, () => req.destroy(new Error('Loopback chain request timed out')))
    req.once('error', reject)
    req.end()
  })

describe.skipIf(binaries.length === 0)('generated proxy chain loopback traffic', () => {
  it.each(binaries)(
    'carries application traffic and URLtest probes through relay and landing using %s',
    async (binary) => {
      const directory = mkdtempSync(join(tmpdir(), 'gui-chain-traffic-'))
      const sockets = new Set<Socket>()
      const events: { role: string; host: string; port: number }[] = []
      const requests: string[] = []
      const servers: Server[] = []
      let core: ChildProcess | undefined
      let output = ''
      try {
        const target = createHttpServer((req, res) => {
          requests.push(req.url || '')
          res.setHeader('Connection', 'close')
          res.statusCode = req.url === '/probe' ? 204 : 200
          res.end(req.url === '/probe' ? undefined : 'relay -> landing -> target')
        })
        target.on('connection', (socket) => {
          sockets.add(socket)
          socket.once('close', () => sockets.delete(socket))
        })
        servers.push(target)
        const targetPort = await listen(target)
        const landing = createSocksForwarder('landing', targetPort, events, sockets)
        servers.push(landing)
        const landingPort = await listen(landing)
        const relay = createSocksForwarder('relay', landingPort, events, sockets)
        servers.push(relay)
        const relayPort = await listen(relay)
        const reservation = createServer()
        const inboundPort = await listen(reservation)
        await stop(reservation)

        const chain = {
          ...DefaultOutbound(),
          id: 'chain',
          tag: 'Chain',
          type: Outbound.Urltest,
          pre_proxy: 'relay',
          url: `http://127.0.0.1:${targetPort}/probe`,
        }
        chain.outbounds = [{ id: 'landing', tag: 'landing', type: 'Subscription' }]
        const relayGroup = { ...DefaultOutbound(), id: 'relay', tag: 'Relay' }
        relayGroup.outbounds = [{ id: 'relay-sub', tag: 'relay-sub', type: 'Subscription' }]
        const dns = DefaultDns()
        const resolver = {
          ...DefaultDnsServer(),
          id: 'system',
          tag: 'System-DNS-Resolver',
          type: DnsServer.Local,
        }
        dns.servers = [resolver]
        dns.rules = []
        dns.final = resolver.id
        const route = DefaultRoute()
        route.rules = []
        route.rule_set = []
        route.final = chain.id
        route.default_domain_resolver.server = resolver.id
        const experimental = DefaultExperimental()
        experimental.cache_file.enabled = false
        experimental.clash_api.external_controller = ''
        experimental.clash_api.external_ui_download_detour = ''
        const mixed = DefaultInboundMixed()
        mixed.listen.listen_port = inboundPort
        const profile: App.Profile = {
          id: 'traffic',
          name: 'Traffic',
          log: DefaultLog(),
          experimental,
          inbounds: [{ id: 'inbound', type: Inbound.Mixed, tag: 'test-in', enable: true, mixed }],
          outbounds: [chain, relayGroup],
          dns,
          route,
          mixin: DefaultMixin(),
          script: DefaultScript(),
        }
        fixture.subscriptions = ['landing', 'relay-sub'].map(
          (id) => ({ id, name: id, path: id, proxies: [] }) as unknown as App.Subscription,
        )
        fixture.files.landing = JSON.stringify([
          { type: 'socks', tag: 'Landing node', server: '127.0.0.1', server_port: landingPort },
        ])
        fixture.files['relay-sub'] = JSON.stringify([
          { type: 'socks', tag: 'Relay node', server: '127.0.0.1', server_port: relayPort },
        ])
        const config = await generateConfig(profile, {
          enableStableConfigCompat: false,
          enablePluginProcessing: false,
          enableMixinProcessing: false,
          enableScriptProcessing: false,
        })
        const group = config.outbounds.find((entry: Recordable) => entry.tag === 'Chain')
        expect(group.type).toBe('urltest')
        expect(group.outbounds).toHaveLength(1)
        expect(
          config.outbounds.find((entry: Recordable) => entry.tag === group.outbounds[0]),
        ).toMatchObject({ type: 'socks', detour: 'Relay', server_port: landingPort })
        const path = join(directory, 'config.json')
        writeFileSync(path, JSON.stringify(config))
        core = spawn(binary, ['run', '--disable-color', '-c', path, '-D', directory], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        core.stdout?.on('data', (data) => {
          output += data.toString()
        })
        core.stderr?.on('data', (data) => {
          output += data.toString()
        })
        await waitForCore(core, inboundPort, () => output)
        expect(await fetchThroughProxy(inboundPort, targetPort)).toBe('relay -> landing -> target')
        for (let attempt = 0; attempt < 100 && !requests.includes('/probe'); attempt++)
          await wait(30)
        expect(requests, output).toContain('/payload')
        expect(requests, output).toContain('/probe')
        expect(events.filter((event) => event.role === 'relay')).toHaveLength(requests.length)
        expect(events.filter((event) => event.role === 'landing')).toHaveLength(requests.length)
        expect(
          events.every(
            (event) =>
              event.host === '127.0.0.1' &&
              event.port === (event.role === 'relay' ? landingPort : targetPort),
          ),
        ).toBe(true)
      } finally {
        await stopCore(core)
        sockets.forEach((socket) => socket.destroy())
        await Promise.all(servers.map(stop))
        rmSync(directory, { recursive: true, force: true })
      }
    },
    20_000,
  )
})
