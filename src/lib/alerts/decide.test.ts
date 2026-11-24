import { describe, it, expect } from 'vitest'
import { decideAlerts, FAIL_CONFIRM_RUNS, type SiteAlertState } from './decide'
import type { SiteTriage } from '@/lib/triage/run'
import type { PartStatus } from '@/lib/triage/status'

const T0 = '2026-11-24T10:00:00.000Z'
const T1 = '2026-11-24T10:05:00.000Z'
const T2 = '2026-11-24T10:10:00.000Z'

function row(id: string, over: Partial<Record<'uptime' | 'live' | 'deploy', PartStatus>> = {}, overall?: PartStatus): SiteTriage {
  const part = (s: PartStatus | undefined, d: string) => ({ status: s ?? 'ok', detail: d })
  const uptime = part(over.uptime, 'up')
  const live = part(over.live, over.live === 'fail' ? 'HTTP 503' : 'HTTP 200')
  const deploy = part(over.deploy, 'deployed')
  const parts = [uptime.status, live.status, deploy.status]
  const computed: PartStatus = parts.includes('fail') ? 'fail' : parts.includes('warn') ? 'warn' : parts.every(p => p === 'nodata') ? 'nodata' : 'ok'
  return { id, name: `Site ${id}`, url: `https://${id}.com`, uptime, live, deploy, overall: overall ?? computed, checkedAt: T0 }
}
const failing = (id: string) => row(id, { live: 'fail' })

describe('decideAlerts', () => {
  it('confirm threshold is 2 runs', () => {
    expect(FAIL_CONFIRM_RUNS).toBe(2)
  })

  it('first-ever healthy run sends nothing and records ok state', () => {
    const { alerts, next } = decideAlerts({}, [row('a')], T0)
    expect(alerts).toEqual([])
    expect(next.a).toMatchObject({ status: 'ok', failStreak: 0, alerted: false })
  })

  it('a single failure does not alert (transient)', () => {
    const { alerts, next } = decideAlerts({}, [failing('a')], T0)
    expect(alerts).toEqual([])
    expect(next.a).toMatchObject({ status: 'fail', failStreak: 1, alerted: false, since: T0 })
  })

  it('second consecutive failure raises one down alert with reasons and since', () => {
    const first = decideAlerts({}, [failing('a')], T0).next
    const { alerts, next } = decideAlerts(first, [failing('a')], T1)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'down', siteId: 'a', name: 'Site a', url: 'https://a.com', since: T0 })
    expect(alerts[0].reasons).toEqual(['Live site: HTTP 503'])
    expect(next.a).toMatchObject({ failStreak: 2, alerted: true })
  })

  it('does not re-alert while the site stays down', () => {
    let state = decideAlerts({}, [failing('a')], T0).next
    state = decideAlerts(state, [failing('a')], T1).next
    const { alerts } = decideAlerts(state, [failing('a')], T2)
    expect(alerts).toEqual([])
  })

  it('a failure that clears before confirmation never alerts and resets the streak', () => {
    const first = decideAlerts({}, [failing('a')], T0).next
    const { alerts, next } = decideAlerts(first, [row('a')], T1)
    expect(alerts).toEqual([])
    expect(next.a).toMatchObject({ status: 'ok', failStreak: 0, alerted: false })
  })

  it.each(['ok', 'warn', 'nodata'] as PartStatus[])('recovery to %s sends one recovered alert with the original since', status => {
    const alerted: Record<string, SiteAlertState> = { a: { status: 'fail', failStreak: 5, alerted: true, since: T0 } }
    const healthy = status === 'nodata' ? row('a', { uptime: 'nodata', live: 'nodata', deploy: 'nodata' }) : row('a', { live: status })
    const { alerts, next } = decideAlerts(alerted, [healthy], T2)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'recovered', siteId: 'a', since: T0 })
    expect(next.a).toMatchObject({ status: 'ok', failStreak: 0, alerted: false })
  })

  it('warn and nodata rows never alert', () => {
    const { alerts } = decideAlerts({}, [row('a', { live: 'warn' }), row('b', { uptime: 'nodata', live: 'nodata', deploy: 'nodata' })], T0)
    expect(alerts).toEqual([])
  })

  it('a site removed from the list is dropped and gets no recovered alert', () => {
    const prev: Record<string, SiteAlertState> = { gone: { status: 'fail', failStreak: 3, alerted: true, since: T0 } }
    const { alerts, next } = decideAlerts(prev, [row('a')], T1)
    expect(alerts).toEqual([])
    expect(next.gone).toBeUndefined()
  })

  it('two failing sites alert independently in one result', () => {
    const first = decideAlerts({}, [failing('a'), failing('b')], T0).next
    const { alerts } = decideAlerts(first, [failing('a'), failing('b')], T1)
    expect(alerts.map(a => a.siteId).sort()).toEqual(['a', 'b'])
  })
})
