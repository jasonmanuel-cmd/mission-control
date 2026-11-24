import { checkSSL as realCheckSSL, type SSLInfo } from '@/lib/ssl'
import { sslPart, checkDomainExpiry, type ExpiryPart } from './parts'
import type { ExpiryCache, SiteExpiry } from './cache'

export const EXPIRY_TTL_MS = 12 * 60 * 60 * 1000

export interface ExpiryDeps {
  checkSSL: (host: string) => Promise<SSLInfo>
  checkDomain: (host: string) => Promise<ExpiryPart>
  cache?: ExpiryCache
  now: () => number
}

const defaults = (): ExpiryDeps => ({
  checkSSL: realCheckSSL,
  checkDomain: host => checkDomainExpiry(host),
  cache: undefined,
  now: () => Date.now(),
})

const hostOf = (url: string) => url.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '')

async function safe(fn: () => Promise<ExpiryPart>): Promise<ExpiryPart> {
  try {
    return await fn()
  } catch (err: any) {
    return { status: 'nodata', detail: String(err?.message ?? err) }
  }
}

/**
 * SSL + domain expiry for a site, cached for 12h. Cache errors never fail the lookup (we fall back to
 * live data), and a result where both parts are nodata is not cached so the next run retries.
 */
export async function getExpiry(site: { id: string; url: string }, overrides: Partial<ExpiryDeps> = {}): Promise<SiteExpiry> {
  const deps = { ...defaults(), ...overrides }
  const nowMs = deps.now()

  if (deps.cache) {
    try {
      const hit = await deps.cache.get(site.id, EXPIRY_TTL_MS, nowMs)
      if (hit) return hit
    } catch {
      /* fall through to a live lookup */
    }
  }

  const host = hostOf(site.url)
  const [ssl, domain] = await Promise.all([
    safe(async () => sslPart(await deps.checkSSL(host), nowMs)),
    safe(() => deps.checkDomain(host)),
  ])
  const result: SiteExpiry = { ssl, domain, checkedAt: new Date(nowMs).toISOString() }

  if (deps.cache && !(ssl.status === 'nodata' && domain.status === 'nodata')) {
    try {
      await deps.cache.set(site.id, result)
    } catch {
      /* best effort */
    }
  }
  return result
}
