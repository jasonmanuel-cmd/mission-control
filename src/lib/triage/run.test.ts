import { describe, it, expect, vi } from 'vitest'
import { runTriage, type TriageDeps } from './run'
import type { SiteExpiry } from '@/lib/expiry/cache'

const sites = [
  { id: 'a', name: 'A', url: 'https://a.com', vercelProject: 'pa' },
  { id: 'b', name: 'B', url: 'https://b.com' },
  { id: 'c', name: 'C', url: 'https://c.com' },
]
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

const okExpiry = (): SiteExpiry => ({
  ssl: { status: 'ok', detail: 'ssl', days: 90 },
  domain: { status: 'ok', detail: 'domain', days: 300 },
  checkedAt: '2026-11-24T00:00:00.000Z',
})

function deps(over: Partial<TriageDeps> = {}): TriageDeps {
  return {
    getExpiry: vi.fn().mockResolvedValue(okExpiry()),
    loadMonitorIndex: vi.fn().mockResolvedValue({ monitors: [] }),
    uptimeForSite: vi.fn().mockReturnValue({ status: 'ok', detail: 'up' }),
    checkLive: vi.fn().mockResolvedValue({ status: 'ok', detail: 'fine' }),
    checkVercelDeploy: vi.fn().mockResolvedValue({ status: 'ok', detail: 'deployed' }),
    env: { betterStackKey: 'k', vercelToken: 't', vercelTeamId: undefined },
    ...over,
  }
}

describe('runTriage', () => {
  it('runs sites in parallel', async () => {
    const d = deps({ checkLive: vi.fn().mockImplementation(async () => { await delay(60); return { status: 'ok', detail: '' } }) })
    const t0 = Date.now()
    await runTriage(sites, d)
    expect(Date.now() - t0).toBeLessThan(150)
  })

  it('loads the Better Stack index concurrently with the live and deploy checks', async () => {
    const slow = (ms: number) => new Promise(r => setTimeout(r, ms))
    const d = deps({
      loadMonitorIndex: vi.fn().mockImplementation(async () => { await slow(80); return { monitors: [] } }),
      checkLive: vi.fn().mockImplementation(async () => { await slow(80); return { status: 'ok', detail: '' } }),
    })
    const t0 = Date.now()
    await runTriage(sites.slice(0, 1), d)
    expect(Date.now() - t0).toBeLessThan(140)
  })

  it('turns a throwing part into nodata without rejecting', async () => {
    const d = deps({ checkLive: vi.fn().mockRejectedValue(new Error('kaboom')) })
    const res = await runTriage(sites, d)
    expect(res[0].live).toEqual({ status: 'nodata', detail: 'kaboom' })
    expect(res).toHaveLength(3)
  })

  it('overall is the worst of the three parts', async () => {
    const d = deps({ checkLive: vi.fn().mockResolvedValue({ status: 'fail', detail: 'down' }) })
    const res = await runTriage(sites, d)
    expect(res.every(r => r.overall === 'fail')).toBe(true)
  })

  it('fetches the Better Stack index exactly once', async () => {
    const d = deps()
    await runTriage(sites, d)
    expect(d.loadMonitorIndex).toHaveBeenCalledTimes(1)
  })

  it('passes each site its vercelProject and the token', async () => {
    const d = deps()
    await runTriage(sites, d)
    expect(d.checkVercelDeploy).toHaveBeenCalledWith('pa', { token: 't', teamId: undefined })
  })

  it('returns id, name, url and an ISO checkedAt', async () => {
    const [r] = await runTriage(sites, deps())
    expect(r).toMatchObject({ id: 'a', name: 'A', url: 'https://a.com' })
    expect(new Date(r.checkedAt).toISOString()).toBe(r.checkedAt)
  })

  it('unconfigured parts do not turn a healthy row amber', async () => {
    const d = deps({
      uptimeForSite: vi.fn().mockReturnValue({ status: 'nodata', detail: 'no key', unconfigured: true }),
      checkVercelDeploy: vi.fn().mockResolvedValue({ status: 'nodata', detail: 'no project', unconfigured: true }),
    })
    const res = await runTriage(sites, d)
    expect(res.every(r => r.overall === 'ok')).toBe(true)
  })

  it('a real integration error (nodata, configured) still turns the row amber', async () => {
    const d = deps({ checkVercelDeploy: vi.fn().mockResolvedValue({ status: 'nodata', detail: 'Vercel API returned 403' }) })
    const res = await runTriage(sites, d)
    expect(res.every(r => r.overall === 'warn')).toBe(true)
  })

  it('everything unconfigured -> nodata overall', async () => {
    const un = { status: 'nodata' as const, detail: 'x', unconfigured: true }
    const d = deps({
      uptimeForSite: vi.fn().mockReturnValue(un),
      checkLive: vi.fn().mockResolvedValue(un),
      checkVercelDeploy: vi.fn().mockResolvedValue(un),
    })
    const [r] = await runTriage(sites, d)
    expect(r.overall).toBe('nodata')
  })

  it('attaches expiry to every row', async () => {
    const res = await runTriage(sites, deps())
    expect(res.every(r => r.expiry.ssl.days === 90 && r.expiry.domain.days === 300)).toBe(true)
  })

  it('a failing expiry part never changes overall (healthy site stays ok)', async () => {
    const expiring: SiteExpiry = { ...okExpiry(), ssl: { status: 'fail', detail: 'certificate expires in 2 day(s)', days: 2 } }
    const res = await runTriage(sites, deps({ getExpiry: vi.fn().mockResolvedValue(expiring) }))
    expect(res.every(r => r.overall === 'ok')).toBe(true)
    expect(res[0].expiry.ssl.status).toBe('fail')
  })

  it('getExpiry throwing yields nodata parts and does not reject the run', async () => {
    const res = await runTriage(sites, deps({ getExpiry: vi.fn().mockRejectedValue(new Error('boom')) }))
    expect(res).toHaveLength(3)
    expect(res[0].expiry.ssl).toEqual({ status: 'nodata', detail: 'boom' })
    expect(res[0].expiry.domain).toEqual({ status: 'nodata', detail: 'boom' })
  })

  it('runs expiry concurrently with the other checks', async () => {
    const slow = (ms: number) => new Promise(r => setTimeout(r, ms))
    const d = deps({
      checkLive: vi.fn().mockImplementation(async () => { await slow(80); return { status: 'ok', detail: '' } }),
      getExpiry: vi.fn().mockImplementation(async () => { await slow(80); return okExpiry() }),
    })
    const t0 = Date.now()
    await runTriage(sites.slice(0, 1), d)
    expect(Date.now() - t0).toBeLessThan(140)
  })
})
