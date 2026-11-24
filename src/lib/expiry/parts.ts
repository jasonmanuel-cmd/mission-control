import type { PartStatus } from '@/lib/triage/status'
import type { SSLInfo } from '@/lib/ssl'

export const WARN_DAYS = 30
export const FAIL_DAYS = 7

export interface ExpiryPart {
  status: PartStatus
  detail: string
  days?: number
  expiresAt?: string
}

const DAY_MS = 86_400_000

export function statusForDays(days: number): PartStatus {
  if (days <= FAIL_DAYS) return 'fail'
  if (days <= WARN_DAYS) return 'warn'
  return 'ok'
}

/** Whole days from now until `iso` (negative once past). */
export function daysUntil(iso: string, nowMs: number): number {
  return Math.floor((Date.parse(iso) - nowMs) / DAY_MS)
}

function partFromExpiry(label: string, expiresAt: string, nowMs: number): ExpiryPart {
  const days = daysUntil(expiresAt, nowMs)
  const status = statusForDays(days)
  const detail = days < 0 ? `${label} expired ${-days} day(s) ago` : days === 0 ? `${label} expires today` : `${label} expires in ${days} day(s)`
  return { status, detail, days, expiresAt }
}

/** Uses validTo (not the clamped daysRemaining). Errors and missing data are nodata, never "expired". */
export function sslPart(info: SSLInfo, nowMs: number): ExpiryPart {
  if (info.error) return { status: 'nodata', detail: `SSL check failed: ${info.error}` }
  if (!info.validTo || Number.isNaN(Date.parse(info.validTo))) return { status: 'nodata', detail: 'certificate has no readable expiry' }
  return partFromExpiry('certificate', info.validTo, nowMs)
}

const MULTI_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'com.br'])

/** Registrable domain: last two labels, or three under a known multi-part suffix. */
export function rootDomain(host: string): string {
  const clean = host.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').toLowerCase()
  const labels = clean.split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

export async function checkDomainExpiry(
  host: string,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
  timeoutMs = 8000
): Promise<ExpiryPart> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${rootDomain(host)}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: controller.signal,
    })
    if (!res.ok) return { status: 'nodata', detail: `RDAP lookup returned ${res.status}` }
    const data = await res.json()
    const exp = (data?.events as { eventAction?: string; eventDate?: string }[] | undefined)?.find(e => e.eventAction === 'expiration')
    if (!exp?.eventDate || Number.isNaN(Date.parse(exp.eventDate))) return { status: 'nodata', detail: 'registry returned no expiration date' }
    return partFromExpiry('domain', exp.eventDate, nowMs)
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError'
    return { status: 'nodata', detail: timedOut ? `RDAP timeout after ${timeoutMs} ms` : String(err?.message ?? err) }
  } finally {
    clearTimeout(timer)
  }
}
