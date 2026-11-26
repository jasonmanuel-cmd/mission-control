import { createPgStateStore, type Exec } from '@/lib/alerts/store'
import type { ExpiryPart } from './parts'

export interface SiteExpiry {
  ssl: ExpiryPart
  domain: ExpiryPart
  /** When the full lookup ran; the 12h refresh clock. */
  checkedAt: string
  /** When a nodata part was last re-tried on its own; spaces retries so a rate-limited registry is not hammered. */
  retriedAt?: string
}

export interface ExpiryCache {
  get(siteId: string, maxAgeMs: number, nowMs: number): Promise<SiteExpiry | null>
  set(siteId: string, value: SiteExpiry): Promise<void>
}

/** Expiry lookups cached in Postgres (table expiry_cache). Errors reject; callers swallow them. */
export function createPgExpiryCache(exec: Exec): ExpiryCache {
  const store = createPgStateStore<SiteExpiry>(exec, 'expiry_cache')
  return {
    async get(siteId, maxAgeMs, nowMs) {
      const hit = (await store.load())[siteId]
      if (!hit) return null
      const age = nowMs - Date.parse(hit.checkedAt)
      return Number.isFinite(age) && age <= maxAgeMs ? hit : null
    },
    async set(siteId, value) {
      // Per-key upsert: parallel writers (all sites at once) must not delete each other's rows.
      await store.upsert(siteId, value)
    },
  }
}
