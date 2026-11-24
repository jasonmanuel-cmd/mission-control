import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sites', () => ({
  readSites: vi.fn(),
}))
vi.mock('@/lib/triage/vercel', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/triage/vercel')>()),
  checkVercelDeploy: vi.fn(),
}))

import { readSites } from '@/lib/sites'
import { checkVercelDeploy } from '@/lib/triage/vercel'
import { GET } from './route'

const req = (url = 'http://localhost/api/sites/status') => {
  const u = new URL(url)
  return { nextUrl: u, headers: new Headers() } as any
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  ;(checkVercelDeploy as any).mockReset()
  process.env.VERCEL_TOKEN = 'tok'
  process.env.VERCEL_TEAM_ID = 'team_1'
})

describe('GET /api/sites/status', () => {
  it('uses sites.json as the only registry (no hardcoded sites)', async () => {
    ;(readSites as any).mockResolvedValue([{ id: 'only', name: 'Only', url: 'https://only.com' }])
    const body = await (await GET(req())).json()
    expect(body.sites.map((s: any) => s.id)).toEqual(['only'])
  })

  it('returns no sites when sites.json is empty', async () => {
    ;(readSites as any).mockResolvedValue([])
    const body = await (await GET(req())).json()
    expect(body.sites).toEqual([])
  })

  it('reports uptime and securityIssues as null, never an invented number', async () => {
    ;(readSites as any).mockResolvedValue([{ id: 'a', name: 'A', url: 'https://a.com' }])
    const body = await (await GET(req())).json()
    expect(body.sites[0].uptime).toBeNull()
    expect(body.sites[0].securityIssues).toBeNull()
  })

  it('returns a JSON 500 when sites.json is broken', async () => {
    ;(readSites as any).mockRejectedValue(new Error('sites.json: invalid JSON'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/sites\.json/)
  })

  describe('last deploy comes from Vercel', () => {
    const site = { id: 'a', name: 'A', url: 'https://a.com', vercelProject: 'proj-a' }

    it.each([
      ['ok', 'success'],
      ['fail', 'failed'],
      ['warn', 'building'],
    ])('a %s Vercel deploy shows as %s', async (status, expected) => {
      ;(readSites as any).mockResolvedValue([site])
      ;(checkVercelDeploy as any).mockResolvedValue({ status, detail: 'x', createdAt: Date.parse('2026-11-24T00:00:00Z') })
      const body = await (await GET(req())).json()
      expect(body.sites[0].lastDeployStatus).toBe(expected)
      expect(body.sites[0].lastDeployTime).toBe('2026-11-24T00:00:00.000Z')
    })

    it('passes the project and the server-side token to the Vercel check', async () => {
      ;(readSites as any).mockResolvedValue([site])
      ;(checkVercelDeploy as any).mockResolvedValue({ status: 'ok', detail: 'x', createdAt: 1 })
      await GET(req())
      expect(checkVercelDeploy).toHaveBeenCalledWith('proj-a', { token: 'tok', teamId: 'team_1' })
    })

    it('no deploy data leaves the fields empty', async () => {
      ;(readSites as any).mockResolvedValue([site])
      ;(checkVercelDeploy as any).mockResolvedValue({ status: 'nodata', detail: 'VERCEL_TOKEN not set', unconfigured: true })
      const body = await (await GET(req())).json()
      expect(body.sites[0].lastDeployStatus).toBeUndefined()
    })

    it('a site without a vercelProject is not looked up', async () => {
      ;(readSites as any).mockResolvedValue([{ id: 'b', name: 'B', url: 'https://b.com' }])
      await GET(req())
      expect(checkVercelDeploy).not.toHaveBeenCalled()
    })

    it('ignores a leftover legacy hosting id and token: no call to the old host', async () => {
      const legacyKey = 'net' + 'lify'
      process.env[legacyKey.toUpperCase() + '_API_TOKEN'] = 'old-token'
      ;(readSites as any).mockResolvedValue([{ ...site, [legacyKey + 'Id']: 'legacy-id' }])
      ;(checkVercelDeploy as any).mockResolvedValue({ status: 'ok', detail: 'x', createdAt: 1 })
      await GET(req())
      delete process.env[legacyKey.toUpperCase() + '_API_TOKEN']
      const urls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      expect(urls.filter((u: string) => u.includes(legacyKey))).toEqual([])
    })

    it('a Vercel lookup that throws leaves the deploy empty and the route still answers', async () => {
      ;(readSites as any).mockResolvedValue([site])
      ;(checkVercelDeploy as any).mockRejectedValue(new Error('vercel exploded'))
      const res = await GET(req())
      expect(res.status).toBe(200)
      expect((await res.json()).sites[0].lastDeployStatus).toBeUndefined()
    })

    it('an empty site list answers 200 with no sites', async () => {
      ;(readSites as any).mockResolvedValue([])
      const res = await GET(req())
      expect(res.status).toBe(200)
      expect((await res.json()).sites).toEqual([])
    })

    it('looks up deploys concurrently with the HEAD checks (not after them)', async () => {
      const slow = (ms: number) => new Promise(r => setTimeout(r, ms))
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { await slow(90); throw new Error('offline') }))
      ;(checkVercelDeploy as any).mockImplementation(async () => { await slow(90); return { status: 'ok', detail: 'x', createdAt: 1 } })
      ;(readSites as any).mockResolvedValue([site])
      const t0 = Date.now()
      await GET(req())
      expect(Date.now() - t0).toBeLessThan(160)
    })

    it('asks for enough time on hosts that honour maxDuration', async () => {
      const mod = await import('./route')
      expect((mod as any).maxDuration).toBeGreaterThanOrEqual(30)
    })
  })
})
