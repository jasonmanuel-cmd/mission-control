import { NextRequest, NextResponse } from 'next/server'
import { toSiteUrl } from '@/lib/url'
import { readSites } from '@/lib/sites'
import { checkVercelDeploy, toLegacyDeployStatus } from '@/lib/triage/vercel'

export const dynamic = 'force-dynamic'
// HEAD checks (10s each) + Better Stack + Vercel lookups can exceed a 10s default on hosts that honour this.
export const maxDuration = 30

interface SiteStatus {
  id: string
  name: string
  url: string
  githubRepo?: string
  vercelProject?: string
  status: 'online' | 'offline' | 'degraded' | 'loading'
  /** null = no real data (Better Stack not configured / no monitor); never an invented number */
  uptime: number | null
  responseTime: number
  performance: number
  lastDeployStatus?: 'success' | 'failed' | 'building'
  lastDeployTime?: string
  /** null = not scanned here */
  securityIssues: number | null
  lastChecked: string
}

// Check if a site is online by making an HTTP request
async function checkSiteStatus(url: string): Promise<{ online: boolean; responseTime: number }> {
  const startTime = Date.now()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    const response = await fetch(toSiteUrl(url), {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'COAI-CommandCenter/1.0'
      }
    })

    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime

    return {
      online: response.ok || response.status < 500,
      responseTime
    }
  } catch (error) {
    return {
      online: false,
      responseTime: Date.now() - startTime
    }
  }
}

// Fetch Better Stack uptime data
async function fetchBetterStackData(betterStackKey?: string): Promise<Map<string, { uptime: number | null; responseTime: number }>> {
  const apiKey = betterStackKey || process.env.BETTER_STACK_UPTIME_API_KEY
  const dataMap = new Map<string, { uptime: number | null; responseTime: number }>()

  if (!apiKey) {
    return dataMap
  }

  try {
    const response = await fetch('https://uptime.betterstack.com/api/v2/monitors', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      next: { revalidate: 30 }
    })

    if (!response.ok) {
      return dataMap
    }

    const data = await response.json()
    const monitors = data.data || []

    for (const monitor of monitors) {
      const url = monitor.attributes.url
        ?.replace('https://', '')
        .replace('http://', '')
        .replace(/\/$/, '')

      if (url) {
        // Fetch SLA data for this monitor
        try {
          const slaResponse = await fetch(
            `https://uptime.betterstack.com/api/v2/monitors/${monitor.id}/sla`,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              }
            }
          )

          if (slaResponse.ok) {
            const slaData = await slaResponse.json()
            dataMap.set(url, {
              uptime: slaData.data?.attributes?.availability ?? null,
              responseTime: slaData.data?.attributes?.average_response_time || 0
            })
          }
        } catch (e) {
          dataMap.set(url, { uptime: null, responseTime: 0 })
        }
      }
    }
  } catch (error) {
    console.error('Better Stack API error:', error)
  }

  return dataMap
}

// Main API handler
export async function GET(request: NextRequest) {
  try {
    const allSites = await readSites()

    const betterStackKey = request.headers.get('x-api-key-betterstack') || undefined
    // Vercel token stays server-side (env only); never read from a browser header.
    const vercelEnv = { token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID }


    // Latest Vercel deploy per site (only for sites that have a vercelProject). Started now so it runs
    // alongside the HEAD checks and Better Stack instead of after them.
    const deployPromises = allSites.map(async site => {
      if (!site.vercelProject) return undefined
      try {
        return toLegacyDeployStatus(await checkVercelDeploy(site.vercelProject, vercelEnv))
      } catch {
        return undefined
      }
    })

    const [betterStackData, ...siteChecks] = await Promise.all([
      fetchBetterStackData(betterStackKey),
      ...allSites.map(site => checkSiteStatus(site.url))
    ])
    const deployStatuses = await Promise.all(deployPromises)

    // Build response
    const sites: SiteStatus[] = allSites.map((site, index) => {
      const siteCheck = siteChecks[index]
      const betterStackInfo = betterStackData.get(site.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))
      const deployStatus = deployStatuses[index]

      // Determine status
      let status: SiteStatus['status'] = 'loading'
      if (siteCheck.online) {
        status = siteCheck.responseTime > 3000 ? 'degraded' : 'online'
      } else {
        status = 'offline'
      }

      // Use Better Stack data if available, otherwise use direct check
      const uptime = betterStackInfo?.uptime ?? null
      const responseTime = betterStackInfo?.responseTime || siteCheck.responseTime

      // Calculate a simple performance score based on response time
      let performance = 100
      if (responseTime > 500) performance = 90
      if (responseTime > 1000) performance = 80
      if (responseTime > 2000) performance = 70
      if (responseTime > 3000) performance = 60
      if (responseTime > 5000) performance = 50

      return {
        id: site.id,
        name: site.name,
        url: site.url,
        githubRepo: site.githubRepo,
        vercelProject: site.vercelProject,
        status,
        uptime: uptime === null ? null : Math.round(uptime * 10) / 10,
        responseTime: Math.round(responseTime),
        performance,
        lastDeployStatus: deployStatus?.status,
        lastDeployTime: deployStatus?.time || undefined,
        securityIssues: null,
        lastChecked: new Date().toISOString()
      }
    })

    return NextResponse.json({
      sites,
      timestamp: new Date().toISOString(),
      totalSites: sites.length,
      onlineCount: sites.filter(s => s.status === 'online').length
    })
  } catch (error) {
    console.error('Failed to fetch sites status:', error)
    if (error instanceof Error && error.message.startsWith('sites.json:')) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      { error: 'Failed to fetch sites status' },
      { status: 500 }
    )
  }
}
