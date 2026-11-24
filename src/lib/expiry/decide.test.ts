import { describe, it, expect } from 'vitest'
import { decideExpiryAlerts, EXPIRY_THRESHOLDS, type ExpiryAlertState } from './decide'
import type { SiteExpiry } from './cache'
import type { ExpiryPart } from './parts'

const NOW = '2026-11-24T00:00:00.000Z'
const DAY = 86400_000
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY).toISOString()
const part = (days: number): ExpiryPart => ({ status: days <= 7 ? 'fail' : days <= 30 ? 'warn' : 'ok', detail: `${days}d`, days, expiresAt: at(days) })
const nodata: ExpiryPart = { status: 'nodata', detail: 'lookup failed' }
const exp = (ssl: ExpiryPart, domain: ExpiryPart = part(300)): SiteExpiry => ({ ssl, domain, checkedAt: NOW })
const row = (id: string, expiry: SiteExpiry) => ({ id, name: `Site ${id}`, url: `https://${id}.com`, expiry })

describe('decideExpiryAlerts', () => {
  it('thresholds: domain 30/14/7/3/1, ssl 14/7/3/1 (auto-renewing certs dip below 30 days normally)', () => {
    expect([...EXPIRY_THRESHOLDS.domain].sort((a, b) => b - a)).toEqual([30, 14, 7, 3, 1])
    expect([...EXPIRY_THRESHOLDS.ssl].sort((a, b) => b - a)).toEqual([14, 7, 3, 1])
  })

  it('an SSL cert at 29 days (normal auto-renew window) sends nothing', () => {
    const { alerts, next } = decideExpiryAlerts({}, [row('a', exp(part(29)))], NOW)
    expect(alerts).toEqual([])
    expect(next['a:ssl']).toMatchObject({ lastThreshold: null })
  })

  it('90 days left: no alert, clean state', () => {
    const { alerts, next } = decideExpiryAlerts({}, [row('a', exp(part(90)))], NOW)
    expect(alerts).toEqual([])
    expect(next['a:ssl']).toMatchObject({ lastThreshold: null, expiredAlerted: false })
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

  it('a domain walks down 30/14/7/3/1 one alert at a time', () => {
    let state: Record<string, ExpiryAlertState> = {}
    const seen: number[] = []
    for (const days of [30, 29, 20, 14, 10, 7, 5, 3, 2, 1]) {
      const r = decideExpiryAlerts(state, [row('a', exp(part(300), part(days)))], NOW)
      state = r.next
      r.alerts.forEach(a => seen.push(a.threshold!))
    }
    expect(seen).toEqual([30, 14, 7, 3, 1])
  })

  it('an SSL cert walks down 14/7/3/1 one alert at a time', () => {
    let state: Record<string, ExpiryAlertState> = {}
    const seen: number[] = []
    for (const days of [30, 29, 20, 14, 10, 7, 5, 3, 2, 1]) {
      const r = decideExpiryAlerts(state, [row('a', exp(part(days)))], NOW)
      state = r.next
      r.alerts.forEach(a => seen.push(a.threshold!))
    }
    expect(seen).toEqual([14, 7, 3, 1])
  })

  it('first run at 5 days sends exactly one alert at the 7-day threshold', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(5)))], NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].threshold).toBe(7)
  })

  it('first run at 1 day sends one alert at threshold 1', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(1)))], NOW)
    expect(alerts.map(a => a.threshold)).toEqual([1])
  })

  it('expired sends one expired alert, then stays quiet', () => {
    const first = decideExpiryAlerts({}, [row('a', exp(part(-2)))], NOW)
    expect(first.alerts).toHaveLength(1)
    expect(first.alerts[0]).toMatchObject({ type: 'expired', what: 'ssl', days: -2 })
    expect(first.next['a:ssl'].expiredAlerted).toBe(true)
    const second = decideExpiryAlerts(first.next, [row('a', exp(part(-3)))], NOW)
    expect(second.alerts).toEqual([])
  })

  it('a renewal (later expiry) re-arms thresholds with no email for the renewal itself', () => {
    const prev: Record<string, ExpiryAlertState> = { 'a:ssl': { lastThreshold: 3, expiredAlerted: false, expiresAt: at(3) } }
    const renewed = decideExpiryAlerts(prev, [row('a', exp(part(365)))], NOW)
    expect(renewed.alerts).toEqual([])
    expect(renewed.next['a:ssl']).toMatchObject({ lastThreshold: null, expiredAlerted: false })
    const later = decideExpiryAlerts(renewed.next, [row('a', exp(part(14)))], NOW)
    expect(later.alerts.map(a => a.threshold)).toEqual([14])
  })

  it('an expired-then-renewed cert re-arms the expired alert', () => {
    const prev: Record<string, ExpiryAlertState> = { 'a:ssl': { lastThreshold: 1, expiredAlerted: true, expiresAt: at(-2) } }
    const renewed = decideExpiryAlerts(prev, [row('a', exp(part(90)))], NOW)
    expect(renewed.next['a:ssl']).toMatchObject({ lastThreshold: null, expiredAlerted: false })
  })

  it('a nodata part never alerts and keeps the previous state', () => {
    const prev: Record<string, ExpiryAlertState> = { 'a:ssl': { lastThreshold: 14, expiredAlerted: false, expiresAt: at(14) } }
    const { alerts, next } = decideExpiryAlerts(prev, [row('a', exp(nodata))], NOW)
    expect(alerts).toEqual([])
    expect(next['a:ssl']).toEqual(prev['a:ssl'])
  })

  it('a nodata part with no previous state creates none', () => {
    const { next } = decideExpiryAlerts({}, [row('a', exp(nodata, nodata))], NOW)
    expect(next).toEqual({})
  })

  it('ssl and domain track independently', () => {
    const { alerts } = decideExpiryAlerts({}, [row('a', exp(part(7), part(14)))], NOW)
    expect(alerts.map(a => `${a.what}:${a.threshold}`).sort()).toEqual(['domain:14', 'ssl:7'])
  })

  it('drops state for sites that are no longer listed', () => {
    const prev: Record<string, ExpiryAlertState> = { 'gone:ssl': { lastThreshold: 7, expiredAlerted: false, expiresAt: at(7) }, 'gone:domain': { lastThreshold: 7, expiredAlerted: false, expiresAt: at(7) } }
    const { alerts, next } = decideExpiryAlerts(prev, [row('a', exp(part(90)))], NOW)
    expect(alerts).toEqual([])
    expect(Object.keys(next).some(k => k.startsWith('gone:'))).toBe(false)
  })
})
