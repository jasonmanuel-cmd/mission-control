import { NextResponse } from 'next/server'
import { readSites } from '@/lib/sites'
import { runTriage } from '@/lib/triage/run'

export const dynamic = 'force-dynamic'
// Live probe (8s) + expiry lookups + database calls can exceed a 10s default on hosts that honour this.
export const maxDuration = 30

export async function GET() {
  let sites
  try {
    sites = await readSites()
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
  return NextResponse.json(await runTriage(sites))
}
