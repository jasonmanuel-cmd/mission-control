import type { SiteConfig } from '@/lib/siteConfig'
import { worstStatus, type PartStatus, type TriagePart } from './status'
import { checkLive } from './liveCheck'
import { checkVercelDeploy } from './vercel'
import { loadMonitorIndex, uptimeForSite } from './uptime'
import { getExpiry } from '@/lib/expiry/check'
import { createPgExpiryCache, type SiteExpiry } from '@/lib/expiry/cache'
import { neonExec } from '@/lib/alerts/store'

export interface SiteTriage {
  id: string
  name: string
  url: string
  uptime: TriagePart
  live: TriagePart
  deploy: TriagePart
  overall: PartStatus
  /** SSL + domain days left. Informational: never feeds `overall`. */
  expiry: SiteExpiry
  checkedAt: string
}

export interface TriageDeps {
  loadMonitorIndex: typeof loadMonitorIndex
  uptimeForSite: typeof uptimeForSite
  checkLive: (url: string) => Promise<TriagePart>
  checkVercelDeploy: (project: string | undefined, env: { token?: string; teamId?: string }) => Promise<TriagePart>
  getExpiry: (site: SiteConfig) => Promise<SiteExpiry>
  env: { betterStackKey?: string; vercelToken?: string; vercelTeamId?: string }
}

export const defaultDeps = (): TriageDeps => {
  // Cache expiry lookups in Postgres when a database is configured; otherwise look up live.
  const databaseUrl = process.env.DATABASE_URL
  const cache = databaseUrl ? createPgExpiryCache(neonExec(databaseUrl)) : undefined
  return {
    loadMonitorIndex,
    uptimeForSite,
    checkLive: url => checkLive(url),
    checkVercelDeploy: (project, env) => checkVercelDeploy(project, env),
    getExpiry: site => getExpiry(site, { cache }),
    env: {
      betterStackKey: process.env.BETTER_STACK_UPTIME_API_KEY,
      vercelToken: process.env.VERCEL_TOKEN,
      vercelTeamId: process.env.VERCEL_TEAM_ID,
    },
  }
}

async function safe(fn: () => Promise<TriagePart> | TriagePart): Promise<TriagePart> {
  try {
    return await fn()
  } catch (err: any) {
    return { status: 'nodata', detail: String(err?.message ?? err) }
  }
}

/** Worst status of the parts that are set up. Unconfigured parts don't count; if none are set up, nodata. */
function overallOf(parts: TriagePart[]): PartStatus {
  const active = parts.filter(p => !p.unconfigured)
  return active.length === 0 ? 'nodata' : worstStatus(active.map(p => p.status))
}

async function safeExpiry(fn: () => Promise<SiteExpiry>): Promise<SiteExpiry> {
  try {
    return await fn()
  } catch (err: any) {
    const nodata: TriagePart = { status: 'nodata', detail: String(err?.message ?? err) }
    return { ssl: nodata, domain: nodata, checkedAt: new Date().toISOString() }
  }
}

export async function runTriage(sites: SiteConfig[], deps: TriageDeps = defaultDeps()): Promise<SiteTriage[]> {
  // Start the Better Stack load now; only the uptime part waits for it, so it overlaps the slow probes.
  const indexPromise = deps
    .loadMonitorIndex(deps.env.betterStackKey)
    .catch((err: any): { error: string } => ({ error: String(err?.message ?? err) }))
  const vercelEnv = { token: deps.env.vercelToken, teamId: deps.env.vercelTeamId }

  return Promise.all(
    sites.map(async site => {
      const [uptime, live, deploy, expiry] = await Promise.all([
        safe(async () => deps.uptimeForSite(site, await indexPromise)),
        safe(() => deps.checkLive(site.url)),
        safe(() => deps.checkVercelDeploy(site.vercelProject, vercelEnv)),
        safeExpiry(() => deps.getExpiry(site)),
      ])
      return {
        id: site.id,
        name: site.name,
        url: site.url,
        uptime,
        live,
        deploy,
        overall: overallOf([uptime, live, deploy]),
        expiry,
        checkedAt: new Date().toISOString(),
      }
    })
  )
}
