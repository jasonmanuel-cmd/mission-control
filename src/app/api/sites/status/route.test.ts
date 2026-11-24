import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sites', () => ({
  readSites: vi.fn(),
}))

import { readSites } from '@/lib/sites'
import { GET } from './route'

const req = (url = 'http://localhost/api/sites/status') => {
  const u = new URL(url)
  return { nextUrl: u, headers: new Headers() } as any
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
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
})
