import { postEmail, type EmailConfig, type SendResult } from '@/lib/alerts/email'
import type { ExpiryAlert } from './decide'

const label = (a: ExpiryAlert) => (a.what === 'ssl' ? 'SSL' : 'Domain')

function subjectFor(alerts: ExpiryAlert[]): string {
  if (alerts.length > 1) return `${alerts.length} expiry warnings`
  const a = alerts[0]
  if (a.type === 'expired') return `${label(a)} EXPIRED: ${a.name}`
  return `${label(a)} expires in ${a.days} ${a.days === 1 ? 'day' : 'days'}: ${a.name}`
}

function bodyFor(alerts: ExpiryAlert[]): string {
  return alerts
    .map(a => {
      const what = a.what === 'ssl' ? 'SSL certificate' : 'Domain registration'
      const head = a.type === 'expired' ? `${what} EXPIRED: ${a.name}` : `${what} expires in ${a.days} ${a.days === 1 ? 'day' : 'days'}: ${a.name}`
      const when = a.type === 'expired' ? `Expired on ${a.expiresAt}` : `Expires on ${a.expiresAt}`
      return [head, a.url, when].join('\n')
    })
    .join('\n\n')
}

/** One email per run for all expiry alerts. Never throws: failures come back as { ok: false }. */
export async function sendExpiryEmail(
  alerts: ExpiryAlert[],
  cfg: EmailConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<SendResult> {
  if (alerts.length === 0) return { ok: true, detail: 'no expiry alerts to send' }
  const result = await postEmail(subjectFor(alerts), bodyFor(alerts), cfg, fetchImpl, timeoutMs)
  return result.ok ? { ok: true, detail: `sent ${alerts.length} expiry alert(s)` } : result
}
