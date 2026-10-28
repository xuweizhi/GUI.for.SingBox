import { describe, expect, it } from 'vitest'

import { explainCoreConfigCheckError } from '@/utils/coreConfigValidation'

const config = {
  endpoints: [
    { tag: 'Office mesh', type: 'tailscale', auth_key: 'secret-auth-key', state_directory: '/private/state' },
    { tag: 'Private tunnel', type: 'wireguard', private_key: 'secret-private-key', peers: [{ public_key: 'secret-public-key' }] },
  ],
  outbounds: [{ tag: 'Imported VPN', type: 'openvpn', password: 'secret-password', username: 'secret-username' }],
  experimental: { clash_api: { secret: 'secret-controller-key' } },
}

describe('core configuration validation errors', () => {
  it('annotates the exact endpoint index from the selected core and preserves its original error', () => {
    const original = new Error('decode config: endpoints[1]: json: unknown field "future_field"')
    const result = explainCoreConfigCheckError(original, config) as Error

    expect(result.message).toContain(original.message)
    expect(result.cause).toBe(original)
    expect(result.message).toContain('endpoints[1] "Private tunnel" (wireguard)')
    expect(result.message).not.toContain('Office mesh')
    expect(result.message).toContain('Update or switch to a core build')
  })

  it('recognizes singular initialization paths and gives a configuration hint', () => {
    const original = 'initialize endpoint[0]: missing control URL'
    const result = explainCoreConfigCheckError(original, config) as Error

    expect(result.message).toContain('endpoints[0] "Office mesh" (tailscale)')
    expect(result.message).toContain('Check this node configuration')
    expect(result.cause).toBe(original)
  })

  it.each([
    ['unknown endpoint type: tailscale', 'endpoints[0] "Office mesh" (tailscale)'],
    ['unknown outbound type: openvpn', 'outbounds[0] "Imported VPN" (openvpn)'],
    ['WireGuard is not included in this build, rebuild with -tags with_wireguard', 'endpoints[1] "Private tunnel" (wireguard)'],
  ])('finds node context for the actual binary error: %s', (original, context) => {
    const result = explainCoreConfigCheckError(original, config) as Error

    expect(result.message).toContain(context)
    expect(result.message).toContain('Update or switch to a core build')
    expect(result.message).toContain(original)
  })

  it('explains an older binary rejecting the entire endpoints field without claiming a version requirement', () => {
    const result = explainCoreConfigCheckError('decode config: json: unknown field "endpoints"', config) as Error

    expect(result.message).toContain('endpoints[0] "Office mesh" (tailscale)')
    expect(result.message).toContain('endpoints[1] "Private tunnel" (wireguard)')
    expect(result.message).not.toContain('Imported VPN')
    expect(result.message).not.toMatch(/\b1\.\d+/)
  })

  it('can explain unsupported fields without a parseable config or inventing a node label', () => {
    const result = explainCoreConfigCheckError('json: unknown field "domain_resolver"', undefined) as Error

    expect(result.message).toContain('The selected core rejected a protocol, feature or configuration field.')
    expect(result.message).not.toContain('endpoints[')
  })

  it.each([
    new Error('open /data/core/config.json: permission denied'),
    'open /data/endpoints[0].json: no such file or directory',
    'fork/exec /data/sing-box: executable file not found',
    new Error('Failed to replace staged configuration'),
    { code: 'EIO', reason: 'disk unavailable' },
  ])('does not replace or annotate generic IO/process failures', (original) => {
    expect(explainCoreConfigCheckError(original, config)).toBe(original)
  })

  it('never adds private config fields, credentials or nested objects to an error', () => {
    const result = explainCoreConfigCheckError('json: unknown field "endpoints"', config) as Error

    for (const secret of ['secret-', 'auth_key', 'private_key', 'public_key', 'password', 'username', '/private/state', 'clash_api']) {
      expect(result.message).not.toContain(secret)
    }
  })

  it('limits label length and removes control characters in added context', () => {
    const result = explainCoreConfigCheckError('endpoints[0]: unknown field "extension"', {
      endpoints: [{ type: 'wireguard', tag: `Office\n\u001b[31m${'x'.repeat(300)}` }],
    }) as Error

    expect(result.message).not.toContain('\u001b')
    expect(result.message).not.toContain('Office\n')
    expect(result.message).not.toContain('x'.repeat(161))
  })

  it('does not access arbitrary config object serialization', () => {
    const result = explainCoreConfigCheckError('endpoints[0]: unknown type', {
      endpoints: [{ type: 'wireguard', tag: { toString: () => { throw new Error('do not serialize') } } }],
    }) as Error

    expect(result.message).toContain('endpoints[0] (wireguard)')
  })
})
