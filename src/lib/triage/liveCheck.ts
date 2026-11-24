import { toSiteUrl } from '@/lib/url'
import type { TriagePart } from './status'

export interface LiveCheckOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxRedirects?: number
  now?: () => number
}

export type LiveResult = TriagePart & { ms?: number; finalUrl?: string; httpStatus?: number }

const SLOW_MS = 3000

export async function checkLive(url: string, opts: LiveCheckOptions = {}): Promise<LiveResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 10_000
  const maxRedirects = opts.maxRedirects ?? 5
  const now = opts.now ?? (() => performance.now())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = now()
  let current = toSiteUrl(url)

  try {
    for (let hops = 0; ; hops++) {
      const res = await fetchImpl(current, { redirect: 'manual', signal: controller.signal })
      const isRedirect = res.status >= 300 && res.status < 400 && res.headers.get('location')
      if (isRedirect) {
        if (hops >= maxRedirects) {
          return { status: 'fail', detail: `too many redirects (>${maxRedirects})`, finalUrl: current }
        }
        current = new URL(res.headers.get('location')!, current).toString()
        continue
      }

      const ms = Math.round(now() - start)
      const base = { ms, finalUrl: current, httpStatus: res.status }
      if (res.status >= 500) return { ...base, status: 'fail', detail: `HTTP ${res.status}` }
      if (res.status !== 200) return { ...base, status: 'warn', detail: `HTTP ${res.status}` }
      const body = await res.text()
      if (!body.trim()) return { ...base, status: 'warn', detail: 'empty body' }
      if (ms > SLOW_MS) return { ...base, status: 'warn', detail: `slow response (${ms} ms)` }
      return { ...base, status: 'ok', detail: `HTTP 200 in ${ms} ms` }
    }
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError'
    return { status: 'fail', detail: timedOut ? `timeout after ${timeoutMs} ms` : String(err?.message ?? err), finalUrl: current }
  } finally {
    clearTimeout(timer)
  }
}
