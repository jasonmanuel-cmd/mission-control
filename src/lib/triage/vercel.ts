import type { TriagePart } from './status'

export type DeployResult = TriagePart & { sha?: string; message?: string; createdAt?: number }

export async function checkVercelDeploy(
  project: string | undefined,
  env: { token?: string; teamId?: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000
): Promise<DeployResult> {
  if (!project) return { status: 'nodata', detail: 'no vercelProject configured', unconfigured: true }
  if (!env.token) return { status: 'nodata', detail: 'VERCEL_TOKEN not set', unconfigured: true }

  const params = new URLSearchParams({ projectId: project, limit: '1' })
  if (env.teamId) params.set('teamId', env.teamId)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${env.token}` },
      signal: controller.signal,
    })
    if (!res.ok) return { status: 'nodata', detail: `Vercel API returned ${res.status}` }

    const data = await res.json()
    const d = data?.deployments?.[0]
    if (!d) return { status: 'nodata', detail: 'no deployments found' }

    const info = {
      sha: d.meta?.githubCommitSha as string | undefined,
      message: d.meta?.githubCommitMessage as string | undefined,
      createdAt: d.created as number | undefined,
    }
    switch (d.state) {
      case 'READY':
        return { ...info, status: 'ok', detail: `deployed ${info.sha?.slice(0, 7) ?? ''} ${info.message ?? ''}`.trim() }
      case 'ERROR':
        return { ...info, status: 'fail', detail: `deploy failed: ${d.errorMessage ?? 'unknown error'}` }
      default:
        return { ...info, status: 'warn', detail: `deploy ${String(d.state).toLowerCase()}` }
    }
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError'
    return { status: 'nodata', detail: timedOut ? `Vercel API timeout after ${timeoutMs} ms` : String(err?.message ?? err) }
  } finally {
    clearTimeout(timer)
  }
}
