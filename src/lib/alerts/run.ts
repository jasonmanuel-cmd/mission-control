import type { SiteConfig } from '@/lib/siteConfig'
import type { SiteTriage } from '@/lib/triage/run'
import { decideAlerts, type Alert, type SiteAlertState } from './decide'
import type { AlertStore, StateStore } from './store'
import type { SendResult } from './email'
import { decideExpiryAlerts, type ExpiryAlert, type ExpiryAlertState } from '@/lib/expiry/decide'

export interface AlertRunDeps {
  readSites: () => Promise<SiteConfig[]>
  runTriage: (sites: SiteConfig[]) => Promise<SiteTriage[]>
  store: AlertStore
  send: (alerts: Alert[]) => Promise<SendResult>
  /** Optional: SSL/domain expiry warnings. Both must be given to enable them. */
  expiryStore?: StateStore<ExpiryAlertState>
  sendExpiry?: (alerts: ExpiryAlert[]) => Promise<SendResult>
  now: () => string
}

export interface AlertRunResult {
  checked: number
  alerts: number
  expiryAlerts: number
  delivered: boolean
  detail: string
}

/**
 * One alert pass. Loads state first so a dead store fails before any email goes out.
 * For alerts whose email failed, state is rolled back just enough that they retry next run.
 */
export async function runAlertCheck(deps: AlertRunDeps): Promise<AlertRunResult> {
  const expiryEnabled = Boolean(deps.expiryStore && deps.sendExpiry)

  // Load every store before any network call or email, so a dead database fails the run cleanly.
  const prev = await deps.store.load()
  const prevExpiry = expiryEnabled ? await deps.expiryStore!.load() : {}
  const sites = await deps.readSites()
  const triage = await deps.runTriage(sites)
  const nowIso = deps.now()

  // Status (DOWN / RECOVERED) alerts.
  const { alerts, next } = decideAlerts(prev, triage, nowIso)
  let delivered = true
  const details: string[] = []
  let toSave: Record<string, SiteAlertState> = next

  if (alerts.length > 0) {
    const result = await deps.send(alerts)
    delivered = result.ok
    details.push(result.detail)
    if (!result.ok) {
      toSave = { ...next }
      for (const a of alerts) {
        if (a.kind === 'recovered') {
          // Undo the recovery entirely so the next run sees fail->ok again and re-sends it.
          toSave[a.siteId] = prev[a.siteId]
        } else {
          // Keep the failure streak but leave it un-alerted so the down alert retries.
          toSave[a.siteId] = { ...next[a.siteId], alerted: false }
        }
      }
    }
  }

  // Expiry warnings are independent: one category failing never rolls back the other.
  let expiryAlertCount = 0
  let toSaveExpiry: Record<string, ExpiryAlertState> | null = null
  if (expiryEnabled) {
    const decided = decideExpiryAlerts(prevExpiry, triage, nowIso)
    expiryAlertCount = decided.alerts.length
    toSaveExpiry = decided.next
    if (decided.alerts.length > 0) {
      const result = await deps.sendExpiry!(decided.alerts)
      details.push(`expiry: ${result.detail}`)
      if (!result.ok) {
        delivered = false
        toSaveExpiry = { ...decided.next }
        for (const a of decided.alerts) {
          const key = `${a.siteId}:${a.what}`
          // Put the key back exactly as it was (or remove it) so the warning retries next run.
          if (prevExpiry[key]) toSaveExpiry[key] = prevExpiry[key]
          else delete toSaveExpiry[key]
        }
      }
    }
  }

  // Attempt both saves even if one fails: the emails already went out, and skipping the second save would
  // make the next run send its warnings again. Then surface the first failure.
  const saves = [deps.store.save(toSave)]
  if (toSaveExpiry) saves.push(deps.expiryStore!.save(toSaveExpiry))
  const settled = await Promise.allSettled(saves)
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason

  const detail = details.length > 0 ? details.join('; ') : 'no alerts'
  return { checked: triage.length, alerts: alerts.length, expiryAlerts: expiryAlertCount, delivered, detail }
}
