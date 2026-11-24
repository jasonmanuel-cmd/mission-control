import type { SiteConfig } from '@/lib/siteConfig'
import { worstStatus, type PartStatus, type TriagePart } from './status'
import { checkLive } from './liveCheck'
import { checkVercelDeploy } from './vercel'
import { loadMonitorIndex, uptimeForSite } from './uptime'

export interface SiteTriage {
  id: string
  name: string
  url: string
  uptime: TriagePart
  live: TriagePart
  deploy: TriagePart
  overall: PartStatus
  checkedAt: string
}

export interface TriageDeps {
  loadMonitorIndex: typeof loadMonitorIndex
  uptimeForSite: typeof uptimeForSite
  checkLive: (url: string) => Promise<TriagePart>
  checkVercelDeploy: (project: string | undefined, env: { token?: string; teamId?: string }) => Promise<TriagePart>
  env: { betterStackKey?: string; vercelToken?: string; vercelTeamId?: string }
}

export const defaultDeps = (): TriageDeps => ({
  loadMonitorIndex,
  uptimeForSite,
  checkLive: url => checkLive(url),
  checkVercelDeploy: (project, env) => checkVercelDeploy(project, env),
  env: {
    betterStackKey: process.env.BETTER_STACK_UPTIME_API_KEY,
    vercelToken: process.env.VERCEL_TOKEN,
    vercelTeamId: process.env.VERCEL_TEAM_ID,
  },
})

async function safe(fn: () => Promise<TriagePart> | TriagePart): Promise<TriagePart> {
  try {
    return await fn()
  } catch (err: any) {
    return { status: 'nodata', detail: String(err?.message ?? err) }
  }
}

export async function runTriage(sites: SiteConfig[], deps: TriageDeps = defaultDeps()): Promise<SiteTriage[]> {
  const index = await deps.loadMonitorIndex(deps.env.betterStackKey)
  const vercelEnv = { token: deps.env.vercelToken, teamId: deps.env.vercelTeamId }

  return Promise.all(
    sites.map(async site => {
      const [uptime, live, deploy] = await Promise.all([
        safe(() => deps.uptimeForSite(site, index)),
        safe(() => deps.checkLive(site.url)),
        safe(() => deps.checkVercelDeploy(site.vercelProject, vercelEnv)),
      ])
      return {
        id: site.id,
        name: site.name,
        url: site.url,
        uptime,
        live,
        deploy,
        overall: worstStatus([uptime.status, live.status, deploy.status]),
        checkedAt: new Date().toISOString(),
      }
    })
  )
}
