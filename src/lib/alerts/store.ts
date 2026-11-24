import { neon } from '@neondatabase/serverless'
import type { SiteAlertState } from './decide'

export type Exec = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export interface AlertStore {
  load(): Promise<Record<string, SiteAlertState>>
  save(state: Record<string, SiteAlertState>): Promise<void>
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS alert_state (
    site_id text PRIMARY KEY,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`

/** Postgres-backed alert state. The table is created on first use. */
export function createPgStore(exec: Exec): AlertStore {
  let ready: Promise<unknown> | null = null
  const ensureTable = () => {
    if (!ready) {
      ready = exec(CREATE_TABLE).catch(err => {
        ready = null // allow a retry on the next call
        throw err
      })
    }
    return ready
  }

  return {
    async load() {
      await ensureTable()
      const rows = await exec('SELECT site_id, state FROM alert_state')
      const out: Record<string, SiteAlertState> = {}
      for (const r of rows) {
        const state = typeof r.state === 'string' ? JSON.parse(r.state) : r.state
        out[r.site_id as string] = state as SiteAlertState
      }
      return out
    },

    async save(state) {
      await ensureTable()
      // One statement = atomic: upsert every present site and delete the rest together.
      await exec(
        `WITH input AS (
           SELECT key AS site_id, value AS state FROM jsonb_each($1::jsonb)
         ), upserted AS (
           INSERT INTO alert_state (site_id, state, updated_at)
           SELECT site_id, state, now() FROM input
           ON CONFLICT (site_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
           RETURNING site_id
         )
         DELETE FROM alert_state WHERE site_id NOT IN (SELECT site_id FROM input)`,
        [JSON.stringify(state)]
      )
    },
  }
}

/** Wrap a Neon connection string as an Exec. */
export function neonExec(databaseUrl: string): Exec {
  const sql = neon(databaseUrl)
  return async (text, params = []) => (await sql.query(text, params)) as Record<string, unknown>[]
}
