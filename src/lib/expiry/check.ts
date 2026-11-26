import { checkSSL as realCheckSSL, type SSLInfo } from '@/lib/ssl'
import { sslPart, checkDomainExpiry, type ExpiryPart } from './parts'
import type { ExpiryCache, SiteExpiry } from './cache'

export const EXPIRY_TTL_MS = 12 * 60 * 60 * 1000
const SSL_TIMEOUT_MS = 6000
/** A cached nodata part (timeout, registry rate limit) is re-tried on its own after this long, then again at the same spacing. */
const NODATA_RETRY_MS = 15 * 60 * 1000

export interface ExpiryDeps {
  checkSSL: (host: string) => Promise<SSLInfo>
  checkDomain: (host: string) => Promise<ExpiryPart>
  cache?: ExpiryCache
  now: () => number
}

const defaults = (): ExpiryDeps => ({
  // Shorter than checkSSL's 10s default so a hung host can't stretch the whole triage run.
  checkSSL: host => realCheckSSL(host, SSL_TIMEOUT_MS),
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
  const host = hostOf(site.url)
  const lookupSsl = () => safe(async () => sslPart(await deps.checkSSL(host), nowMs))
  const lookupDomain = () => safe(() => deps.checkDomain(host))

  if (deps.cache) {
    let hit: SiteExpiry | null = null
    try {
      hit = await deps.cache.get(site.id, EXPIRY_TTL_MS, nowMs)
    } catch {
      /* fall through to a live lookup */
    }
    if (hit) {
      const sslBad = hit.ssl.status === 'nodata'
      const domainBad = hit.domain.status === 'nodata'
      const lastTry = Date.parse(hit.retriedAt ?? hit.checkedAt)
      const due = !Number.isFinite(lastTry) || nowMs - lastTry >= NODATA_RETRY_MS
      if (!(due && (sslBad || domainBad))) return hit

      // Re-check only what failed. Keep the good part and the original checkedAt, so a retry never
      // extends the life of the good data (it still gets its full refresh at 12h).
      const [ssl, domain] = await Promise.all([sslBad ? lookupSsl() : hit.ssl, domainBad ? lookupDomain() : hit.domain])
      const merged: SiteExpiry = { ssl, domain, checkedAt: hit.checkedAt, retriedAt: new Date(nowMs).toISOString() }
      try {
        await deps.cache.set(site.id, merged)
      } catch {
        /* best effort */
      }
      return merged
    }
  }

  const [ssl, domain] = await Promise.all([lookupSsl(), lookupDomain()])
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
