import { describe, it, expect, vi } from 'vitest'
import { sendAlertEmail } from './email'
import type { Alert } from './decide'

const cfg = { apiKey: 'rk', from: 'alerts@example.com', to: 'me@example.com' }
const down = (name = 'Phil', siteId = 'p'): Alert => ({ kind: 'down', siteId, name, url: `https://${siteId}.com`, reasons: ['Live site: HTTP 503'], since: '2026-11-24T10:00:00.000Z' })
const rec = (name = 'Phil', siteId = 'p'): Alert => ({ kind: 'recovered', siteId, name, url: `https://${siteId}.com`, reasons: [], since: '2026-11-24T10:00:00.000Z' })
const okRes = () => new Response('{"id":"1"}', { status: 200 })

describe('sendAlertEmail', () => {
  it('no alerts -> ok without calling fetch', async () => {
    const f = vi.fn()
    expect(await sendAlertEmail([], cfg, f as any)).toMatchObject({ ok: true })
    expect(f).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...cfg, apiKey: undefined }, 'RESEND_API_KEY'],
    [{ ...cfg, from: undefined }, 'ALERT_EMAIL_FROM'],
    [{ ...cfg, to: undefined }, 'ALERT_EMAIL_TO'],
  ])('missing config names the variable (%#)', async (c, name) => {
    const f = vi.fn()
    const r = await sendAlertEmail([down()], c as any, f as any)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain(name)
    expect(f).not.toHaveBeenCalled()
  })

  it('posts to Resend with bearer key and JSON body', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    const r = await sendAlertEmail([down()], cfg, f as any)
    expect(r.ok).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer rk')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ from: 'alerts@example.com', to: ['me@example.com'], subject: 'DOWN: Phil' })
    expect(body.text).toContain('https://p.com')
    expect(body.text).toContain('Live site: HTTP 503')
    expect(body.text).toContain('2026-11-24T10:00:00.000Z')
  })

  it('subject for a single recovery', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendAlertEmail([rec()], cfg, f as any)
    expect(JSON.parse(f.mock.calls[0][1].body).subject).toBe('RECOVERED: Phil')
  })

  it('subject for several alerts counts down and recovered', async () => {
    const f = vi.fn().mockResolvedValue(okRes())
    await sendAlertEmail([down('A', 'a'), down('B', 'b'), rec('C', 'c')], cfg, f as any)
    expect(JSON.parse(f.mock.calls[0][1].body).subject).toBe('3 site alerts (2 down, 1 recovered)')
  })

  it('HTTP errors are reported with the status', async () => {
    const f = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }))
    const r = await sendAlertEmail([down()], cfg, f as any)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('403')
  })

  it('fetch rejection is reported, not thrown', async () => {
    const r = await sendAlertEmail([down()], cfg, vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as any)
    expect(r).toMatchObject({ ok: false })
    expect(r.detail).toContain('ENOTFOUND')
  })

  it('a hanging request aborts after the timeout', async () => {
    const hang = (_u: any, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const r = await sendAlertEmail([down()], cfg, hang as any, 20)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/timeout/i)
  })
})
