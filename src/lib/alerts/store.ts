import { neon } from '@neondatabase/serverless'
import type { SiteAlertState } from './decide'

export type Exec = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export interface StateStore<T> {
  load(): Promise<Record<string, T>>
  save(state: Record<string, T>): Promise<void>
}

/** Adds a single-key upsert that never deletes other keys (safe for parallel writers). */
export interface KeyedStateStore<T> extends StateStore<T> {
  upsert(key: string, value: T): Promise<void>
}

export type AlertStore = StateStore<SiteAlertState>

const TABLE_NAME = /^[a-z_]+$/

/**
 * Postgres-backed key/value state (site_id -> jsonb). The table is created on first use.
 * `table` is interpolated into SQL, so it must be a constant lowercase identifier.
 */
export function createPgStateStore<T>(exec: Exec, table: string): KeyedStateStore<T> {
  if (!TABLE_NAME.test(table)) throw new Error(`invalid table name: ${JSON.stringify(table)}`)

  let ready: Promise<unknown> | null = null
  const ensureTable = () => {
    if (!ready) {
      ready = exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          site_id text PRIMARY KEY,
          state jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`).catch(err => {
        ready = null // allow a retry on the next call
        throw err
      })
    }
    return ready
  }

  return {
    async load() {
      await ensureTable()
      const rows = await exec(`SELECT site_id, state FROM ${table}`)
      const out: Record<string, T> = {}
      for (const r of rows) {
        const state = typeof r.state === 'string' ? JSON.parse(r.state) : r.state
        out[r.site_id as string] = state as T
      }
      return out
    },

    async upsert(key, value) {
      await ensureTable()
      await exec(
        `INSERT INTO ${table} (site_id, state, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (site_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [key, JSON.stringify(value)]
      )
    },

    async save(state) {
      await ensureTable()
      // One statement = atomic: upsert every present key and delete the rest together.
      await exec(
        `WITH input AS (
           SELECT key AS site_id, value AS state FROM jsonb_each($1::jsonb)
         ), upserted AS (
           INSERT INTO ${table} (site_id, state, updated_at)
           SELECT site_id, state, now() FROM input
           ON CONFLICT (site_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
           RETURNING site_id
         )
         DELETE FROM ${table} WHERE site_id NOT IN (SELECT site_id FROM input)`,
        [JSON.stringify(state)]
      )
    },
  }
}

/** Alert state (last status per site). */
export function createPgStore(exec: Exec): AlertStore {
  return createPgStateStore<SiteAlertState>(exec, 'alert_state')
}

/** Wrap a Neon connection string as an Exec. */
export function neonExec(databaseUrl: string): Exec {
  const sql = neon(databaseUrl)
  return async (text, params = []) => (await sql.query(text, params)) as Record<string, unknown>[]
}
