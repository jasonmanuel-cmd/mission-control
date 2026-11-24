import { describe, it, expect, vi } from 'vitest'
import { runAlertCheck, type AlertRunDeps } from './run'
import type { ExpiryAlertState } from '@/lib/expiry/decide'
import type { StateStore } from './store'
import type { SiteAlertState } from './decide'
import type { SiteTriage } from '@/lib/triage/run'
import type { AlertStore } from './store'

const NOW = '2026-11-24T10:00:00.000Z'
const NOW_MS = Date.parse('2026-11-24T10:00:00.000Z')
const site = (id: string, fail = false, sslDays = 90): SiteTriage => ({
  id, name: `Site ${id}`, url: `https://${id}.com`,
  uptime: { status: 'ok', detail: 'up' },
  live: { status: fail ? 'fail' : 'ok', detail: fail ? 'HTTP 503' : 'HTTP 200' },
  deploy: { status: 'ok', detail: 'deployed' },
  overall: fail ? 'fail' : 'ok', checkedAt: NOW,
  expiry: {
    ssl: { status: sslDays <= 7 ? 'fail' : sslDays <= 30 ? 'warn' : 'ok', detail: 'ssl', days: sslDays, expiresAt: new Date(NOW_MS + sslDays * 86400_000).toISOString() },
    domain: { status: 'ok', detail: 'domain', days: 300, expiresAt: new Date(NOW_MS + 300 * 86400_000).toISOString() },
    checkedAt: NOW,
  },
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

function memExpiryStore(initial: Record<string, ExpiryAlertState> = {}) {
  let data = { ...initial }
  const store: StateStore<ExpiryAlertState> = {
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

  describe('expiry warnings', () => {
    function expiryDeps(rows: SiteTriage[], status = memStore(), exp = memExpiryStore(), sendExpiry = vi.fn().mockResolvedValue({ ok: true, detail: 'sent' }), send = vi.fn().mockResolvedValue({ ok: true, detail: 'sent' })) {
      return { d: { ...deps(rows, status.store, send), expiryStore: exp.store, sendExpiry } as any, status, exp, sendExpiry, send }
    }

    it('a 5-day SSL expiry sends one expiry email at the 7-day threshold and records it', async () => {
      const { d, exp, sendExpiry } = expiryDeps([site('a', false, 5)])
      const r = await runAlertCheck(d)
      expect(sendExpiry).toHaveBeenCalledTimes(1)
      expect(sendExpiry.mock.calls[0][0]).toHaveLength(1)
      expect(sendExpiry.mock.calls[0][0][0]).toMatchObject({ type: 'expiring', what: 'ssl', siteId: 'a', threshold: 7 })
      expect(Object.values(exp.get()['a:ssl'].byExpiry)[0]).toMatchObject({ lastThreshold: 7 })
      expect(r).toMatchObject({ expiryAlerts: 1, delivered: true })
    })

    it('healthy expiry sends nothing', async () => {
      const { d, sendExpiry } = expiryDeps([site('a')])
      const r = await runAlertCheck(d)
      expect(sendExpiry).not.toHaveBeenCalled()
      expect(r.expiryAlerts).toBe(0)
    })

    it('a failed expiry send does not record the alert, so it retries next run', async () => {
      const exp = memExpiryStore()
      const failing = vi.fn().mockResolvedValue({ ok: false, detail: 'Resend returned 500' })
      const r1 = await runAlertCheck(expiryDeps([site('a', false, 5)], memStore(), exp, failing).d)
      expect(r1).toMatchObject({ expiryAlerts: 1, delivered: false })
      expect(exp.get()['a:ssl']).toBeUndefined()
      const good = vi.fn().mockResolvedValue({ ok: true, detail: 'sent' })
      await runAlertCheck(expiryDeps([site('a', false, 5)], memStore(), exp, good).d)
      await runAlertCheck(expiryDeps([site('a', false, 5)], memStore(), exp, good).d)
      expect(good).toHaveBeenCalledTimes(1)
    })

    it('a failed status send does not roll back an expiry alert that was delivered', async () => {
      const status = memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } })
      const { d, exp } = expiryDeps([site('a', true, 5)], status, memExpiryStore(), undefined, vi.fn().mockResolvedValue({ ok: false, detail: 'x' }))
      const r = await runAlertCheck(d)
      expect(r.delivered).toBe(false)
      expect(status.get().a).toMatchObject({ alerted: false })
      expect(Object.values(exp.get()['a:ssl'].byExpiry)[0]).toMatchObject({ lastThreshold: 7 })
    })

    it('a failed expiry send does not roll back a delivered status alert', async () => {
      const status = memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } })
      const { d } = expiryDeps([site('a', true, 5)], status, memExpiryStore(), vi.fn().mockResolvedValue({ ok: false, detail: 'x' }))
      const r = await runAlertCheck(d)
      expect(r.delivered).toBe(false)
      expect(status.get().a).toMatchObject({ alerted: true })
    })

    it('an expiry store that cannot load fails the run before any email', async () => {
      const exp = { store: { load: vi.fn().mockRejectedValue(new Error('db down')), save: vi.fn() } as any, get: () => ({}) }
      const { d, send, sendExpiry } = expiryDeps([site('a', true, 5)], memStore({ a: { status: 'fail', failStreak: 1, alerted: false, since: NOW } }), exp as any)
      await expect(runAlertCheck(d)).rejects.toThrow('db down')
      expect(send).not.toHaveBeenCalled()
      expect(sendExpiry).not.toHaveBeenCalled()
    })

    it('a failing status save still saves the expiry state (so its emails are not re-sent)', async () => {
      const status = memStore()
      ;(status.store.save as any).mockRejectedValue(new Error('status db down'))
      const { d, exp } = expiryDeps([site('a', false, 5)], status)
      await expect(runAlertCheck(d)).rejects.toThrow('status db down')
      expect(exp.store.save).toHaveBeenCalled()
      expect(Object.keys(exp.get())).toContain('a:ssl')
    })

    it('without an expiry store nothing expiry-related runs', async () => {
      const m = memStore()
      const d = deps([site('a', false, 5)], m.store)
      const r = await runAlertCheck(d)
      expect(r.expiryAlerts).toBe(0)
    })
  })
})
