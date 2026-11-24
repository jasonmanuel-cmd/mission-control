import { NextResponse } from 'next/server'
import { readSites } from '@/lib/sites'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await readSites())
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
}
