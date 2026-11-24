import { describe, it, expect, vi } from 'vitest'
import { loadMonitorIndex, uptimeForSite } from './uptime'

const mon = (id: string, url: string, status: string) =>
  ({ id, type: 'monitor', attributes: { url, pronounceable_name: id, status, last_checked_at: '' } }) as any

async function indexOf(monitors: any[]) {
  return loadMonitorIndex('key', vi.fn().mockResolvedValue(monitors))
}

describe('uptimeForSite', () => {
  it('matches by betterStackId before host', async () => {
    const idx = await indexOf([mon('1', 'https://a.com', 'down'), mon('2', 'https://b.com', 'up')])
    expect(uptimeForSite({ url: 'https://a.com', betterStackId: '2' }, idx).status).toBe('ok')
  })

  it('matches by normalised host (scheme, www, trailing slash)', async () => {
    const idx = await indexOf([mon('1', 'https://www.example.com/', 'up')])
    expect(uptimeForSite({ url: 'example.com' }, idx).status).toBe('ok')
  })

  it('down -> fail', async () => {
    const idx = await indexOf([mon('1', 'https://a.com', 'down')])
    expect(uptimeForSite({ url: 'https://a.com' }, idx).status).toBe('fail')
  })

  it.each(['paused', 'pending', 'maintenance'])('%s -> warn', async s => {
    const idx = await indexOf([mon('1', 'https://a.com', s)])
    expect(uptimeForSite({ url: 'https://a.com' }, idx).status).toBe('warn')
  })

  it('no matching monitor -> nodata', async () => {
    const idx = await indexOf([mon('1', 'https://other.com', 'up')])
    const r = uptimeForSite({ url: 'https://a.com' }, idx)
    expect(r.status).toBe('nodata')
    expect(r.detail).toMatch(/no Better Stack monitor/)
  })

  it('index error -> nodata carrying the error', async () => {
    const idx = await loadMonitorIndex('key', vi.fn().mockRejectedValue(new Error('401 Unauthorized')))
    const r = uptimeForSite({ url: 'https://a.com' }, idx)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain('401')
  })

  it('missing key -> nodata mentioning the env var', async () => {
    const idx = await loadMonitorIndex(undefined, vi.fn())
    const r = uptimeForSite({ url: 'https://a.com' }, idx)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain('BETTER_STACK_UPTIME_API_KEY not set')
  })
})
