# Domain + SSL Expiry Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show SSL and domain days-left per site on the triage board, and email once per threshold (30/14/7/3/1 days, and expired) before either lapses, without affecting the row's DOWN status.

**Architecture:** Pure expiry parts (`ssl`, `domain` via RDAP) computed server-side, cached 12h in Postgres (best effort), attached to each `SiteTriage` as `expiry` (never feeding `overall`). A separate pure decision function and its own state table drive threshold emails from the existing 5-minute alert run.

**Tech Stack:** Next.js 14, TypeScript, Vitest, existing `checkSSL` (`src/lib/ssl.ts`), RDAP via `https://rdap.org/domain/<domain>` (follows redirects, no key), existing Postgres/Resend plumbing from the push-alerts work.

**Spec:** Approved design in the conversation (short design, "approved, your pick"). Builds on `docs/superpowers/plans/2026-11-24-push-alerts.md` and `docs/superpowers/specs/2026-11-24-triage-board-design.md`.

## Global Constraints

- Thresholds: `WARN_DAYS = 30` (amber), `FAIL_DAYS = 7` (red cell). Email thresholds exactly `[30, 14, 7, 3, 1]`, plus an "expired" email at `days <= 0`.
- Part status values stay `'ok' | 'warn' | 'fail' | 'nodata'`. A lookup error or missing data is `nodata`, **never** `fail`/expired.
- Expiry never changes `SiteTriage.overall` and never triggers a DOWN/RECOVERED email.
- Cache TTL 12 hours. Cache/DB errors never fail a check: fall back to a live lookup. No `DATABASE_URL` -> works uncached.
- RDAP and TLS lookups time out at 8000 ms each. Secrets/env: no new variables.
- Node 24, TypeScript strict, `@/` imports, Vitest next to code, existing style. Extra exports are not allowed from `route.ts` files (Next.js build fails).

## Review Focus

1. A TLS or RDAP error (timeout, 404, refused) must read as `nodata` and never as "expired" or send an email.
2. A renewed certificate/domain (expiry date moves later) re-arms thresholds for the next cycle, with no email for the renewal itself.
3. First run with 5 days left sends exactly one email (the 7-day threshold), not three.
4. Expiry data never changes `overall` or produces DOWN/RECOVERED emails (a site with 2 days of SSL left but a healthy live check stays green).
5. Failed email delivery: expiry alerts are retried next run and are not duplicated once delivered.

---

### Task 1: Expiry parts (days to status, SSL part, domain part)

**Files:**
- Create: `src/lib/expiry/parts.ts`, `src/lib/expiry/parts.test.ts`

**Interfaces:**
- Consumes: `PartStatus` from `@/lib/triage/status`; `SSLInfo` and `checkSSL` from `@/lib/ssl`.
- Produces:
  - `const WARN_DAYS = 30`, `const FAIL_DAYS = 7`
  - `interface ExpiryPart { status: PartStatus; detail: string; days?: number; expiresAt?: string }`
  - `function statusForDays(days: number): PartStatus` (`<= FAIL_DAYS` -> `fail`, `<= WARN_DAYS` -> `warn`, else `ok`)
  - `function daysUntil(iso: string, nowMs: number): number` (floor of whole days, may be negative)
  - `function sslPart(info: SSLInfo, nowMs: number): ExpiryPart` (uses `info.validTo`, not the clamped `daysRemaining`; `info.error` or missing `validTo` -> `nodata`)
  - `function rootDomain(host: string): string` (strips scheme/path/port/`www.`... returns registrable domain: last two labels, or last three when the last two are one of `co.uk, org.uk, ac.uk, gov.uk, com.au, net.au, org.au, co.nz, co.za, com.br`)
  - `function checkDomainExpiry(host: string, fetchImpl?: typeof fetch, nowMs?: number, timeoutMs?: number): Promise<ExpiryPart>`

- [ ] **Step 1: Write failing tests**: `statusForDays` boundaries (31 ok, 30 warn, 8 warn, 7 fail, 0 fail, -3 fail); `daysUntil('2027-01-27T00:00:00Z', Date.parse('2026-11-24T00:00:00Z'))` = 64; `sslPart` valid cert 90 days -> `ok` with `days: 90`; 20 days -> `warn`; 3 days -> `fail`; `validTo` in the past -> `fail` with detail containing `expired`; `info.error` set (even with `daysRemaining: 0`) -> `nodata` and detail contains the error; no `validTo` and no error -> `nodata`; `rootDomain('https://www.example.com/path')==='example.com'`, `rootDomain('blog.example.com')==='example.com'`, `rootDomain('shop.example.co.uk')==='example.co.uk'`, `rootDomain('example.com:8080')==='example.com'`; `checkDomainExpiry` with mocked RDAP JSON `{events:[{eventAction:'registration',eventDate:'2025-01-01T00:00:00Z'},{eventAction:'expiration',eventDate:'2027-01-27T00:00:00Z'}]}` -> `ok`, `days` 64, `expiresAt` `'2027-01-27T00:00:00Z'`, requested URL `https://rdap.org/domain/example.com` for host `www.example.com`; RDAP 404 -> `nodata` (detail mentions 404); JSON without an expiration event -> `nodata`; fetch rejects -> `nodata`; hanging fetch aborts after `timeoutMs` -> `nodata` with detail matching `/timeout/i`.
- [ ] **Step 2:** Run `npx vitest run src/lib/expiry/parts.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement per Interfaces (AbortController timeout; `fetchImpl` default `fetch`, which follows redirects).
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: ssl and domain expiry parts`.

### Task 2: Postgres key-value store generalisation and expiry cache

**Files:**
- Modify: `src/lib/alerts/store.ts` (generalise), `src/lib/alerts/store.test.ts` (keep passing)
- Create: `src/lib/expiry/cache.ts`, `src/lib/expiry/cache.test.ts`

**Interfaces:**
- Consumes: `Exec` from `@/lib/alerts/store`; `ExpiryPart` (Task 1).
- Produces:
  - In `store.ts`: `interface StateStore<T> { load(): Promise<Record<string, T>>; save(state: Record<string, T>): Promise<void> }` and `function createPgStateStore<T>(exec: Exec, table: string): StateStore<T>` (same atomic save/ensure-table behaviour as today, table name validated against `/^[a-z_]+$/`, throws otherwise). `createPgStore(exec)` stays and is `createPgStateStore<SiteAlertState>(exec, 'alert_state')`; `AlertStore` stays an alias of `StateStore<SiteAlertState>`.
  - `interface SiteExpiry { ssl: ExpiryPart; domain: ExpiryPart; checkedAt: string }`
  - `interface ExpiryCache { get(siteId: string, maxAgeMs: number, nowMs: number): Promise<SiteExpiry | null>; set(siteId: string, value: SiteExpiry): Promise<void> }`
  - `function createPgExpiryCache(exec: Exec): ExpiryCache` (table `expiry_cache`, state = the `SiteExpiry`, freshness from `checkedAt`; implemented over `createPgStateStore<SiteExpiry>`: `get` loads and checks age; `set` loads, merges, saves)

- [ ] **Step 1: Write failing tests**: `createPgStateStore(exec,'other_table')` round-trips and uses the given table name in its SQL; an invalid table name (`'x; drop table y'`) throws on creation; existing `createPgStore` tests still pass unchanged; cache `get` returns `null` when empty, returns the value when `checkedAt` is within `maxAgeMs`, returns `null` when older; `set` then `get` round-trips and a second `set` for another site keeps the first; a rejecting `Exec` makes `get`/`set` reject (callers decide to swallow).
- [ ] **Step 2:** Run `npx vitest run src/lib/expiry/cache.test.ts src/lib/alerts/store.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Refactor `store.ts` into the generic store; implement the cache over it.
- [ ] **Step 4:** Run `npm test`. Expected: PASS (all existing tests untouched).
- [ ] **Step 5:** Commit `feat: generic pg state store and expiry cache`.

### Task 3: Cached expiry lookup

**Files:**
- Create: `src/lib/expiry/check.ts`, `src/lib/expiry/check.test.ts`

**Interfaces:**
- Consumes: `sslPart`, `checkDomainExpiry` (Task 1), `checkSSL` from `@/lib/ssl`, `ExpiryCache`, `SiteExpiry` (Task 2).
- Produces:
  - `const EXPIRY_TTL_MS = 12 * 60 * 60 * 1000`
  - `interface ExpiryDeps { checkSSL: (host: string) => Promise<SSLInfo>; checkDomain: (host: string) => Promise<ExpiryPart>; cache?: ExpiryCache; now: () => number }`
  - `function getExpiry(site: { id: string; url: string }, deps?: Partial<ExpiryDeps>): Promise<SiteExpiry>` (cache hit within TTL returns it with no lookups; otherwise runs both lookups in parallel, each wrapped so a throw becomes `nodata`, stores the result best-effort, returns it; cache `get`/`set` errors are swallowed; only caches when at least one part is not `nodata`)

- [ ] **Step 1: Write failing tests**: fresh cache hit returns cached and calls neither lookup; stale or missing cache runs both lookups and stores; lookups run in parallel (total time < sum with 60 ms delays each); a throwing lookup becomes `{status:'nodata', detail:<message>}` while the other part is still returned; cache `get` rejecting still returns live data; cache `set` rejecting still returns live data; both parts `nodata` -> not written to cache; no cache provided works; `checkedAt` is an ISO string from `deps.now()`; host passed to the lookups is the site url without scheme/path.
- [ ] **Step 2:** Run `npx vitest run src/lib/expiry/check.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `getExpiry`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: cached expiry lookup`.

### Task 4: Attach expiry to triage rows without touching overall

**Files:**
- Modify: `src/lib/triage/run.ts` (type + deps), `src/lib/triage/run.test.ts`, `src/app/api/sites/triage/route.ts` (no change needed unless deps wiring requires)

**Interfaces:**
- Consumes: `getExpiry`, `SiteExpiry`, `createPgExpiryCache`, `neonExec`.
- Produces: `SiteTriage` gains `expiry: SiteExpiry`; `TriageDeps` gains `getExpiry: (site: SiteConfig) => Promise<SiteExpiry>`; `defaultDeps()` builds it from `getExpiry(site, { cache })` where `cache = createPgExpiryCache(neonExec(process.env.DATABASE_URL))` only when `DATABASE_URL` is set, else no cache. `overall` is computed exactly as before (expiry excluded).

- [ ] **Step 1: Write failing tests** (extend `deps()` helper with a `getExpiry` stub): each row has `expiry`; a failing `ssl` expiry part with a healthy live/uptime/deploy leaves `overall === 'ok'`; `getExpiry` throwing yields `expiry` with both parts `nodata` and does not reject the run; expiry for 3 sites runs in parallel with the other checks (total time under the sum of the slowest two).
- [ ] **Step 2:** Run `npx vitest run src/lib/triage/run.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; start `getExpiry` per site concurrently with the other three checks inside the existing `Promise.all`.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit`. Expected: PASS, no type errors (fix any test fixtures that build `SiteTriage` by hand, e.g. in `src/lib/alerts/*.test.ts`, by adding an `expiry` fixture helper).
- [ ] **Step 5:** Commit `feat: attach expiry to triage rows`.

### Task 5: Expiry alert decision

**Files:**
- Create: `src/lib/expiry/decide.ts`, `src/lib/expiry/decide.test.ts`

**Interfaces:**
- Consumes: `SiteExpiry`, `ExpiryPart`.
- Produces:
  - `const EXPIRY_THRESHOLDS = [30, 14, 7, 3, 1]`
  - `type ExpiryKind = 'ssl' | 'domain'`
  - `interface ExpiryAlertState { lastThreshold: number | null; expiredAlerted: boolean; expiresAt: string }`
  - `interface ExpiryAlert { type: 'expiring' | 'expired'; what: ExpiryKind; siteId: string; name: string; url: string; days: number; expiresAt: string; threshold?: number }`
  - `function decideExpiryAlerts(prev: Record<string, ExpiryAlertState>, rows: { id: string; name: string; url: string; expiry: SiteExpiry }[], nowIso: string): { alerts: ExpiryAlert[]; next: Record<string, ExpiryAlertState> }` (state keys are `"<siteId>:ssl"` and `"<siteId>:domain"`)

- [ ] **Step 1: Write failing tests**: 90 days left -> no alert, state `{lastThreshold:null, expiredAlerted:false}`; 30 days -> one `expiring` alert with `threshold: 30`; the next run at 29 days -> none; at 14 -> one `threshold: 14`; first run at 5 days -> exactly one alert with `threshold: 7` (not 30/14/7); first run at 1 day -> one alert `threshold: 1`; days `<= 0` -> one `expired` alert and `expiredAlerted: true`, the next run -> none; expiry moves later (new `expiresAt`, days 365) -> state reset and no alert, then a later cycle at 30 days alerts again; a `nodata` part -> no alert and state unchanged; ssl and domain track independently for one site (two alerts when both cross); a site missing from `rows` is dropped from `next`; the `days` and `expiresAt` in the alert come from the part.
- [ ] **Step 2:** Run `npx vitest run src/lib/expiry/decide.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as a pure function. Picking the threshold: the smallest `t` in `EXPIRY_THRESHOLDS` with `days <= t`; alert when `lastThreshold === null || t < lastThreshold`. Reset state when `expiresAt` differs from the stored one **and** is later, or when `days > 30`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: expiry alert decision`.

### Task 6: Expiry email

**Files:**
- Modify: `src/lib/alerts/email.ts`, `src/lib/alerts/email.test.ts`
- Create: `src/lib/expiry/email.ts`, `src/lib/expiry/email.test.ts`

**Interfaces:**
- Consumes: `ExpiryAlert` (Task 5), `EmailConfig`, `SendResult`.
- Produces: in `alerts/email.ts` export `postEmail(subject: string, text: string, cfg: EmailConfig, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<SendResult>` (the existing config check, Resend POST and timeout, extracted; `sendAlertEmail` calls it; all existing tests pass unchanged). In `expiry/email.ts`: `function sendExpiryEmail(alerts: ExpiryAlert[], cfg: EmailConfig, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<SendResult>`.

- [ ] **Step 1: Write failing tests**: no alerts -> `{ok:true}`, fetch not called; missing config names the variable; one `expiring` ssl alert -> subject `SSL expires in 14 days: <name>`; one `expiring` domain -> `Domain expires in 7 days: <name>`; 1 day -> singular `1 day`; `expired` ssl -> `SSL EXPIRED: <name>`; `expired` domain -> `Domain EXPIRED: <name>`; several -> `<n> expiry warnings`; body lists site name, url, what, days left, and the expiry date; HTTP error -> `{ok:false}` with status; timeout -> `{ok:false, detail:/timeout/i}`. Existing alert email tests still pass.
- [ ] **Step 2:** Run `npx vitest run src/lib/expiry/email.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Extract `postEmail`, implement `sendExpiryEmail`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: expiry warning email`.

### Task 7: Wire expiry alerts into the alert run

**Files:**
- Modify: `src/lib/alerts/run.ts`, `src/lib/alerts/run.test.ts`, `src/app/api/cron/alerts/route.ts`, `src/app/api/cron/alerts/route.test.ts`

**Interfaces:**
- Consumes: `decideExpiryAlerts`, `ExpiryAlertState`, `StateStore`, `sendExpiryEmail`, `createPgStateStore`.
- Produces: `AlertRunDeps` gains optional `expiryStore?: StateStore<ExpiryAlertState>` and `sendExpiry?: (alerts: ExpiryAlert[]) => Promise<SendResult>`; `AlertRunResult` gains `expiryAlerts: number`; `delivered` is true only if both sends succeeded. When `expiryStore`/`sendExpiry` are absent the behaviour is exactly as today with `expiryAlerts: 0`. Route builds both from `DATABASE_URL` (table `expiry_alert_state`) and the existing email env vars.

- [ ] **Step 1: Write failing tests** (fakes as in the existing file): a triage row with 5-day SSL expiry sends one expiry email via `sendExpiry` and saves `lastThreshold: 7`; a failed expiry send restores that key's previous state so it retries next run, and `delivered` is `false`; after a failed then successful send exactly one expiry email is delivered overall; status alerts and expiry alerts can both go out in one run (two separate sends) and a failure of one does not roll back the other's state; an expiry store that rejects on `load` rejects the run before any email is sent; with no `expiryStore`, no expiry code runs and the existing tests pass; route test: `expiryAlerts` appears in the JSON and a not-delivered expiry result gives 502.
- [ ] **Step 2:** Run `npx vitest run src/lib/alerts/run.test.ts src/app/api/cron`. Expected: FAIL.
- [ ] **Step 3:** Implement: load both stores before triage; run status decision and expiry decision on the same triage rows; send status alerts then expiry alerts; for each failed send, roll back only that category's state as the existing code does; save both stores.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: PASS and build succeeds.
- [ ] **Step 5:** Commit `feat: send expiry warnings from the alert run`.

### Task 8: Board Expiry cell and docs

**Files:**
- Modify: `src/components/TriageBoard.tsx`, `README.md`

**Interfaces:**
- Consumes: `SiteTriage.expiry` from `GET /api/sites/triage`.
- Produces: a fourth cell "Expiry" per row; status = worst of `ssl.status` and `domain.status` (ignoring `nodata` when the other part has data; both `nodata` -> grey), text `SSL 62d · Domain 288d` (a `nodata` part shows `SSL no data`; a `fail` with `days <= 0` shows `SSL expired`), tooltip lists both details. The row border still follows `overall` only.

- [ ] **Step 1:** Implement the cell with a small pure helper `expirySummary(expiry: SiteExpiry): { status: PartStatus; text: string; title: string }` exported from a new `src/components/expirySummary.ts` and unit-tested in `src/components/expirySummary.test.ts` (cases: both ok; ssl warn; domain fail; ssl nodata + domain ok; both nodata; expired).
- [ ] **Step 2:** Run `npx vitest run src/components/expirySummary.test.ts`. Expected: PASS (write the test first and watch it fail, then implement).
- [ ] **Step 3:** Update the grid to five columns on `md` and up (name + 4 cells); README section "Expiry warnings": thresholds, what triggers an email, the 12h cache, that expiry never affects DOWN status, RDAP source and the `.com`-style multi-part TLD list limitation.
- [ ] **Step 4:** Verify: `npm test && npx tsc --noEmit && npm run build`, then run the dev server and screenshot the board at 1280px and 390px with headless Chromium; confirm the Expiry cell shows real days for at least one site (RDAP/TLS reachable) or grey "no data" when the sandbox blocks the network, and no horizontal overflow.
- [ ] **Step 5:** Commit `feat: expiry cell on triage board, docs`.

---

## Self-Review

- **Coverage:** SSL + domain parts and the error-is-not-expired fix (T1), cache (T2), cached lookup (T3), board data without touching `overall` (T4), threshold decision and re-arm (T5), email (T6), alert-run wiring with retry semantics (T7), UI and docs (T8). Review Focus lines map to: 1 -> T1/T3, 2 -> T5, 3 -> T5, 4 -> T4, 5 -> T7.
- **Types:** `ExpiryPart`, `SiteExpiry`, `ExpiryAlert`, `ExpiryAlertState`, `StateStore<T>` are defined once and reused unchanged.
- **Out of scope:** WHOIS for TLDs without RDAP, a public-suffix list, auto-renewal, per-site threshold overrides.
