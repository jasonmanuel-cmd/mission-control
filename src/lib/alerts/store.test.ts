import { describe, it, expect } from 'vitest'
import { createPgStore, type Exec } from './store'
import type { SiteAlertState } from './decide'

/** In-memory stand-in for Postgres that understands the statements the store issues. */
function fakeDb() {
  const rows = new Map<string, unknown>()
  const log: string[] = []
  const exec: Exec = async (text, params = []) => {
    log.push(text.trim().split(/\s+/).slice(0, 3).join(' ').toUpperCase())
    const t = text.trim().toUpperCase()
    if (t.startsWith('CREATE TABLE')) return []
    if (t.startsWith('SELECT')) return [...rows].map(([site_id, state]) => ({ site_id, state }))
    if (t.startsWith('INSERT')) {
      rows.set(params[0] as string, JSON.parse(params[1] as string))
      return []
    }
    if (t.startsWith('DELETE')) {
      const keep = new Set((params[0] as string[] | undefined) ?? [])
      for (const k of [...rows.keys()]) if (!keep.has(k)) rows.delete(k)
      return []
    }
    throw new Error(`unexpected SQL: ${text}`)
  }
  return { exec, rows, log }
}

const s = (over: Partial<SiteAlertState> = {}): SiteAlertState => ({ status: 'fail', failStreak: 2, alerted: true, since: '2026-11-24T10:00:00.000Z', ...over })

describe('createPgStore', () => {
  it('loads {} from an empty table', async () => {
    expect(await createPgStore(fakeDb().exec).load()).toEqual({})
  })

  it('round-trips saved state', async () => {
    const store = createPgStore(fakeDb().exec)
    await store.save({ a: s(), b: s({ status: 'ok', failStreak: 0, alerted: false }) })
    expect(await store.load()).toEqual({ a: s(), b: s({ status: 'ok', failStreak: 0, alerted: false }) })
  })

  it('save deletes sites that are no longer in the state', async () => {
    const store = createPgStore(fakeDb().exec)
    await store.save({ a: s(), b: s() })
    await store.save({ a: s() })
    expect(Object.keys(await store.load())).toEqual(['a'])
  })

  it('saving an empty state clears the table', async () => {
    const store = createPgStore(fakeDb().exec)
    await store.save({ a: s() })
    await store.save({})
    expect(await store.load()).toEqual({})
  })

  it('creates the table exactly once across calls', async () => {
    const db = fakeDb()
    const store = createPgStore(db.exec)
    await store.load()
    await store.save({ a: s() })
    await store.load()
    expect(db.log.filter(l => l.startsWith('CREATE TABLE')).length).toBe(1)
  })

  it('does not swallow database errors', async () => {
    const boom: Exec = async () => { throw new Error('connection refused') }
    await expect(createPgStore(boom).load()).rejects.toThrow('connection refused')
    await expect(createPgStore(boom).save({ a: s() })).rejects.toThrow('connection refused')
  })
})
