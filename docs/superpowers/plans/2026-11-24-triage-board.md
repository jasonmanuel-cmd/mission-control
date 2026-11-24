# Triage Board + Sovereign Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One board showing, per site, uptime -> live visitor check -> latest Vercel deploy, backed by a committed `sites.json` registry and env-var secrets, with no seeded fake metrics.

**Architecture:** Pure check functions in `src/lib/triage/*` (each returns a `TriagePart`), an orchestrator that runs them in parallel per site with timeouts, one API route `GET /api/sites/triage`, and a `TriageBoard` client component. The registry is read server-side from `sites.json` via `GET /api/sites`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Tailwind, Vitest (new), Node 24.

**Spec:** `docs/superpowers/specs/2026-11-24-triage-board-design.md`

## Global Constraints

- Node `24.x` everywhere (`package.json` engines; `netlify.toml` must match).
- Secrets only via env vars, read server-side: `VERCEL_TOKEN`, `VERCEL_TEAM_ID` (optional), `BETTER_STACK_UPTIME_API_KEY`. Never sent to or read from the browser by the new code.
- Part status values are exactly `'ok' | 'warn' | 'fail' | 'nodata'`.
- Live check: timeout 10s, max 5 redirects, warn if final response >3000 ms or final status non-200, fail on network error/timeout/5xx.
- Auto-refresh 60s; show "checked Xs ago".
- A missing value renders "no data", never a plausible number. Seeded metrics (`uptime`, `bounceRate`, `lastScan`, etc.) are deleted from `defaultSites`.
- Keep both `vercel.json` and `netlify.toml`. Vercel is primary; `netlifyId` stays optional.
- Follow existing style: `@/` imports, Tailwind `cyber-*`/`neon-*` classes, `next/server` route handlers.

## Review Focus

1. Site URL given bare (`example.com`) or with trailing slash/scheme: live check must normalise via existing `toSiteUrl` and not double `https://`.
2. Redirect loop or >5 hops: live part is `fail` with a "too many redirects" detail, not a hang.
3. Vercel token missing or project not found: deploy part is `nodata` with reason; the rest of the row still renders.
4. Better Stack down/unauthorised for all sites: uptime parts are `nodata`, not `fail`, and the response is still HTTP 200.
5. `sites.json` malformed or empty: `/api/sites` returns a clear 500 JSON error and the board shows an error state, not a blank page.

---

### Task 1: Test runner and status core

**Files:**
- Create: `vitest.config.ts`, `src/lib/triage/status.ts`, `src/lib/triage/status.test.ts`
- Modify: `package.json` (add `vitest` devDependency, `"test": "vitest run"` script)

**Interfaces:**
- Produces:
  - `type PartStatus = 'ok' | 'warn' | 'fail' | 'nodata'`
  - `interface TriagePart { status: PartStatus; detail: string }`
  - `function worstStatus(parts: PartStatus[]): PartStatus` (fail > warn > ok; `nodata` counts as `warn` only when every other part is `ok`; all `nodata` -> `nodata`)

- [ ] **Step 1: Write failing tests** in `status.test.ts`: `worstStatus(['ok','ok','ok'])==='ok'`; `['ok','warn','fail']==='fail'`; `['ok','warn','ok']==='warn'`; `['ok','nodata','ok']==='warn'`; `['nodata','nodata','nodata']==='nodata'`; `['fail','nodata','ok']==='fail'`.
- [ ] **Step 2:** Run `npx vitest run src/lib/triage/status.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Install `vitest`, add config with alias `@` -> `./src`, implement `status.ts` per Interfaces.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: vitest + triage status core`.

### Task 2: Live site check

**Files:**
- Create: `src/lib/triage/liveCheck.ts`, `src/lib/triage/liveCheck.test.ts`

**Interfaces:**
- Consumes: `TriagePart` (Task 1), `toSiteUrl(input: string): string` from `@/lib/url`.
- Produces: `function checkLive(url: string, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; maxRedirects?: number }): Promise<TriagePart & { ms?: number; finalUrl?: string; httpStatus?: number }>`

- [ ] **Step 1: Write failing tests** with an injected `fetchImpl`: 200 fast with body containing `<title>` -> `ok`; 200 but 3500 ms (fake clock) -> `warn`; final 404 -> `warn`; 503 -> `fail`; fetch rejects -> `fail`; AbortError at timeout -> `fail` with detail containing `timeout`; 6 chained 302s -> `fail` with detail containing `redirects`; bare `example.com` is requested as `https://example.com`; 200 with empty body -> `warn` ("empty body").
- [ ] **Step 2:** Run `npx vitest run src/lib/triage/liveCheck.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `checkLive`. Follow redirects manually (`redirect: 'manual'`) to count hops; use `AbortController` for the timeout; measure `ms` with `performance.now()`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: live site check`.

### Task 3: Vercel latest-deploy check

**Files:**
- Create: `src/lib/triage/vercel.ts`, `src/lib/triage/vercel.test.ts`

**Interfaces:**
- Consumes: `TriagePart`.
- Produces: `function checkVercelDeploy(project: string | undefined, env: { token?: string; teamId?: string }, fetchImpl?: typeof fetch): Promise<TriagePart & { sha?: string; message?: string; createdAt?: number }>`

- [ ] **Step 1: Write failing tests** (mock fetch returning Vercel `GET /v6/deployments?projectId=<project>&limit=1[&teamId=..]` shape `{deployments:[{state,meta:{githubCommitSha,githubCommitMessage},created,errorMessage?}]}`): `READY` -> `ok`; `BUILDING`/`QUEUED`/`INITIALIZING` -> `warn`; `ERROR` -> `fail` with `errorMessage` in detail; `CANCELED` -> `warn`; no `project` -> `nodata` "no vercelProject configured"; no token -> `nodata` "VERCEL_TOKEN not set"; HTTP 404/403 -> `nodata` with status in detail; empty `deployments` -> `nodata`; request sends `Authorization: Bearer <token>`.
- [ ] **Step 2:** Run `npx vitest run src/lib/triage/vercel.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `checkVercelDeploy` against `https://api.vercel.com`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: vercel deploy check`.

### Task 4: Per-site uptime check

**Files:**
- Create: `src/lib/triage/uptime.ts`, `src/lib/triage/uptime.test.ts`

**Interfaces:**
- Consumes: `TriagePart`, `fetchMonitors(apiKey: string): Promise<Monitor[]>` from `@/lib/betterstack` (monitor `attributes.status`, `attributes.url`; export `Monitor` type if not already exported).
- Produces:
  - `function loadMonitorIndex(apiKey: string | undefined, fetchMonitorsImpl?: typeof fetchMonitors): Promise<MonitorIndex | { error: string }>`
  - `function uptimeForSite(site: { url: string; betterStackId?: string }, index: MonitorIndex | { error: string }): TriagePart`

- [ ] **Step 1: Write failing tests**: match by `betterStackId` first, else by normalised host (strip scheme/`www.`/trailing slash); `up` -> `ok`; `down` -> `fail`; `paused`/`pending`/`maintenance` -> `warn`; no matching monitor -> `nodata` "no Better Stack monitor"; index `{error}` -> `nodata` with that error; missing key -> `{error:'BETTER_STACK_UPTIME_API_KEY not set'}`.
- [ ] **Step 2:** Run `npx vitest run src/lib/triage/uptime.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; fetch monitors once per triage run (index), not once per site.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: per-site uptime check`.

### Task 5: Sovereign registry

**Files:**
- Create: `sites.json`, `src/lib/sites.ts`, `src/lib/sites.test.ts`, `src/app/api/sites/route.ts`, `README.md` (section "Adding a site")
- Modify: `src/lib/siteConfig.ts` (drop `metrics`, seeded values, `SiteMetrics`, `loadSites`/`saveSites` localStorage use; add `vercelProject?: string` to `SiteConfig`), `src/app/page.tsx` (load from `/api/sites`; remove add/edit/delete site UI and `saveSites` calls), and every consumer of `site.metrics` found by `grep -rn "metrics" src` (render "no data").

**Interfaces:**
- Produces: `function readSites(filePath?: string): Promise<SiteConfig[]>` (throws `Error` with message prefixed `sites.json:` on missing/invalid file, non-array, duplicate `id`, missing `name`/`url`, or more than 20 sites); `GET /api/sites` -> `200 SiteConfig[]` or `500 { error: string }`.
- Consumes: `SiteConfig` (now without `metrics`, with `vercelProject?`).

- [ ] **Step 1: Write failing tests** for `readSites` using temp files: valid array parses; malformed JSON throws `sites.json:`; empty array returns `[]`; duplicate id throws; 21 sites throws; missing `url` throws.
- [ ] **Step 2:** Run `npx vitest run src/lib/sites.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `readSites`; `sites.json` is migrated from current `defaultSites` identity fields only (id, name, url, githubRepo, netlifyId), no metrics; add `vercelProject` placeholders omitted (Jason fills in).
- [ ] **Step 4:** Add the route (`export const dynamic = 'force-dynamic'`), switch `page.tsx` and metrics consumers, add README section. Run `npm test && npm run build`. Expected: PASS and build succeeds.
- [ ] **Step 5:** Commit `feat: sites.json registry, remove seeded metrics`.

### Task 6: Triage orchestrator and route

**Files:**
- Create: `src/lib/triage/run.ts`, `src/lib/triage/run.test.ts`, `src/app/api/sites/triage/route.ts`

**Interfaces:**
- Consumes: `readSites`, `checkLive`, `checkVercelDeploy`, `loadMonitorIndex`, `uptimeForSite`, `worstStatus`.
- Produces:
  - `interface SiteTriage { id: string; name: string; url: string; uptime: TriagePart; live: TriagePart; deploy: TriagePart; overall: PartStatus; checkedAt: string }`
  - `function runTriage(sites: SiteConfig[], deps?: Partial<TriageDeps>): Promise<SiteTriage[]>`
  - `GET /api/sites/triage` -> `200 SiteTriage[]` (always 200 when registry loads) or `500 { error }`.

- [ ] **Step 1: Write failing tests** with injected deps: three sites run in parallel (total time < sum); a part that throws becomes `{status:'nodata', detail:<message>}` and does not reject the run; `overall` equals `worstStatus` of the three; `checkedAt` is ISO; Better Stack index fetched exactly once.
- [ ] **Step 2:** Run `npx vitest run src/lib/triage/run.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `runTriage` and the route (`force-dynamic`, env vars read inside the handler).
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Then `npm run dev` and `curl localhost:3000/api/sites/triage`; expected JSON array with one object per site.
- [ ] **Step 5:** Commit `feat: triage orchestrator and API`.

### Task 7: TriageBoard UI

**Files:**
- Create: `src/components/TriageBoard.tsx`
- Modify: `src/app/page.tsx` (render `TriageBoard` above the site grid in overview; row click calls existing `handleSiteClick(siteId)`), `src/components/index.ts` (export)

**Interfaces:**
- Consumes: `GET /api/sites/triage` -> `SiteTriage[]`; `onSiteClick: (siteId: string) => void`.
- Produces: `default function TriageBoard(props: { onSiteClick: (siteId: string) => void }): JSX.Element`

- [ ] **Step 1:** Implement: one row per site with three labelled cells (Uptime, Live, Deploy), each coloured by status (`ok` green, `warn` amber, `fail` red, `nodata` grey "no data") with `detail` as tooltip; row border follows `overall`; header shows "checked Xs ago"; refetch every 60s; fetch error state shows the error text with a Retry button; loading skeleton on first load.
- [ ] **Step 2:** Run `npm run build` and `npm run lint`. Expected: no errors.
- [ ] **Step 3:** Start `npm run dev`, open the page in headless Chromium (Playwright), screenshot at 1280px and 390px width; confirm rows render, an unset `VERCEL_TOKEN` shows grey "no data" in the Deploy cell, and clicking a row opens the detail view.
- [ ] **Step 4:** Commit `feat: triage board UI`.

### Task 8: Config cleanup and docs

**Files:**
- Modify: `netlify.toml` (`NODE_VERSION = "24"`), `.env.example` (add `VERCEL_TOKEN`, `VERCEL_TEAM_ID` with comments, no values), `README.md` (env vars, triage order, `sites.json` fields)

- [ ] **Step 1:** Make the edits; confirm `grep -n NODE_VERSION netlify.toml` shows `24`.
- [ ] **Step 2:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 3:** Commit `chore: align Node version, document env vars`.

---

## Self-Review

- **Spec coverage:** triage board (T6, T7), live check (T2), Vercel (T3), uptime (T4), `sites.json` + env secrets (T5, T8), fake metrics removed (T5), drill-down kept (T7), Node fix (T8), Vitest (T1), 60s refresh / "checked Xs ago" (T7), non-goals untouched.
- **Type consistency:** `TriagePart`/`PartStatus` (T1) used identically in T2-T7; `SiteConfig.vercelProject` added in T5 and read in T6.
- **Known gap flagged, not hidden:** the existing `ApiKeyManager` / `apiFetch` header-based keys still serve the old detail cards. The new triage path ignores them (env only). Removing them is out of scope for this plan.
