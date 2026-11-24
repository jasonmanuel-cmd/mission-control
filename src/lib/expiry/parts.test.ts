import { describe, it, expect, vi } from 'vitest'
import { statusForDays, daysUntil, sslPart, rootDomain, checkDomainExpiry } from './parts'
import type { SSLInfo } from '@/lib/ssl'

const NOW = Date.parse('2026-11-24T00:00:00Z')
const inDays = (d: number) => new Date(NOW + d * 86400_000).toISOString()
const info = (over: Partial<SSLInfo> = {}): SSLInfo => ({ hostname: 'a.com', valid: true, daysRemaining: 90, validTo: inDays(90), ...over })

describe('statusForDays', () => {
  it.each([[31, 'ok'], [30, 'warn'], [8, 'warn'], [7, 'fail'], [0, 'fail'], [-3, 'fail']])('%i days -> %s', (d, s) => {
    expect(statusForDays(d as number)).toBe(s)
  })
})

describe('daysUntil', () => {
  it('counts whole days', () => {
    expect(daysUntil('2027-01-27T00:00:00Z', NOW)).toBe(64)
  })
  it('is negative once past', () => {
    expect(daysUntil(inDays(-2), NOW)).toBe(-2)
  })
})

describe('sslPart', () => {
  it('ok with days', () => {
    expect(sslPart(info(), NOW)).toMatchObject({ status: 'ok', days: 90 })
  })
  it('warn at 20 days', () => {
    expect(sslPart(info({ validTo: inDays(20) }), NOW).status).toBe('warn')
  })
  it('fail at 3 days', () => {
    expect(sslPart(info({ validTo: inDays(3) }), NOW).status).toBe('fail')
  })
  it('expired cert is fail and says expired', () => {
    const r = sslPart(info({ validTo: inDays(-5), daysRemaining: 0, valid: false }), NOW)
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/expired/i)
  })
  it('a connection error is nodata, never expired', () => {
    const r = sslPart(info({ error: 'Connection error: ECONNREFUSED', daysRemaining: 0, valid: false, validTo: undefined }), NOW)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain('ECONNREFUSED')
    expect(r.detail).not.toMatch(/expired/i)
  })
  it('missing validTo without an error is nodata', () => {
    expect(sslPart(info({ validTo: undefined, daysRemaining: 0 }), NOW).status).toBe('nodata')
  })
})

describe('rootDomain', () => {
  it.each([
    ['https://www.example.com/path', 'example.com'],
    ['blog.example.com', 'example.com'],
    ['shop.example.co.uk', 'example.co.uk'],
    ['example.com:8080', 'example.com'],
    ['example.com', 'example.com'],
  ])('%s -> %s', (host, root) => {
    expect(rootDomain(host)).toBe(root)
  })
})

describe('checkDomainExpiry', () => {
  const rdap = (events: any[], status = 200) => new Response(JSON.stringify({ events }), { status })
  const good = () => rdap([
    { eventAction: 'registration', eventDate: '2025-01-01T00:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-01-27T00:00:00Z' },
  ])

  it('reads the expiration event and queries the root domain', async () => {
    const f = vi.fn().mockResolvedValue(good())
    const r = await checkDomainExpiry('www.example.com', f as any, NOW)
    expect(f.mock.calls[0][0]).toBe('https://rdap.org/domain/example.com')
    expect(r).toMatchObject({ status: 'ok', days: 64, expiresAt: '2027-01-27T00:00:00Z' })
  })
  it('404 -> nodata mentioning 404', async () => {
    const r = await checkDomainExpiry('a.com', vi.fn().mockResolvedValue(rdap([], 404)) as any, NOW)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain('404')
  })
  it('no expiration event -> nodata', async () => {
    const r = await checkDomainExpiry('a.com', vi.fn().mockResolvedValue(rdap([{ eventAction: 'registration', eventDate: '2025-01-01T00:00:00Z' }])) as any, NOW)
    expect(r.status).toBe('nodata')
  })
  it('fetch rejection -> nodata', async () => {
    const r = await checkDomainExpiry('a.com', vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as any, NOW)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain('ENOTFOUND')
  })
  it('hanging request aborts to nodata', async () => {
    const hang = (_u: any, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const r = await checkDomainExpiry('a.com', hang as any, NOW, 20)
    expect(r.status).toBe('nodata')
    expect(r.detail).toMatch(/timeout/i)
  })
  it('a domain expiring in 5 days is fail', async () => {
    const f = vi.fn().mockResolvedValue(rdap([{ eventAction: 'expiration', eventDate: inDays(5) }]))
    expect((await checkDomainExpiry('a.com', f as any, NOW)).status).toBe('fail')
  })
})
