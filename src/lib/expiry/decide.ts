import type { SiteExpiry } from './cache'
import type { ExpiryPart } from './parts'

export const EXPIRY_THRESHOLDS = [30, 14, 7, 3, 1]

export type ExpiryKind = 'ssl' | 'domain'

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

const ASC = [...EXPIRY_THRESHOLDS].sort((a, b) => a - b)
const MAX_THRESHOLD = ASC[ASC.length - 1]

/**
 * Pure expiry alert decision. Emails once per threshold per expiry date (30/14/7/3/1 days) and once on
 * expiry. A later expiry date (renewal) or being back above the top threshold re-arms everything.
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
      const renewed = before ? Date.parse(expiresAt) > Date.parse(before.expiresAt) : false
      const fresh: ExpiryAlertState = { lastThreshold: null, expiredAlerted: false, expiresAt }
      let state: ExpiryAlertState = !before || renewed || days > MAX_THRESHOLD ? fresh : { ...before, expiresAt }

      const base = { what, siteId: site.id, name: site.name, url: site.url, days, expiresAt }
      if (days <= 0) {
        if (!state.expiredAlerted) alerts.push({ type: 'expired', ...base })
        state = { ...state, expiredAlerted: true, lastThreshold: ASC[0] }
      } else {
        const t = ASC.find(th => days <= th)
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
