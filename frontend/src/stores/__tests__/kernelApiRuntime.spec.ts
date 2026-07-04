import { describe, expect, it } from 'vitest'

import {
  getProxyProfileOptionsFromRuntime,
  resolveRuntimeInboundState,
} from '@/stores/kernelApiRuntime'

describe('kernelApi runtime helpers', () => {
  it('treats inbounds without an explicit enable flag as active runtime ports', () => {
    const inbounds = [
      {
        type: 'mixed',
        tag: 'mixed-in',
        mixed: {
          listen: {
            listen: '127.0.0.1',
            listen_port: 20122,
          },
          users: ['alice:secret'],
        },
      },
    ]

    expect(resolveRuntimeInboundState(inbounds)).toMatchObject({
      mixedPort: 20122,
      httpPort: 0,
      socksPort: 0,
      allowLan: false,
    })

    expect(getProxyProfileOptionsFromRuntime(inbounds, 'mixed')).toEqual({
      host: '127.0.0.1',
      username: 'alice',
      password: 'secret',
    })
  })

  it('ignores inbounds explicitly marked as disabled', () => {
    const inbounds = [
      {
        enable: false,
        type: 'mixed',
        tag: 'mixed-in',
        mixed: {
          listen: {
            listen: '0.0.0.0',
            listen_port: 20122,
          },
        },
      },
      {
        enable: false,
        type: 'http',
        tag: 'http-in',
        http: {
          listen: {
            listen: '127.0.0.1',
            listen_port: 20123,
          },
        },
      },
    ]

    expect(resolveRuntimeInboundState(inbounds)).toMatchObject({
      mixedPort: 0,
      httpPort: 0,
      socksPort: 0,
      allowLan: false,
    })
  })

  it('reads flattened runtime inbound structures from the generated sing-box config', () => {
    const inbounds = [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: 20122,
        users: ['alice:secret'],
      },
    ]

    expect(resolveRuntimeInboundState(inbounds)).toMatchObject({
      mixedPort: 20122,
      httpPort: 0,
      socksPort: 0,
      allowLan: false,
    })

    expect(getProxyProfileOptionsFromRuntime(inbounds, 'mixed')).toEqual({
      host: '127.0.0.1',
      username: 'alice',
      password: 'secret',
    })
  })
})
