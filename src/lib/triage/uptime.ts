import { fetchMonitors, type Monitor } from '@/lib/betterstack'
import type { TriagePart } from './status'

export type MonitorIndex = { monitors: Monitor[] } | { error: string; unconfigured?: boolean }

const hostOf = (u: string) =>
  u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase()

/** Fetch Better Stack monitors once per triage run. */
export async function loadMonitorIndex(
  apiKey: string | undefined,
  fetchMonitorsImpl: typeof fetchMonitors = fetchMonitors,
  timeoutMs = 5000
): Promise<MonitorIndex> {
  if (!apiKey) return { error: 'BETTER_STACK_UPTIME_API_KEY not set', unconfigured: true }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Better Stack timeout after ${timeoutMs} ms`)), timeoutMs)
    })
    return { monitors: await Promise.race([fetchMonitorsImpl(apiKey), timeout]) }
  } catch (err: any) {
    return { error: String(err?.message ?? err) }
  } finally {
    clearTimeout(timer)
  }
}

export function uptimeForSite(site: { url: string; betterStackId?: string }, index: MonitorIndex): TriagePart {
  if ('error' in index) return { status: 'nodata', detail: index.error, unconfigured: index.unconfigured }

  const monitor =
    (site.betterStackId && index.monitors.find(m => m.id === site.betterStackId)) ||
    index.monitors.find(m => hostOf(m.attributes.url) === hostOf(site.url))
  if (!monitor) return { status: 'nodata', detail: 'no Better Stack monitor for this site', unconfigured: true }

  const s = monitor.attributes.status
  if (s === 'up') return { status: 'ok', detail: 'up' }
  if (s === 'down') return { status: 'fail', detail: 'down' }
  return { status: 'warn', detail: s }
}
