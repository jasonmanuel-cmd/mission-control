import { describe, it, expect } from 'vitest'
import { expirySummary } from './expirySummary'
import type { SiteExpiry } from '@/lib/expiry/cache'
import type { ExpiryPart } from '@/lib/expiry/parts'

const p = (days: number, detail = `${days}d`): ExpiryPart => ({
  status: days <= 7 ? 'fail' : days <= 30 ? 'warn' : 'ok', detail, days, expiresAt: '2027-01-01T00:00:00.000Z',
})
const nodata = (detail = 'lookup failed'): ExpiryPart => ({ status: 'nodata', detail })
const e = (ssl: ExpiryPart, domain: ExpiryPart): SiteExpiry => ({ ssl, domain, checkedAt: '2026-11-24T00:00:00.000Z' })

describe('expirySummary', () => {
  it('both ok shows both day counts', () => {
    expect(expirySummary(e(p(62), p(288)))).toMatchObject({ status: 'ok', text: 'SSL 62d · Domain 288d' })
  })
  it('ssl warn makes the cell warn', () => {
    expect(expirySummary(e(p(20), p(288)))).toMatchObject({ status: 'warn', text: 'SSL 20d · Domain 288d' })
  })
  it('domain fail makes the cell fail', () => {
    expect(expirySummary(e(p(62), p(3)))).toMatchObject({ status: 'fail', text: 'SSL 62d · Domain 3d' })
  })
  it('ssl nodata with domain ok: cell follows the part that has data', () => {
    expect(expirySummary(e(nodata(), p(288)))).toMatchObject({ status: 'ok', text: 'SSL no data · Domain 288d' })
  })
  it('both nodata is grey', () => {
    expect(expirySummary(e(nodata(), nodata()))).toMatchObject({ status: 'nodata', text: 'SSL no data · Domain no data' })
  })
  it('an expired part reads expired and fails', () => {
    expect(expirySummary(e(p(-2), p(288)))).toMatchObject({ status: 'fail', text: 'SSL expired · Domain 288d' })
  })
  it('the tooltip lists both details', () => {
    const r = expirySummary(e(p(62, 'certificate expires in 62 day(s)'), nodata('RDAP lookup returned 404')))
    expect(r.title).toContain('certificate expires in 62 day(s)')
    expect(r.title).toContain('RDAP lookup returned 404')
  })
})
