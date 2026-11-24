import type { SiteConfig } from '@/lib/siteConfig'
import type { SiteTriage } from '@/lib/triage/run'
import { decideAlerts, type Alert, type SiteAlertState } from './decide'
import type { AlertStore } from './store'
import type { SendResult } from './email'

export interface AlertRunDeps {
  readSites: () => Promise<SiteConfig[]>
  runTriage: (sites: SiteConfig[]) => Promise<SiteTriage[]>
  store: AlertStore
  send: (alerts: Alert[]) => Promise<SendResult>
  now: () => string
}

export interface AlertRunResult {
  checked: number
  alerts: number
  delivered: boolean
  detail: string
}

/**
 * One alert pass. Loads state first so a dead store fails before any email goes out.
 * For alerts whose email failed, state is rolled back just enough that they retry next run.
 */
export async function runAlertCheck(deps: AlertRunDeps): Promise<AlertRunResult> {
  const prev = await deps.store.load()
  const sites = await deps.readSites()
  const triage = await deps.runTriage(sites)

  const { alerts, next } = decideAlerts(prev, triage, deps.now())

  let delivered = true
  let detail = alerts.length === 0 ? 'no alerts' : ''
  let toSave: Record<string, SiteAlertState> = next

  if (alerts.length > 0) {
    const result = await deps.send(alerts)
    delivered = result.ok
    detail = result.detail
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

  await deps.store.save(toSave)
  return { checked: triage.length, alerts: alerts.length, delivered, detail }
}
