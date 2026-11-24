import type { SiteExpiry } from './cache'
import type { ExpiryPart, ExpiryKind } from './parts'

export type { ExpiryKind }

/** Days-left thresholds that each trigger one email. SSL starts at 14: auto-renewing certs normally dip under 30. */
export const EXPIRY_THRESHOLDS: Record<ExpiryKind, number[]> = {
  ssl: [14, 7, 3, 1],
  domain: [30, 14, 7, 3, 1],
}

export interface ExpiryAlertState {
  /** Smallest threshold already emailed for the current expiry date (null = none yet). */
  lastThreshold: number | null
  expiredAlerted: boolean
  expiresAt: string
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

const ASC: Record<ExpiryKind, number[]> = {
  ssl: [...EXPIRY_THRESHOLDS.ssl].sort((a, b) => a - b),
  domain: [...EXPIRY_THRESHOLDS.domain].sort((a, b) => a - b),
}

/**
 * Pure expiry alert decision. Emails once per threshold per expiry date (domain 30/14/7/3/1, SSL 14/7/3/1)
 * and once on expiry. A later expiry date (renewal) or being back above the top threshold re-arms everything.
 * Parts without data (nodata) never alert and keep their previous state.
 */
export function decideExpiryAlerts(
  prev: Record<string, ExpiryAlertState>,
  rows: { id: string; name: string; url: string; expiry: SiteExpiry }[],
  _nowIso: string
): { alerts: ExpiryAlert[]; next: Record<string, ExpiryAlertState> } {
  const alerts: ExpiryAlert[] = []
  const next: Record<string, ExpiryAlertState> = {}

  for (const site of rows) {
    for (const what of ['ssl', 'domain'] as ExpiryKind[]) {
      const key = `${site.id}:${what}`
      const part: ExpiryPart = site.expiry[what]
      const before = prev[key]

      if (part.status === 'nodata' || part.days === undefined || !part.expiresAt) {
        if (before) next[key] = before
        continue
      }

      const { days, expiresAt } = part
      const asc = ASC[what]
      const maxThreshold = asc[asc.length - 1]
      const renewed = before ? Date.parse(expiresAt) > Date.parse(before.expiresAt) : false
      const fresh: ExpiryAlertState = { lastThreshold: null, expiredAlerted: false, expiresAt }
      let state: ExpiryAlertState = !before || renewed || days > maxThreshold ? fresh : { ...before, expiresAt }

      const base = { what, siteId: site.id, name: site.name, url: site.url, days, expiresAt }
      if (days <= 0) {
        if (!state.expiredAlerted) alerts.push({ type: 'expired', ...base })
        state = { ...state, expiredAlerted: true, lastThreshold: asc[0] }
      } else {
        const t = asc.find(th => days <= th)
        if (t !== undefined && (state.lastThreshold === null || t < state.lastThreshold)) {
          alerts.push({ type: 'expiring', ...base, threshold: t })
          state = { ...state, lastThreshold: t }
        }
      }
      next[key] = state
    }
  }

  return { alerts, next }
}
