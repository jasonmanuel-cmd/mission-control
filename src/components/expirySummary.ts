import type { SiteExpiry } from '@/lib/expiry/cache'
import type { ExpiryPart } from '@/lib/expiry/parts'
import { worstStatus, type PartStatus } from '@/lib/triage/status'

const fmt = (part: ExpiryPart): string => {
  if (part.status === 'nodata' || part.days === undefined) return 'no data'
  return part.days <= 0 ? 'expired' : `${part.days}d`
}

/** Text/colour for the board's Expiry cell. Follows whichever parts have data; both nodata is grey. */
export function expirySummary(expiry: SiteExpiry): { status: PartStatus; text: string; title: string } {
  const withData = [expiry.ssl, expiry.domain].filter(part => part.status !== 'nodata')
  return {
    status: withData.length === 0 ? 'nodata' : worstStatus(withData.map(part => part.status)),
    text: `SSL ${fmt(expiry.ssl)} · Domain ${fmt(expiry.domain)}`,
    title: `${expiry.ssl.detail}\n${expiry.domain.detail}`,
  }
}
