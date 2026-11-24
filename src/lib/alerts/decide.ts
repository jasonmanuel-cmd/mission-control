import type { SiteTriage } from '@/lib/triage/run'
import type { TriagePart } from '@/lib/triage/status'

export interface SiteAlertState {
  status: 'ok' | 'fail'
  failStreak: number
  alerted: boolean
  /** ISO time the current failure streak began (kept while ok for convenience) */
  since: string
}

export type AlertKind = 'down' | 'recovered'

export interface Alert {
  kind: AlertKind
  siteId: string
  name: string
  url: string
  reasons: string[]
  since: string
}

/** Consecutive failing runs required before a "down" alert (filters transient blips). */
export const FAIL_CONFIRM_RUNS = 2

const LABELS: [keyof Pick<SiteTriage, 'uptime' | 'live' | 'deploy'>, string][] = [
  ['uptime', 'Uptime'],
  ['live', 'Live site'],
  ['deploy', 'Vercel deploy'],
]

function reasonsFor(site: SiteTriage): string[] {
  return LABELS.filter(([key]) => (site[key] as TriagePart).status === 'fail').map(
    ([key, label]) => `${label}: ${(site[key] as TriagePart).detail}`
  )
}

/**
 * Pure alert decision. Only overall === 'fail' counts as failing; warn/nodata/unconfigured never alert.
 * Sites missing from `current` are dropped from the returned state.
 */
export function decideAlerts(
  prev: Record<string, SiteAlertState>,
  current: SiteTriage[],
  nowIso: string
): { alerts: Alert[]; next: Record<string, SiteAlertState> } {
  const alerts: Alert[] = []
  const next: Record<string, SiteAlertState> = {}

  for (const site of current) {
    const before = prev[site.id]
    const base = { siteId: site.id, name: site.name, url: site.url }

    if (site.overall === 'fail') {
      const streakStart = before && before.status === 'fail' ? before.since : nowIso
      const failStreak = (before?.status === 'fail' ? before.failStreak : 0) + 1
      let alerted = before?.status === 'fail' ? before.alerted : false
      if (!alerted && failStreak >= FAIL_CONFIRM_RUNS) {
        alerts.push({ kind: 'down', ...base, reasons: reasonsFor(site), since: streakStart })
        alerted = true
      }
      next[site.id] = { status: 'fail', failStreak, alerted, since: streakStart }
    } else {
      if (before?.status === 'fail' && before.alerted) {
        alerts.push({ kind: 'recovered', ...base, reasons: [], since: before.since })
      }
      next[site.id] = { status: 'ok', failStreak: 0, alerted: false, since: nowIso }
    }
  }

  return { alerts, next }
}
