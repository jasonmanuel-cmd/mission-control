import { describe, it, expect, vi } from 'vitest'
import { getExpiry, EXPIRY_TTL_MS, type ExpiryDeps } from './check'
import type { SiteExpiry, ExpiryCache } from './cache'
import type { ExpiryPart } from './parts'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const site = { id: 'a', url: 'https://www.example.com/path' }
const okPart = (days: number): ExpiryPart => ({ status: 'ok', detail: `in ${days}`, days })
const nodata = (detail = 'x'): ExpiryPart => ({ status: 'nodata', detail })
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

function deps(over: Partial<ExpiryDeps> = {}): ExpiryDeps {
  return {
    checkSSL: vi.fn().mockResolvedValue({ hostname: 'example.com', valid: true, daysRemaining: 90, validTo: new Date(NOW + 90 * 86400_000).toISOString() }),
    checkDomain: vi.fn().mockResolvedValue(okPart(300)),
    cache: undefined,
    now: () => NOW,
    ...over,
  }
}

function memCache(initial?: SiteExpiry): ExpiryCache & { set: any; get: any } {
  let value = initial ?? null
  return {
    get: vi.fn(async (_id: string, maxAge: number, now: number) => (value && now - Date.parse(value.checkedAt) <= maxAge ? value : null)),
    set: vi.fn(async (_id: string, v: SiteExpiry) => { value = v }),
  }
}

describe('getExpiry', () => {
  it('TTL is 12 hours', () => {
    expect(EXPIRY_TTL_MS).toBe(12 * 3600_000)
  })

  it('a fresh cache hit returns it without any lookup', async () => {
    const cached: SiteExpiry = { ssl: okPart(50), domain: okPart(200), checkedAt: new Date(NOW - 3600_000).toISOString() }
    const d = deps({ cache: memCache(cached) })
    expect(await getExpiry(site, d)).toEqual(cached)
    expect(d.checkSSL).not.toHaveBeenCalled()
    expect(d.checkDomain).not.toHaveBeenCalled()
  })

  it('a stale cache runs both lookups and stores the result', async () => {
    const stale: SiteExpiry = { ssl: okPart(50), domain: okPart(200), checkedAt: new Date(NOW - 13 * 3600_000).toISOString() }
    const cache = memCache(stale)
    const r = await getExpiry(site, deps({ cache }))
    expect(r.ssl.days).toBe(90)
    expect(cache.set).toHaveBeenCalledWith('a', r)
  })

  it('passes the bare host (no scheme or path) to both lookups', async () => {
    const d = deps()
    await getExpiry(site, d)
    expect(d.checkSSL).toHaveBeenCalledWith('www.example.com')
    expect(d.checkDomain).toHaveBeenCalledWith('www.example.com')
  })

  it('runs the two lookups in parallel', async () => {
    const d = deps({
      checkSSL: vi.fn().mockImplementation(async () => { await delay(70); return { hostname: 'x', valid: true, daysRemaining: 1, validTo: new Date(NOW + 86400_000).toISOString() } }),
      checkDomain: vi.fn().mockImplementation(async () => { await delay(70); return okPart(1) }),
    })
    const t0 = Date.now()
    await getExpiry(site, d)
    expect(Date.now() - t0).toBeLessThan(130)
  })

  it('a throwing lookup becomes nodata while the other part survives', async () => {
    const r = await getExpiry(site, deps({ checkDomain: vi.fn().mockRejectedValue(new Error('rdap down')) }))
    expect(r.domain).toEqual({ status: 'nodata', detail: 'rdap down' })
    expect(r.ssl.status).toBe('ok')
  })

  it('a throwing SSL lookup becomes nodata', async () => {
    const r = await getExpiry(site, deps({ checkSSL: vi.fn().mockRejectedValue(new Error('tls boom')) }))
    expect(r.ssl).toEqual({ status: 'nodata', detail: 'tls boom' })
  })

  it('cache get rejecting still returns live data', async () => {
    const cache = { get: vi.fn().mockRejectedValue(new Error('db down')), set: vi.fn().mockResolvedValue(undefined) }
    const r = await getExpiry(site, deps({ cache }))
    expect(r.ssl.status).toBe('ok')
  })

  it('cache set rejecting still returns live data', async () => {
    const cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockRejectedValue(new Error('db down')) }
    const r = await getExpiry(site, deps({ cache }))
    expect(r.domain.status).toBe('ok')
  })

  it('does not cache a result where both parts are nodata', async () => {
    const cache = memCache()
    await getExpiry(site, deps({ cache, checkSSL: vi.fn().mockResolvedValue({ hostname: 'x', valid: false, daysRemaining: 0, error: 'refused' }), checkDomain: vi.fn().mockResolvedValue(nodata()) }))
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('works with no cache and stamps checkedAt from now()', async () => {
    const r = await getExpiry(site, deps())
    expect(r.checkedAt).toBe(new Date(NOW).toISOString())
  })
})
