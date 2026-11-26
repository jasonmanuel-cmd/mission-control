import { describe, it, expect } from 'vitest'
import { decideExpiryAlerts, EXPIRY_THRESHOLDS, type ExpiryAlertState } from './decide'
import type { SiteExpiry } from './cache'
import type { ExpiryPart } from './parts'

const NOW = '2026-11-24T00:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const DAY = 86400_000
const at = (days: number) => new Date(NOW_MS + days * DAY).toISOString()
const key = (days: number) => at(days).slice(0, 10)
const part = (days: number): ExpiryPart => ({ status: days <= 7 ? 'fail' : days <= 30 ? 'warn' : 'ok', detail: `${days}d`, days, expiresAt: at(days) })
const nodata: ExpiryPart = { status: 'nodata', detail: 'lookup failed' }
const exp = (ssl: ExpiryPart, domain: ExpiryPart = part(300)): SiteExpiry => ({ ssl, domain, checkedAt: NOW })
const row = (id: string, expiry: SiteExpiry) => ({ id, name: `Site ${id}`, url: `https://${id}.com`, expiry })
const rec = (lastThreshold: number | null, expiredAlerted = false) => ({ lastThreshold, expiredAlerted })

describe('decideExpiryAlerts', () => {
  it('thresholds: domain 30/14/7/3/1, ssl 14/7/3/1 (auto-renewing certs dip below 30 days normally)', () => {
    expect([...EXPIRY_THRESHOLDS.domain].sort((a, b) => b - a)).toEqual([30, 14, 7, 3, 1])
    expect([...EXPIRY_THRESHOLDS.ssl].sort((a, b) => b - a)).toEqual([14, 7, 3, 1])
  })

  it('an SSL cert at 29 days (normal auto-renew window) sends nothing', () => {
    expect(decideExpiryAlerts({}, [row('a', exp(part(29)))], NOW).alerts).toEqual([])
  })

  it('90 days left: no alert, clean record for that expiry date', () => {
    const { alerts, next } = decideExpiryAlerts({}, [row('a', exp(part(90)))], NOW)
    expect(alerts).toEqual([])
    expect(next['a:ssl'].byExpiry[key(90)]).toEqual(rec(null))
  })

  it('a domain at 30 days: one expiring alert with threshold 30 and the part data', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(300), part(30)))], NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ type: 'expiring', what: 'domain', siteId: 'a', name: 'Site a', url: 'https://a.com', days: 30, threshold: 30, expiresAt: at(30) })
  })

  it('an SSL cert at 14 days: one expiring alert with threshold 14', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(14)))], NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ type: 'expiring', what: 'ssl', days: 14, threshold: 14 })
  })

  // The expiry date is fixed; only the clock advances (that is what really happens day to day).
  function walk(kind: 'ssl' | 'domain') {
    const fixed = at(40)
    let state: Record<string, ExpiryAlertState> = {}
    const seen: number[] = []
    for (const days of [30, 29, 20, 14, 10, 7, 5, 3, 2, 1]) {
      const p: ExpiryPart = { status: 'warn', detail: `${days}d`, days, expiresAt: fixed }
      const e = kind === 'ssl' ? exp(p) : exp(part(300), p)
      const clock = new Date(Date.parse(fixed) - days * DAY).toISOString()
      const r = decideExpiryAlerts(state, [row('a', e)], clock)
      state = r.next
      r.alerts.forEach(a => seen.push(a.threshold!))
    }
    return seen
  }
  it('a domain walks down 30/14/7/3/1 one alert at a time', () => expect(walk('domain')).toEqual([30, 14, 7, 3, 1]))
  it('an SSL cert walks down 14/7/3/1 one alert at a time', () => expect(walk('ssl')).toEqual([14, 7, 3, 1]))

  it('first run at 5 days sends exactly one alert at the 7-day threshold', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(5)))], NOW)
    expect(alerts.map(a => a.threshold)).toEqual([7])
  })

  it('first run at 1 day sends one alert at threshold 1', () => {
    expect(decideExpiryAlerts({}, [row('a', exp(part(1)))], NOW).alerts.map(a => a.threshold)).toEqual([1])
  })

  it('once the expiry time has passed: one expired alert, then quiet', () => {
    const first = decideExpiryAlerts({}, [row('a', exp(part(-2)))], NOW)
    expect(first.alerts).toHaveLength(1)
    expect(first.alerts[0]).toMatchObject({ type: 'expired', what: 'ssl', days: -2 })
    expect(decideExpiryAlerts(first.next, [row('a', exp(part(-2)))], NOW).alerts).toEqual([])
  })

  it('less than a day left is NOT reported as expired', () => {
    const tenHours: ExpiryPart = { status: 'fail', detail: 'x', days: 0, expiresAt: new Date(NOW_MS + 10 * 3600_000).toISOString() }
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(tenHours))], NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ type: 'expiring', what: 'ssl', days: 0, threshold: 1 })
  })

  it('days are recomputed from expiresAt, not trusted from a stale cached value', () => {
    const stale: ExpiryPart = { status: 'warn', detail: 'x', days: 8, expiresAt: new Date(NOW_MS + 6.5 * DAY).toISOString() }
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(stale))], NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ threshold: 7, days: 6 })
  })

  it('a renewal (later expiry date) sends nothing, and the new cycle alerts on its own schedule', () => {
    const prev = decideExpiryAlerts({}, [row('a', exp(part(3)))], NOW).next
    const renewed = decideExpiryAlerts(prev, [row('a', exp(part(365)))], NOW)
    expect(renewed.alerts).toEqual([])
    const later = decideExpiryAlerts(renewed.next, [row('a', exp(part(14)))], NOW)
    expect(later.alerts.map(a => a.threshold)).toEqual([14])
  })

  it('flapping between an old and a renewed cert never repeats the same warning', () => {
    let state = decideExpiryAlerts({}, [row('a', exp(part(5)))], NOW).next // old cert: 7-day email sent
    state = decideExpiryAlerts(state, [row('a', exp(part(90)))], NOW).next // other edge serves the renewed cert
    const again = decideExpiryAlerts(state, [row('a', exp(part(5)))], NOW) // old cert seen again
    expect(again.alerts).toEqual([])
  })

  it('an expired-then-renewed cert can expire (and alert) again on its new date', () => {
    let state = decideExpiryAlerts({}, [row('a', exp(part(-2)))], NOW).next
    state = decideExpiryAlerts(state, [row('a', exp(part(90)))], NOW).next
    const later = decideExpiryAlerts(state, [row('a', exp(part(-1)))], NOW)
    expect(later.alerts.map(a => a.type)).toEqual(['expired'])
  })

  it('a cert swapped for one that expires sooner alerts in the lower band for the new date', () => {
    const prev = decideExpiryAlerts({}, [row('a', exp(part(200)))], NOW).next
    const swapped = decideExpiryAlerts(prev, [row('a', exp(part(10)))], NOW)
    expect(swapped.alerts.map(a => a.threshold)).toEqual([14])
  })

  it('a nodata part never alerts and keeps the previous state', () => {
    const prev = decideExpiryAlerts({}, [row('a', exp(part(14)))], NOW).next
    const { alerts, next } = decideExpiryAlerts(prev, [row('a', exp(nodata))], NOW)
    expect(alerts).toEqual([])
    expect(next['a:ssl']).toEqual(prev['a:ssl'])
  })

  it('a nodata part with no previous state creates none', () => {
    expect(decideExpiryAlerts({}, [row('a', exp(nodata, nodata))], NOW).next).toEqual({})
  })

  it('ssl and domain track independently', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(7), part(14)))], NOW)
    expect(alerts.map(a => `${a.what}:${a.threshold}`).sort()).toEqual(['domain:14', 'ssl:7'])
  })

  it('drops state for sites that are no longer listed', () => {
    const prev: Record<string, ExpiryAlertState> = { 'gone:ssl': { byExpiry: { [key(7)]: rec(7) } }, 'gone:domain': { byExpiry: { [key(7)]: rec(7) } } }
    const { alerts, next } = decideExpiryAlerts(prev, [row('a', exp(part(90)))], NOW)
    expect(alerts).toEqual([])
    expect(Object.keys(next).some(k => k.startsWith('gone:'))).toBe(false)
  })

  it('remembers at most the 3 most recent expiry dates per key', () => {
    let state: Record<string, ExpiryAlertState> = {}
    for (const days of [100, 200, 300, 400, 500]) state = decideExpiryAlerts(state, [row('a', exp(part(days)))], NOW).next
    const keys = Object.keys(state['a:ssl'].byExpiry).sort()
    expect(keys).toEqual([key(300), key(400), key(500)])
  })
})
