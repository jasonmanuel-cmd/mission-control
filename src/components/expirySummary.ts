import type { SiteExpiry } from '@/lib/expiry/cache'
import { currentDays, statusForDays, type ExpiryKind, type ExpiryPart } from '@/lib/expiry/parts'
import { worstStatus, type PartStatus } from '@/lib/triage/status'

interface Shown {
  status: PartStatus
  text: string
}

/** Days and status are recomputed from the expiry date, because a cached part can be hours old. */
function show(part: ExpiryPart, kind: ExpiryKind, nowMs: number): Shown {
  const days = currentDays(part, nowMs)
  if (part.status === 'nodata' || days === undefined) return { status: 'nodata', text: 'no data' }
  const expired = part.expiresAt ? Date.parse(part.expiresAt) <= nowMs : days <= 0
  return { status: statusForDays(days, kind), text: expired ? 'expired' : `${days}d` }
}

/** Text/colour for the board's Expiry cell. Follows whichever parts have data; both nodata is grey. */
export function expirySummary(expiry: SiteExpiry, nowMs: number = Date.now()): { status: PartStatus; text: string; title: string } {
  const ssl = show(expiry.ssl, 'ssl', nowMs)
  const domain = show(expiry.domain, 'domain', nowMs)
  const withData = [ssl, domain].filter(s => s.status !== 'nodata')
  return {
    status: withData.length === 0 ? 'nodata' : worstStatus(withData.map(s => s.status)),
    text: `SSL ${ssl.text} · Domain ${domain.text}`,
    title: `${expiry.ssl.detail}\n${expiry.domain.detail}`,
  }
}
