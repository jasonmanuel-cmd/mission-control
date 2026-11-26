'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SiteTriage } from '@/lib/triage/run'
import type { PartStatus, TriagePart } from '@/lib/triage/status'
import { expirySummary } from './expirySummary'

const REFRESH_MS = 60_000

const CELL: Record<PartStatus, string> = {
  ok: 'bg-electric-green-500/15 text-electric-green-500 border-electric-green-500/30',
  warn: 'bg-cyber-yellow/15 text-cyber-yellow border-cyber-yellow/30',
  fail: 'bg-cyber-red/15 text-cyber-red border-cyber-red/40',
  nodata: 'bg-cyber-gray text-gray-500 border-cyber-border',
}
const ROW: Record<PartStatus, string> = {
  ok: 'border-electric-green-500/30',
  warn: 'border-cyber-yellow/40',
  fail: 'border-cyber-red/60',
  nodata: 'border-cyber-border',
}
const LABEL: Record<PartStatus, string> = { ok: 'OK', warn: 'WARN', fail: 'FAIL', nodata: 'no data' }

function Cell({ title, part }: { title: string; part: TriagePart }) {
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-0 ${CELL[part.status]}`} title={part.detail}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{title}</div>
      <div className="text-sm font-semibold">{LABEL[part.status]}</div>
      <div className="text-xs opacity-80 truncate">{part.detail}</div>
    </div>
  )
}

/** Informational: shows SSL/domain days left; never changes the row colour. */
function ExpiryCell({ expiry }: { expiry: SiteTriage['expiry'] }) {
  const { status, text, title } = expirySummary(expiry)
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-0 ${CELL[status]}`} title={title}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">Expiry</div>
      <div className="text-sm font-semibold">{LABEL[status]}</div>
      <div className="text-xs opacity-80 truncate">{text}</div>
    </div>
  )
}

export default function TriageBoard({ onSiteClick }: { onSiteClick: (siteId: string) => void }) {
  const [rows, setRows] = useState<SiteTriage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [lastChecked, setLastChecked] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sites/triage', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setRows(body as SiteTriage[])
      setError(null)
      setLastChecked(Date.now())
    } catch (err: any) {
      setError(String(err?.message ?? err))
    }
  }, [])

  useEffect(() => {
    load()
    const refresh = setInterval(load, REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(refresh)
      clearInterval(tick)
    }
  }, [load])

  const ago = lastChecked ? Math.max(0, Math.round((now - lastChecked) / 1000)) : null

  return (
    <section className="mb-8" aria-label="Triage board">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">Triage</h2>
        <span className="text-xs text-gray-500">
          {ago === null ? 'checking…' : `checked ${ago}s ago`}
          <button onClick={load} className="ml-3 text-neon-purple-500 hover:underline">Refresh</button>
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-cyber-red/50 bg-cyber-red/10 p-4 text-sm text-cyber-red mb-3">
          <span className="font-mono">{error}</span>
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      )}

      {!rows && !error && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-lg bg-cyber-gray animate-pulse" />)}
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-lg border border-cyber-border bg-cyber-dark p-4 text-sm text-gray-400">
          No sites configured. Add sites to <span className="font-mono">sites.json</span> and redeploy.
        </div>
      )}

      <div className="space-y-2">
        {rows?.map(r => (
          <button
            key={r.id}
            onClick={() => onSiteClick(r.id)}
            className={`w-full text-left rounded-xl border bg-cyber-dark p-3 hover:bg-cyber-gray transition-colors ${ROW[r.overall]}`}
          >
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))] gap-2 items-stretch">
              <div className="min-w-0 flex flex-col justify-center">
                <div className="font-semibold text-white truncate">{r.name}</div>
                <div className="text-xs text-gray-500 truncate">{r.url.replace(/^https?:\/\//, '')}</div>
              </div>
              <Cell title="Uptime" part={r.uptime} />
              <Cell title="Live site" part={r.live} />
              <Cell title="Vercel deploy" part={r.deploy} />
              <ExpiryCell expiry={r.expiry} />
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
