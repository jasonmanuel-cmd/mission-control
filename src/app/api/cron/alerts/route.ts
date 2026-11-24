import { NextRequest, NextResponse } from 'next/server'
import { readSites } from '@/lib/sites'
import { runTriage } from '@/lib/triage/run'
import { runAlertCheck } from '@/lib/alerts/run'
import { createPgStore, neonExec } from '@/lib/alerts/store'
import { sendAlertEmail } from '@/lib/alerts/email'
import { isAuthorized } from '@/lib/alerts/auth'

export const dynamic = 'force-dynamic'

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
    const result = await runAlertCheck({
      readSites,
      runTriage: sites => runTriage(sites),
      store: createPgStore(neonExec(databaseUrl)),
      send: alerts =>
        sendAlertEmail(alerts, {
          apiKey: process.env.RESEND_API_KEY,
          from: process.env.ALERT_EMAIL_FROM,
          to: process.env.ALERT_EMAIL_TO,
        }),
      now: () => new Date().toISOString(),
    })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
}
