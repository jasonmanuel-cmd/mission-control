import { describe, it, expect, vi } from 'vitest'
import { runAlertCheck, type AlertRunDeps } from './run'
import type { SiteAlertState } from './decide'
import type { SiteTriage } from '@/lib/triage/run'
import type { AlertStore } from './store'

const NOW = '2026-11-24T10:00:00.000Z'
const site = (id: string, fail = false): SiteTriage => ({
  id, name: `Site ${id}`, url: `https://${id}.com`,
  uptime: { status: 'ok', detail: 'up' },
  live: { status: fail ? 'fail' : 'ok', detail: fail ? 'HTTP 503' : 'HTTP 200' },
  deploy: { status: 'ok', detail: 'deployed' },
  overall: fail ? 'fail' : 'ok', checkedAt: NOW,
  expiry: { ssl: { status: 'ok', detail: 'ssl', days: 90 }, domain: { status: 'ok', detail: 'domain', days: 300 }, checkedAt: NOW },
})
const cfgSites = (...ids: string[]) => ids.map(id => ({ id, name: id, url: `https://${id}.com` }))

function memStore(initial: Record<string, SiteAlertState> = {}) {
  let data = { ...initial }
  const store: AlertStore = {
    load: vi.fn(async () => ({ ...data })),
    save: vi.fn(async s => { data = { ...s } }),
  }
  return { store, get: () => data }
}

function deps(rows: SiteTriage[], store: AlertStore, send = vi.fn().mockResolvedValue({ ok: true, detail: 'sent' })): AlertRunDeps & { send: any } {
  return {
    readSites: vi.fn().mockResolvedValue(cfgSites(...rows.map(r => r.id))),
    runTriage: vi.fn().mockResolvedValue(rows),
    store, send, now: () => NOW,
  } as any
}

describe('runAlertCheck', () => {
  it('healthy run: no email, state saved', async () => {
    const m = memStore()
    const d = deps([site('a')], m.store)
    const r = await runAlertCheck(d)
    expect(d.send).not.toHaveBeenCalled()
    expect(r).toMatchObject({ checked: 1, alerts: 0, delivered: true })
    expect(m.get().a).toMatchObject({ status: 'ok' })
  })

  it('confirmed failure is emailed once and recorded as alerted', async () => {
    const m = memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } })
    const d = deps([site('a', true)], m.store)
    const r = await runAlertCheck(d)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.send.mock.calls[0][0][0]).toMatchObject({ kind: 'down', siteId: 'a' })
    expect(r).toMatchObject({ alerts: 1, delivered: true })
    expect(m.get().a).toMatchObject({ alerted: true })
  })

  it('failed delivery keeps alerted=false so the down alert retries next run', async () => {
    const m = memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } })
    const send = vi.fn().mockResolvedValue({ ok: false, detail: 'Resend returned 500' })
    const r = await runAlertCheck(deps([site('a', true)], m.store, send))
    expect(r).toMatchObject({ alerts: 1, delivered: false, detail: expect.stringContaining('500') })
    expect(m.get().a).toMatchObject({ status: 'fail', alerted: false })
  })

  it('retry after a failed send delivers exactly one down alert', async () => {
    const m = memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } })
    const send = vi.fn().mockResolvedValueOnce({ ok: false, detail: 'x' }).mockResolvedValue({ ok: true, detail: 'sent' })
    await runAlertCheck(deps([site('a', true)], m.store, send))
    await runAlertCheck(deps([site('a', true)], m.store, send))
    await runAlertCheck(deps([site('a', true)], m.store, send))
    const delivered = send.mock.calls.filter((_c, i) => i >= 1)
    expect(send).toHaveBeenCalledTimes(2) // failed once, delivered once, third run has nothing to send
    expect(delivered).toHaveLength(1)
  })

  it('failed delivery of a recovery keeps alerted=true so it is re-sent', async () => {
    const m = memStore({ a: { status: 'fail', failStreak: 4, alerted: true, since: NOW } })
    const send = vi.fn().mockResolvedValue({ ok: false, detail: 'x' })
    await runAlertCheck(deps([site('a', false)], m.store, send))
    expect(m.get().a).toMatchObject({ status: 'fail', alerted: true })
  })

  it('a dead store fails the run before any email is sent', async () => {
    const store: AlertStore = { load: vi.fn().mockRejectedValue(new Error('connection refused')), save: vi.fn() }
    const d = deps([site('a', true)], store)
    await expect(runAlertCheck(d)).rejects.toThrow('connection refused')
    expect(d.send).not.toHaveBeenCalled()
    expect(d.runTriage).not.toHaveBeenCalled()
  })

  it('a failing save after sending rejects', async () => {
    const m = memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } })
    ;(m.store.save as any).mockRejectedValue(new Error('disk full'))
    await expect(runAlertCheck(deps([site('a', true)], m.store))).rejects.toThrow('disk full')
  })
})
