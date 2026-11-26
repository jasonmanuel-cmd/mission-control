import { NextRequest, NextResponse } from 'next/server'
import { readSites } from '@/lib/sites'
import { runTriage } from '@/lib/triage/run'
import { runAlertCheck } from '@/lib/alerts/run'
import { createPgStore, createPgStateStore, neonExec } from '@/lib/alerts/store'
import type { ExpiryAlertState } from '@/lib/expiry/decide'
import { sendExpiryEmail } from '@/lib/expiry/email'
import { sendAlertEmail } from '@/lib/alerts/email'
import { isAuthorized } from '@/lib/alerts/auth'

export const dynamic = 'force-dynamic'
// Triage (live probe 8s) + email (8s) + database can exceed 10s; hosts that honour this get room.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (!isAuthorized(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured (alert state needs a database)' }, { status: 503 })
  }

  try {
    const exec = neonExec(databaseUrl)
    const emailConfig = {
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO,
    }
    const result = await runAlertCheck({
      readSites,
      runTriage: sites => runTriage(sites),
      store: createPgStore(exec),
      send: alerts => sendAlertEmail(alerts, emailConfig),
      expiryStore: createPgStateStore<ExpiryAlertState>(exec, 'expiry_alert_state'),
      sendExpiry: alerts => sendExpiryEmail(alerts, emailConfig),
      now: () => new Date().toISOString(),
    })
    // Non-2xx when alerts could not be delivered, so the GitHub workflow turns red instead of failing silently.
    return NextResponse.json(result, { status: result.delivered ? 200 : 502 })
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
}
