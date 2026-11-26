import { describe, it, expect, vi } from 'vitest'
import { checkLive } from './liveCheck'

const html = '<html><head><title>Phil</title></head><body>hi</body></html>'
const ok = (body = html, status = 200) => new Response(body, { status })
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })

describe('checkLive', () => {
  it('ok for fast 200 with body', async () => {
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockResolvedValue(ok()) as any })
    expect(r.status).toBe('ok')
    expect(r.httpStatus).toBe(200)
  })

  it('warn when slower than 3000ms', async () => {
    let t = 0
    const now = () => { const v = t; t += 3500; return v }
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockResolvedValue(ok()) as any, now })
    expect(r.status).toBe('warn')
    expect(r.detail).toMatch(/slow/i)
  })

  it('warn for final 404', async () => {
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockResolvedValue(ok('nope', 404)) as any })
    expect(r.status).toBe('warn')
    expect(r.httpStatus).toBe(404)
  })

  it('fail for 503', async () => {
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockResolvedValue(ok('x', 503)) as any })
    expect(r.status).toBe('fail')
  })

  it('fail when fetch rejects', async () => {
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as any })
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('ENOTFOUND')
  })

  it('fail with timeout detail when the request hangs', async () => {
    const hang = (_u: any, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const r = await checkLive('https://example.com', { fetchImpl: hang as any, timeoutMs: 20 })
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/timeout/i)
  })

  it('fail after more than 5 redirects', async () => {
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockImplementation(async () => redirect('https://example.com/next')) as any })
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/redirects/i)
  })

  it('follows redirects to the final url', async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect('/home')).mockResolvedValueOnce(ok())
    const r = await checkLive('https://example.com', { fetchImpl: f as any })
    expect(r.status).toBe('ok')
    expect(r.finalUrl).toBe('https://example.com/home')
  })

  it('normalises a bare host to https', async () => {
    const f = vi.fn().mockResolvedValue(ok())
    await checkLive('example.com', { fetchImpl: f as any })
    expect(f.mock.calls[0][0]).toBe('https://example.com')
  })

  it('warn on empty body', async () => {
    const r = await checkLive('https://example.com', { fetchImpl: vi.fn().mockResolvedValue(ok('')) as any })
    expect(r.status).toBe('warn')
    expect(r.detail).toMatch(/empty body/i)
  })
})
