import type { Alert } from './decide'

export interface EmailConfig {
  apiKey?: string
  from?: string
  to?: string
}

export interface SendResult {
  ok: boolean
  detail: string
}

function subjectFor(alerts: Alert[]): string {
  if (alerts.length === 1) {
    const a = alerts[0]
    return `${a.kind === 'down' ? 'DOWN' : 'RECOVERED'}: ${a.name}`
  }
  const down = alerts.filter(a => a.kind === 'down').length
  return `${alerts.length} site alerts (${down} down, ${alerts.length - down} recovered)`
}

function bodyFor(alerts: Alert[]): string {
  return alerts
    .map(a => {
      const head = a.kind === 'down' ? `DOWN: ${a.name}` : `RECOVERED: ${a.name}`
      const lines = [head, a.url]
      if (a.reasons.length) lines.push(...a.reasons.map(r => `  - ${r}`))
      lines.push(a.kind === 'down' ? `Failing since ${a.since}` : `Was failing since ${a.since}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** One email per run, batching every alert. Never throws: failures come back as { ok: false }. */
export async function sendAlertEmail(
  alerts: Alert[],
  cfg: EmailConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<SendResult> {
  if (alerts.length === 0) return { ok: true, detail: 'no alerts to send' }
  if (!cfg.apiKey) return { ok: false, detail: 'RESEND_API_KEY not set' }
  if (!cfg.from) return { ok: false, detail: 'ALERT_EMAIL_FROM not set' }
  if (!cfg.to) return { ok: false, detail: 'ALERT_EMAIL_TO not set' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject: subjectFor(alerts), text: bodyFor(alerts) }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, detail: `Resend returned ${res.status}` }
    return { ok: true, detail: `sent ${alerts.length} alert(s)` }
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError'
    return { ok: false, detail: timedOut ? `Resend timeout after ${timeoutMs} ms` : String(err?.message ?? err) }
  } finally {
    clearTimeout(timer)
  }
}
