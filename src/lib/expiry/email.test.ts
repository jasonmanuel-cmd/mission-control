import { describe, it, expect, vi } from 'vitest'
import { sendExpiryEmail } from './email'
import type { ExpiryAlert } from './decide'

const cfg = { apiKey: 'rk', from: 'alerts@example.com', to: 'me@example.com' }
const expiring = (what: 'ssl' | 'domain', days: number, name = 'Phil', siteId = 'p'): ExpiryAlert => ({
  type: 'expiring', what, siteId, name, url: `https://${siteId}.com`, days, expiresAt: '2026-12-01T00:00:00.000Z', threshold: days,
})
const expired = (what: 'ssl' | 'domain', name = 'Phil', siteId = 'p'): ExpiryAlert => ({
  type: 'expired', what, siteId, name, url: `https://${siteId}.com`, days: -1, expiresAt: '2026-11-23T00:00:00.000Z',
})
const okRes = () => new Response('{"id":"1"}', { status: 200 })
const subjectOf = (f: any) => JSON.parse(f.mock.calls[0][1].body).subject as string

describe('sendExpiryEmail', () => {
  it('no alerts -> ok without calling fetch', async () => {
    const f = vi.fn()
    expect(await sendExpiryEmail([], cfg, f as any)).toMatchObject({ ok: true })
    expect(f).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...cfg, apiKey: undefined }, 'RESEND_API_KEY'],
    [{ ...cfg, from: undefined }, 'ALERT_EMAIL_FROM'],
    [{ ...cfg, to: undefined }, 'ALERT_EMAIL_TO'],
  ])('missing config names the variable (%#)', async (c, name) => {
    const f = vi.fn()
    const r = await sendExpiryEmail([expiring('ssl', 14)], c as any, f as any)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain(name)
    expect(f).not.toHaveBeenCalled()
  })

  it('SSL expiring subject', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expiring('ssl', 14)], cfg, f as any)
    expect(subjectOf(f)).toBe('SSL expires in 14 days: Phil')
  })

  it('domain expiring subject', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expiring('domain', 7)], cfg, f as any)
    expect(subjectOf(f)).toBe('Domain expires in 7 days: Phil')
  })

  it('uses the singular for 1 day', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expiring('ssl', 1)], cfg, f as any)
    expect(subjectOf(f)).toBe('SSL expires in 1 day: Phil')
  })

  it('0 days (under a day left, not yet expired) says expires today', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expiring('ssl', 0)], cfg, f as any)
    expect(subjectOf(f)).toBe('SSL expires today: Phil')
    expect(JSON.parse(f.mock.calls[0][1].body).text).toMatch(/expires today/i)
  })

  it('expired subjects', async () => {
    const f1 = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expired('ssl')], cfg, f1 as any)
    expect(subjectOf(f1)).toBe('SSL EXPIRED: Phil')
    const f2 = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expired('domain')], cfg, f2 as any)
    expect(subjectOf(f2)).toBe('Domain EXPIRED: Phil')
  })

  it('several alerts get a count subject', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expiring('ssl', 14, 'A', 'a'), expiring('domain', 30, 'B', 'b'), expired('ssl', 'C', 'c')], cfg, f as any)
    expect(subjectOf(f)).toBe('3 expiry warnings')
  })

  it('body lists site, url, what, days left and the date', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendExpiryEmail([expiring('ssl', 14)], cfg, f as any)
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body.to).toEqual(['me@example.com'])
    expect(body.text).toContain('Phil')
    expect(body.text).toContain('https://p.com')
    expect(body.text).toMatch(/SSL/)
    expect(body.text).toContain('14')
    expect(body.text).toContain('2026-12-01')
  })

  it('HTTP error is reported with the status', async () => {
    const r = await sendExpiryEmail([expiring('ssl', 14)], cfg, vi.fn().mockResolvedValue(new Response('no', { status: 403 })) as any)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('403')
  })

  it('a hanging request times out', async () => {
    const hang = (_u: any, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const r = await sendExpiryEmail([expiring('ssl', 14)], cfg, hang as any, 20)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/timeout/i)
  })
})
