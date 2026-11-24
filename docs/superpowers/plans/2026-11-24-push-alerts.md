# Push Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email Jason when a site's triage status goes to FAIL (and again when it recovers), without ever spamming or alerting on missing config.

**Architecture:** A GitHub Actions workflow (every 5 min) calls `GET /api/cron/alerts` with a bearer secret. The route runs the existing `runTriage`, compares each site to its stored last state (Postgres via `DATABASE_URL`), decides alerts with a pure function (debounced), emails via Resend, and persists the new state only for alerts that were delivered.

**Tech Stack:** Next.js 14 route handler, TypeScript, Vitest, `@neondatabase/serverless`, Resend REST API, GitHub Actions.

**Spec:** No separate design doc (user opted out of questions and said "your pick, dive in"). The decisions are: GitHub Actions scheduler (a sub-daily `vercel.json` cron can fail deploys on Vercel Hobby), Postgres state, Resend email, alert on status change only. Builds on `docs/superpowers/specs/2026-11-24-triage-board-design.md` (triage parts and `overall`).

## Global Constraints

- Only `overall === 'fail'` is alertable. `ok`, `warn` and `nodata` (including `unconfigured` parts) never alert.
- Debounce: a site must be `fail` on **2 consecutive runs** (`FAIL_CONFIRM_RUNS = 2`) before a `down` alert.
- One email per run, batching all alerts of that run.
- Secrets are server-side env vars only: `CRON_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`. Names go in `.env.example` with no values.
- The cron route must never run checks unless `Authorization: Bearer <CRON_SECRET>` matches (constant-time compare). Missing `CRON_SECRET` -> 503.
- Node 24, TypeScript strict, `@/` imports, Vitest tests next to the code, existing route style (`export const dynamic = 'force-dynamic'`).
- Do not add a `crons` entry to `vercel.json`.

## Review Focus

1. A single transient failure (one 503 or one timeout) must not alert.
2. Resend down or misconfigured: state is not lost, the `down` alert is retried next run, and no duplicate is sent once delivered.
3. Missing/wrong bearer or missing `CRON_SECRET`: 401/503 and no checks, DB reads or emails happen.
4. A site removed from `sites.json`: its stored state is dropped and no "recovered" email is sent for it.
5. First-ever run with everything healthy (or all unconfigured) sends nothing; a site that is already failing on first run alerts only after the 2nd consecutive failure.
6. `DATABASE_URL` missing or the DB unreachable: JSON error response, no emails (so a broken store cannot cause an email storm) and the GitHub workflow turns red.

---

### Task 1: Alert decision logic

**Files:**
- Create: `src/lib/alerts/decide.ts`, `src/lib/alerts/decide.test.ts`

**Interfaces:**
- Consumes: `SiteTriage` from `@/lib/triage/run` (`id, name, url, uptime, live, deploy, overall`).
- Produces:
  - `interface SiteAlertState { status: 'ok' | 'fail'; failStreak: number; alerted: boolean; since: string }`
  - `type AlertKind = 'down' | 'recovered'`
  - `interface Alert { kind: AlertKind; siteId: string; name: string; url: string; reasons: string[]; since: string }`
  - `const FAIL_CONFIRM_RUNS = 2`
  - `function decideAlerts(prev: Record<string, SiteAlertState>, current: SiteTriage[], nowIso: string): { alerts: Alert[]; next: Record<string, SiteAlertState> }`

- [ ] **Step 1: Write failing tests** in `decide.test.ts` (build `SiteTriage` rows with a small helper): first-ever healthy run -> no alerts, `next[id]` is `{status:'ok', failStreak:0, alerted:false}`; one fail -> no alert, `failStreak:1`; second consecutive fail -> one `down` alert with `reasons` like `Live site: HTTP 503` and `since` = when the streak began, `alerted:true`; third fail -> no new alert; fail then `ok` before confirm -> streak resets, no alert; alerted site returns to non-fail (`warn`/`nodata`/`ok`) -> one `recovered` alert with original `since`, state reset; `nodata`-only and `warn` rows never produce alerts; site absent from `current` is absent from `next` and produces no `recovered`; two failing sites -> two alerts in one result.
- [ ] **Step 2:** Run `npx vitest run src/lib/alerts/decide.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `decideAlerts` as a pure function; reasons are `"<Uptime|Live site|Vercel deploy>: <detail>"` for each part with status `fail`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: alert decision logic`.

### Task 2: Postgres state store

**Files:**
- Create: `src/lib/alerts/store.ts`, `src/lib/alerts/store.test.ts`
- Modify: `package.json` (add `@neondatabase/serverless`)

**Interfaces:**
- Consumes: `SiteAlertState` (Task 1).
- Produces:
  - `type Exec = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>`
  - `interface AlertStore { load(): Promise<Record<string, SiteAlertState>>; save(state: Record<string, SiteAlertState>): Promise<void> }`
  - `function createPgStore(exec: Exec): AlertStore` (creates table `alert_state(site_id text primary key, state jsonb not null, updated_at timestamptz not null default now())` with `CREATE TABLE IF NOT EXISTS` before first use; `save` replaces the whole set: upserts present sites and deletes rows for sites not in `state`)
  - `function neonExec(databaseUrl: string): Exec` (wraps `neon(url).query(text, params)`)

- [ ] **Step 1: Write failing tests** with an in-memory fake `Exec` that interprets the statements the store issues (or records them): `load` on empty table returns `{}`; `save` then `load` round-trips states; `save` with a smaller set deletes the dropped site; the table is created exactly once across several calls; a rejecting `Exec` makes `load`/`save` reject (no swallowing).
- [ ] **Step 2:** Run `npx vitest run src/lib/alerts/store.test.ts`. Expected: FAIL.
- [ ] **Step 3:** `npm install @neondatabase/serverless`; implement `createPgStore` and `neonExec` (no test for `neonExec`; it is a one-line wrapper).
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: postgres alert state store`.

### Task 3: Email delivery

**Files:**
- Create: `src/lib/alerts/email.ts`, `src/lib/alerts/email.test.ts`

**Interfaces:**
- Consumes: `Alert` (Task 1).
- Produces:
  - `interface EmailConfig { apiKey?: string; from?: string; to?: string }`
  - `function sendAlertEmail(alerts: Alert[], cfg: EmailConfig, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<{ ok: boolean; detail: string }>`

- [ ] **Step 1: Write failing tests**: no alerts -> `{ok:true}` and fetch not called; missing `apiKey`/`from`/`to` -> `{ok:false, detail}` naming the missing var (`RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`), fetch not called; success posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>` and JSON body `{from, to:[to], subject, text}`; subject for one down alert is `DOWN: <name>`, for one recovery `RECOVERED: <name>`, for several `<n> site alerts (<d> down, <r> recovered)`; text lists each site name, url, reasons and `since`; HTTP 4xx/5xx -> `{ok:false}` with status in detail; fetch rejection -> `{ok:false}`; hanging fetch aborts after `timeoutMs` (default 8000) -> `{ok:false, detail:/timeout/i}`.
- [ ] **Step 2:** Run `npx vitest run src/lib/alerts/email.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `sendAlertEmail` (AbortController timeout, plain-text body).
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: alert email delivery`.

### Task 4: Alert check orchestrator

**Files:**
- Create: `src/lib/alerts/run.ts`, `src/lib/alerts/run.test.ts`

**Interfaces:**
- Consumes: `readSites`, `runTriage`, `decideAlerts`, `AlertStore`, `sendAlertEmail`.
- Produces:
  - `interface AlertRunDeps { readSites: () => Promise<SiteConfig[]>; runTriage: (sites: SiteConfig[]) => Promise<SiteTriage[]>; store: AlertStore; send: (alerts: Alert[]) => Promise<{ ok: boolean; detail: string }>; now: () => string }`
  - `interface AlertRunResult { checked: number; alerts: number; delivered: boolean; detail: string }`
  - `function runAlertCheck(deps: AlertRunDeps): Promise<AlertRunResult>`

- [ ] **Step 1: Write failing tests** with fakes: loads prev state, runs triage, saves `next`; no alerts -> `send` not called, state saved; alerts + send ok -> saved `next` has the alerts' sites with `alerted` as decided; alerts + send fails -> for each alert's site the saved state keeps the previous `alerted` value (so `down` retries next run and `recovered` is re-sent), `delivered:false`; send failing then succeeding on the next run yields exactly one delivered `down`; `store.load` rejecting -> `runAlertCheck` rejects and `send` is never called; `store.save` rejecting after a successful send -> rejects.
- [ ] **Step 2:** Run `npx vitest run src/lib/alerts/run.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `runAlertCheck` per the interfaces; `load` before `runTriage` so a dead store fails before any email.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: alert check orchestrator`.

### Task 5: Cron route with auth

**Files:**
- Create: `src/app/api/cron/alerts/route.ts`, `src/app/api/cron/alerts/route.test.ts`

**Interfaces:**
- Consumes: `runAlertCheck`, `createPgStore`, `neonExec`, `sendAlertEmail`, `readSites`, `runTriage`.
- Produces: `GET /api/cron/alerts` -> `200 AlertRunResult`; `401 {error}` bad/missing bearer; `503 {error}` when `CRON_SECRET` or `DATABASE_URL` is unset; `500 {error}` when the run throws. Exports `export function isAuthorized(header: string | null, secret: string): boolean` (constant-time via `crypto.timingSafeEqual`, tolerant of length mismatch).

- [ ] **Step 1: Write failing tests** (mock `@/lib/alerts/run`, `@/lib/alerts/store` via `vi.mock`, set `process.env` per test): no `CRON_SECRET` -> 503 and `runAlertCheck` not called; wrong bearer -> 401 and not called; missing header -> 401; missing `DATABASE_URL` -> 503 and not called; correct bearer -> 200 with the mocked result; `runAlertCheck` rejecting -> 500 JSON with message; `isAuthorized` true only for exact `Bearer <secret>`, false for different length and for empty header.
- [ ] **Step 2:** Run `npx vitest run src/app/api/cron/alerts/route.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the route; read env inside the handler; build deps from env (`RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`).
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat: authenticated cron alerts route`.

### Task 6: Scheduler workflow, env and docs

**Files:**
- Create: `.github/workflows/triage-alerts.yml`
- Modify: `.env.example`, `README.md`

- [ ] **Step 1:** Workflow: `on: schedule: cron "*/5 * * * *"` plus `workflow_dispatch`; one job step runs `curl --fail-with-body -sS --max-time 60 -H "Authorization: Bearer ${{ secrets.ALERT_CRON_SECRET }}" "${{ secrets.ALERT_APP_URL }}/api/cron/alerts"`, so a non-2xx fails the job and GitHub emails you that the alert pipeline itself is broken. Add `concurrency` so runs never overlap.
- [ ] **Step 2:** Add `CRON_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` (names, comments, no values) to `.env.example`; README section "Push alerts": what triggers an alert (2 consecutive FAIL runs), recovery email, env vars, the two GitHub repo secrets (`ALERT_CRON_SECRET` = same value as `CRON_SECRET`, `ALERT_APP_URL` = production URL with no trailing slash), 5-minute cadence (GitHub may delay runs), and the Vercel Pro cron alternative.
- [ ] **Step 3:** Verify: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/triage-alerts.yml'))"` exits 0; `npm test && npm run build` pass.
- [ ] **Step 4:** Commit `feat: alert scheduler workflow and docs`.

---

## Self-Review

- **Coverage:** debounced fail/recovery decision (T1), durable state (T2), delivery (T3), no-lost-alerts on send failure (T4), authenticated route and refusal paths (T5), scheduler and setup docs (T6). Each Review Focus line has an owning test: 1 -> T1, 2 -> T4 (+T3), 3 -> T5, 4 -> T1, 5 -> T1, 6 -> T4 and T5.
- **Types:** `SiteAlertState`, `Alert`, `AlertStore`, `AlertRunDeps`, `AlertRunResult` are defined once and reused unchanged.
- **Out of scope:** SMS, reminders for long outages, quiet hours, a UI for alert history.
