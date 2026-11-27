import { describe, expect, it } from 'vitest'

import {
  buildSingBoxOutbound,
  DefaultCustomNodeDraft,
  outboundToCustomNodeDraft,
  parseCustomNodeUri,
} from '@/utils/customNode'

describe('customNode URI parser and sing-box outbound builder', () => {
  it('parses socks5://user:pass@host:port and builds valid sing-box socks outbound', () => {
    const parsed = parseCustomNodeUri('socks5://demoUser:demoPass@209.227.81.152:443')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.missingFields).toEqual([])
    expect(parsed.draft.protocol).toBe('socks')
    expect(parsed.draft.socksVersion).toBe('5')
    expect(parsed.draft.server).toBe('209.227.81.152')
    expect(parsed.draft.server_port).toBe(443)
    expect(parsed.draft.username).toBe('demoUser')
    expect(parsed.draft.password).toBe('demoPass')
    expect(parsed.draft.tag).toBe('SOCKS5-209.227.81.152:443')

    const built = buildSingBoxOutbound(parsed.draft)
    expect(built).toEqual({
      ok: true,
      outbound: {
        type: 'socks',
        tag: 'SOCKS5-209.227.81.152:443',
        server: '209.227.81.152',
        server_port: 443,
        version: '5',
        username: 'demoUser',
        password: 'demoPass',
      },
    })
  })

  it('parses base64 socks:// userinfo and detects missing required fields when port is omitted', () => {
    const b64 = btoa('alice:secret')
    const parsed = parseCustomNodeUri(`socks://${b64}@198.51.100.10:1080#My%20Relay`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.draft.username).toBe('alice')
    expect(parsed.draft.password).toBe('secret')
    expect(parsed.draft.tag).toBe('My Relay')

    const missingPort = parseCustomNodeUri('socks5://198.51.100.10')
    expect(missingPort.ok).toBe(true)
    if (!missingPort.ok) return
    expect(missingPort.missingFields).toContain('server_port')
    const buildFailed = buildSingBoxOutbound(missingPort.draft)
    expect(buildFailed.ok).toBe(false)
    if (!buildFailed.ok) expect(buildFailed.field).toBe('server_port')
  })

  it('parses vless reality, trojan ws, shadowsocks, vmess, http(s), and hysteria2 URIs accurately', () => {
    const vless = parseCustomNodeUri(
      'vless://11111111-1111-1111-1111-111111111111@vless.example:443?security=reality&sni=www.apple.com&fp=chrome&pbk=PUBKEY&sid=abcd&flow=xtls-rprx-vision#VLESS-HK',
    )
    expect(vless.ok).toBe(true)
    if (vless.ok) {
      const built = buildSingBoxOutbound(vless.draft)
      expect(built).toEqual({
        ok: true,
        outbound: {
          type: 'vless',
          tag: 'VLESS-HK',
          server: 'vless.example',
          server_port: 443,
          uuid: '11111111-1111-1111-1111-111111111111',
          flow: 'xtls-rprx-vision',
          tls: {
            enabled: true,
            server_name: 'www.apple.com',
            utls: { enabled: true, fingerprint: 'chrome' },
            reality: { enabled: true, public_key: 'PUBKEY', short_id: 'abcd' },
          },
        },
      })
    }

    const ss = parseCustomNodeUri(`ss://${btoa('aes-256-gcm:pass123')}@ss.example:8388#SS-1`)
    expect(ss.ok).toBe(true)
    if (ss.ok) {
      expect(buildSingBoxOutbound(ss.draft)).toEqual({
        ok: true,
        outbound: {
          type: 'shadowsocks',
          tag: 'SS-1',
          server: 'ss.example',
          server_port: 8388,
          method: 'aes-256-gcm',
          password: 'pass123',
        },
      })
    }

    const hy2 = parseCustomNodeUri(
      'hy2://mysecret@hy.example:8443?sni=hy.example&insecure=1&obfs=salamander&obfs-password=obfspw#HY2-JP',
    )
    expect(hy2.ok).toBe(true)
    if (hy2.ok) {
      expect(buildSingBoxOutbound(hy2.draft)).toEqual({
        ok: true,
        outbound: {
          type: 'hysteria2',
          tag: 'HY2-JP',
          server: 'hy.example',
          server_port: 8443,
          password: 'mysecret',
          obfs: { type: 'salamander', password: 'obfspw' },
          tls: { enabled: true, server_name: 'hy.example', insecure: true },
        },
      })
    }

    const vmessPayload = btoa(
      JSON.stringify({
        ps: 'VMess-SG',
        add: 'vm.example',
        port: 443,
        id: '22222222-2222-2222-2222-222222222222',
        aid: 0,
        net: 'ws',
        path: '/ws',
        host: 'cdn.example',
        tls: 'tls',
        sni: 'cdn.example',
      }),
    )
    const vmess = parseCustomNodeUri(`vmess://${vmessPayload}`)
    expect(vmess.ok).toBe(true)
    if (vmess.ok) {
      expect(buildSingBoxOutbound(vmess.draft)).toEqual({
        ok: true,
        outbound: {
          type: 'vmess',
          tag: 'VMess-SG',
          server: 'vm.example',
          server_port: 443,
          uuid: '22222222-2222-2222-2222-222222222222',
          security: 'auto',
          alter_id: 0,
          tls: { enabled: true, server_name: 'cdn.example' },
          transport: { type: 'ws', path: '/ws', headers: { Host: 'cdn.example' } },
        },
      })
    }
  })

  it('roundtrips existing sing-box outbounds through outboundToCustomNodeDraft', () => {
    const original = {
      type: 'trojan',
      tag: 'TJ-1',
      server: 'tj.example',
      server_port: 443,
      password: 'pw',
      tls: { enabled: true, server_name: 'tj.example' },
      transport: { type: 'grpc', service_name: 'grpcSvc' },
    }
    const draft = outboundToCustomNodeDraft(original)
    expect(draft).not.toBeNull()
    expect(buildSingBoxOutbound(draft!)).toEqual({ ok: true, outbound: original })

    const empty = DefaultCustomNodeDraft('trojan')
    const missing = buildSingBoxOutbound(empty)
    expect(missing.ok).toBe(false)
  })
})
