import { describe, it, expect } from 'vitest'
import { expirySummary } from './expirySummary'
import type { SiteExpiry } from '@/lib/expiry/cache'
import type { ExpiryPart } from '@/lib/expiry/parts'

const NOW = Date.parse('2026-11-24T00:00:00Z')
const DAY = 86400_000
const p = (days: number, detail = `${days}d`): ExpiryPart => ({
  status: days <= 7 ? 'fail' : days <= 30 ? 'warn' : 'ok', detail, days, expiresAt: new Date(NOW + days * DAY).toISOString(),
})
const nodata = (detail = 'lookup failed'): ExpiryPart => ({ status: 'nodata', detail })
const e = (ssl: ExpiryPart, domain: ExpiryPart): SiteExpiry => ({ ssl, domain, checkedAt: '2026-11-24T00:00:00.000Z' })
const sum = (x: SiteExpiry) => expirySummary(x, NOW)

describe('expirySummary', () => {
  it('both ok shows both day counts', () => {
    expect(sum(e(p(62), p(288)))).toMatchObject({ status: 'ok', text: 'SSL 62d · Domain 288d' })
  })
  it('ssl at 20 days is ok (certs auto-renew), domain at 20 is warn', () => {
    expect(sum(e(p(20), p(288)))).toMatchObject({ status: 'ok', text: 'SSL 20d · Domain 288d' })
    expect(sum(e(p(62), p(20)))).toMatchObject({ status: 'warn' })
  })
  it('ssl warn at 12 days makes the cell warn', () => {
    expect(sum(e(p(12), p(288)))).toMatchObject({ status: 'warn', text: 'SSL 12d · Domain 288d' })
  })
  it('domain fail makes the cell fail', () => {
    expect(sum(e(p(62), p(3)))).toMatchObject({ status: 'fail', text: 'SSL 62d · Domain 3d' })
  })
  it('ssl nodata with domain ok: cell follows the part that has data', () => {
    expect(sum(e(nodata(), p(288)))).toMatchObject({ status: 'ok', text: 'SSL no data · Domain 288d' })
  })
  it('both nodata is grey', () => {
    expect(sum(e(nodata(), nodata()))).toMatchObject({ status: 'nodata', text: 'SSL no data · Domain no data' })
  })
  it('a part whose expiry has passed reads expired and fails', () => {
    expect(sum(e(p(-2), p(288)))).toMatchObject({ status: 'fail', text: 'SSL expired · Domain 288d' })
  })
  it('under a day left reads 0d, not expired', () => {
    const tenHours: ExpiryPart = { status: 'fail', detail: 'x', days: 0, expiresAt: new Date(NOW + 10 * 3600_000).toISOString() }
    expect(sum(e(tenHours, p(288)))).toMatchObject({ status: 'fail', text: 'SSL 0d · Domain 288d' })
  })
  it('a stale cached day count is recomputed from the expiry date', () => {
    const stale: ExpiryPart = { status: 'ok', detail: 'x', days: 20, expiresAt: new Date(NOW + 11.5 * DAY).toISOString() }
    expect(sum(e(p(62), stale))).toMatchObject({ status: 'warn', text: 'SSL 62d · Domain 11d' })
  })
  it('the tooltip lists both details', () => {
    const r = sum(e(p(62, 'certificate expires in 62 day(s)'), nodata('RDAP lookup returned 404')))
    expect(r.title).toContain('certificate expires in 62 day(s)')
    expect(r.title).toContain('RDAP lookup returned 404')
  })
})
