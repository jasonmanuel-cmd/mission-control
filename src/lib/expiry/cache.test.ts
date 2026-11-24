import { describe, it, expect } from 'vitest'
import { createPgStateStore, type Exec } from '@/lib/alerts/store'
import { createPgExpiryCache, type SiteExpiry } from './cache'

/** In-memory Postgres stand-in that records full SQL and keeps rows per table name. */
function fakeDb() {
  const tables = new Map<string, Map<string, unknown>>()
  const sql: string[] = []
  const tableOf = (text: string) => /(?:EXISTS|FROM|INTO)\s+([a-z_]+)/i.exec(text)![1]
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, new Map()); return tables.get(t)! }
  const exec: Exec = async (text, params = []) => {
    sql.push(text)
    const t = text.trim().toUpperCase()
    if (t.startsWith('CREATE TABLE')) return []
    if (t.startsWith('SELECT')) return [...rowsOf(tableOf(text))].map(([site_id, state]) => ({ site_id, state }))
    if (t.startsWith('WITH')) {
      const rows = rowsOf(tableOf(text.slice(text.indexOf('INSERT'))))
      const desired = JSON.parse(params[0] as string) as Record<string, unknown>
      rows.clear()
      for (const [k, v] of Object.entries(desired)) rows.set(k, v)
      return []
    }
    throw new Error(`unexpected SQL: ${text}`)
  }
  return { exec, sql }
}

const NOW = Date.parse('2026-11-24T12:00:00Z')
const HOUR = 3600_000
const expiry = (checkedAt: string): SiteExpiry => ({
  ssl: { status: 'ok', detail: 'x', days: 90 },
  domain: { status: 'ok', detail: 'y', days: 300 },
  checkedAt,
})

describe('createPgStateStore', () => {
  it('uses the given table name', async () => {
    const db = fakeDb()
    const store = createPgStateStore<{ n: number }>(db.exec, 'other_table')
    await store.save({ a: { n: 1 } })
    expect(db.sql.some(q => /other_table/.test(q))).toBe(true)
    expect(await store.load()).toEqual({ a: { n: 1 } })
  })

  it('keeps tables separate', async () => {
    const db = fakeDb()
    const a = createPgStateStore<number>(db.exec, 'table_a')
    const b = createPgStateStore<number>(db.exec, 'table_b')
    await a.save({ x: 1 })
    expect(await b.load()).toEqual({})
  })

  it.each(['x; drop table y', 'Bad-Name', '', 'a b'])('rejects invalid table name %j', name => {
    expect(() => createPgStateStore(fakeDb().exec, name)).toThrow(/table/i)
  })
})

describe('createPgExpiryCache', () => {
  it('get returns null when empty', async () => {
    expect(await createPgExpiryCache(fakeDb().exec).get('a', 12 * HOUR, NOW)).toBeNull()
  })

  it('returns a fresh value', async () => {
    const cache = createPgExpiryCache(fakeDb().exec)
    const v = expiry(new Date(NOW - 2 * HOUR).toISOString())
    await cache.set('a', v)
    expect(await cache.get('a', 12 * HOUR, NOW)).toEqual(v)
  })

  it('returns null when older than maxAge', async () => {
    const cache = createPgExpiryCache(fakeDb().exec)
    await cache.set('a', expiry(new Date(NOW - 13 * HOUR).toISOString()))
    expect(await cache.get('a', 12 * HOUR, NOW)).toBeNull()
  })

  it('a second set for another site keeps the first', async () => {
    const cache = createPgExpiryCache(fakeDb().exec)
    const fresh = new Date(NOW - HOUR).toISOString()
    await cache.set('a', expiry(fresh))
    await cache.set('b', expiry(fresh))
    expect(await cache.get('a', 12 * HOUR, NOW)).not.toBeNull()
    expect(await cache.get('b', 12 * HOUR, NOW)).not.toBeNull()
  })

  it('database errors reject (callers decide to swallow)', async () => {
    const boom: Exec = async () => { throw new Error('connection refused') }
    await expect(createPgExpiryCache(boom).get('a', HOUR, NOW)).rejects.toThrow('connection refused')
    await expect(createPgExpiryCache(boom).set('a', expiry(new Date(NOW).toISOString()))).rejects.toThrow('connection refused')
  })
})
