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

    it('never calls a hosting API other than Vercel', async () => {
      ;(readSites as any).mockResolvedValue([site])
      ;(checkVercelDeploy as any).mockResolvedValue({ status: 'ok', detail: 'x', createdAt: 1 })
      await GET(req())
      const urls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      expect(urls.some((u: string) => /api\.net/.test(u) && /lify/.test(u))).toBe(false)
    })
  })
})
