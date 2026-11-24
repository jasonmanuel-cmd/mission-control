import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/alerts/run', () => ({ runAlertCheck: vi.fn() }))
vi.mock('@/lib/alerts/store', () => ({ createPgStore: vi.fn(() => ({})), neonExec: vi.fn(() => vi.fn()) }))

import { runAlertCheck } from '@/lib/alerts/run'
import { GET } from './route'
import { isAuthorized } from '@/lib/alerts/auth'

const req = (auth?: string) => ({ headers: new Headers(auth ? { authorization: auth } : {}) }) as any
const ENV = { ...process.env }

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  process.env.DATABASE_URL = 'postgres://x'
  ;(runAlertCheck as any).mockReset()
})
afterEach(() => { process.env = { ...ENV } })

describe('isAuthorized', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isAuthorized('Bearer s3cret', 's3cret')).toBe(true)
    expect(isAuthorized('Bearer s3cret!', 's3cret')).toBe(false)
    expect(isAuthorized('Bearer nope', 's3cret')).toBe(false)
    expect(isAuthorized('s3cret', 's3cret')).toBe(false)
    expect(isAuthorized('', 's3cret')).toBe(false)
    expect(isAuthorized(null, 's3cret')).toBe(false)
  })
})

describe('GET /api/cron/alerts', () => {
  it('503 when CRON_SECRET is not set, and nothing runs', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(503)
    expect(runAlertCheck).not.toHaveBeenCalled()
  })

  it('401 for a wrong bearer, and nothing runs', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(runAlertCheck).not.toHaveBeenCalled()
  })

  it('401 for a missing header, and nothing runs', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(runAlertCheck).not.toHaveBeenCalled()
  })

  it('503 when DATABASE_URL is not set, and nothing runs', async () => {
    delete process.env.DATABASE_URL
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/DATABASE_URL/)
    expect(runAlertCheck).not.toHaveBeenCalled()
  })

  it('200 with the run result for a valid request', async () => {
    ;(runAlertCheck as any).mockResolvedValue({ checked: 9, alerts: 1, delivered: true, detail: 'sent 1 alert(s)' })
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checked: 9, alerts: 1, delivered: true, detail: 'sent 1 alert(s)' })
  })

  it('502 when alerts could not be delivered, so the workflow turns red', async () => {
    ;(runAlertCheck as any).mockResolvedValue({ checked: 9, alerts: 1, delivered: false, detail: 'RESEND_API_KEY not set' })
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ delivered: false, detail: 'RESEND_API_KEY not set' })
  })

  it('exports a maxDuration so slow checks are not cut off', async () => {
    const mod = await import('./route')
    expect((mod as any).maxDuration).toBeGreaterThanOrEqual(30)
  })

  it('500 JSON when the run throws (e.g. store unreachable)', async () => {
    ;(runAlertCheck as any).mockRejectedValue(new Error('connection refused'))
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('connection refused')
  })
})
