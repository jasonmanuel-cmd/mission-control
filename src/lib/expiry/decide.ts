import type { SiteExpiry } from './cache'
import type { ExpiryPart, ExpiryKind } from './parts'

export type { ExpiryKind }

/** Days-left thresholds that each trigger one email. SSL starts at 14: auto-renewing certs normally dip under 30. */
export const EXPIRY_THRESHOLDS: Record<ExpiryKind, number[]> = {
  ssl: [14, 7, 3, 1],
  domain: [30, 14, 7, 3, 1],
}

interface ExpiryRecord {
  /** Smallest threshold already emailed for this expiry date (null = none yet). */
  lastThreshold: number | null
  expiredAlerted: boolean
}

/**
 * Alert memory per (site, kind), keyed by the expiry DATE (YYYY-MM-DD). A renewal is simply a new date with
 * an empty record, and seeing an old date again (a CDN edge still serving the old cert) finds its record, so a
 * warning is never repeated. Only the 3 most recent dates are kept.
 */
export interface ExpiryAlertState {
  byExpiry: Record<string, ExpiryRecord>
}

export interface ExpiryAlert {
  type: 'expiring' | 'expired'
  what: ExpiryKind
  siteId: string
  name: string
  url: string
  days: number
  expiresAt: string
  threshold?: number
}

const DAY_MS = 86_400_000
const KEEP_DATES = 3
const ASC: Record<ExpiryKind, number[]> = {
  ssl: [...EXPIRY_THRESHOLDS.ssl].sort((a, b) => a - b),
  domain: [...EXPIRY_THRESHOLDS.domain].sort((a, b) => a - b),
}

/**
 * Pure expiry alert decision. Emails once per threshold per expiry date (domain 30/14/7/3/1, SSL 14/7/3/1)
 * and once when the expiry time passes. Days are recomputed from the expiry date at `nowIso` (cached values can
 * be hours stale), and "expired" means the expiry time has actually passed, not merely "under a day left".
 * Parts without data (nodata) never alert and keep their previous state.
 */
export function decideExpiryAlerts(
  prev: Record<string, ExpiryAlertState>,
  rows: { id: string; name: string; url: string; expiry: SiteExpiry }[],
  nowIso: string
): { alerts: ExpiryAlert[]; next: Record<string, ExpiryAlertState> } {
  const nowMs = Date.parse(nowIso)
  const alerts: ExpiryAlert[] = []
  const next: Record<string, ExpiryAlertState> = {}

  for (const site of rows) {
    for (const what of ['ssl', 'domain'] as ExpiryKind[]) {
      const key = `${site.id}:${what}`
      const part: ExpiryPart = site.expiry[what]
      const before = prev[key]

      const expiresMs = part.expiresAt ? Date.parse(part.expiresAt) : NaN
      if (part.status === 'nodata' || !part.expiresAt || Number.isNaN(expiresMs)) {
        if (before) next[key] = before
        continue
      }

      const dateKey = part.expiresAt.slice(0, 10)
      const record: ExpiryRecord = { ...(before?.byExpiry[dateKey] ?? { lastThreshold: null, expiredAlerted: false }) }
      const days = Math.floor((expiresMs - nowMs) / DAY_MS)
      const asc = ASC[what]
      const base = { what, siteId: site.id, name: site.name, url: site.url, days, expiresAt: part.expiresAt }

      if (expiresMs <= nowMs) {
        if (!record.expiredAlerted) alerts.push({ type: 'expired', ...base })
        record.expiredAlerted = true
        record.lastThreshold = asc[0]
      } else {
        const t = asc.find(th => days <= th)
        if (t !== undefined && (record.lastThreshold === null || t < record.lastThreshold)) {
          alerts.push({ type: 'expiring', ...base, threshold: t })
          record.lastThreshold = t
        }
      }

      const merged = { ...(before?.byExpiry ?? {}), [dateKey]: record }
      const kept = Object.keys(merged).sort().slice(-KEEP_DATES)
      next[key] = { byExpiry: Object.fromEntries(kept.map(k => [k, merged[k]])) }
    }
  }

  return { alerts, next }
}
