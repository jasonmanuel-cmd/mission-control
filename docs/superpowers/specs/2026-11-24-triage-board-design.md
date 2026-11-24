# Mission Control: Triage Board + Sovereign Registry (Design)

Status: DRAFT, awaiting approval. Nothing below is built.

## Intent and why
Jason maintains ~9 client sites and wants Mission Control to be the single
"all-around information source" for them. His real triage routine when a client
says "my site is acting weird" is: (1) uptime, (2) the live site, (3) Vercel
deploys. The dashboard should answer those three, in that order, per site,
at a glance, with live data only.

## Goals
- Triage board: one row per site showing, left to right:
  1. Uptime (Better Stack, existing integration)
  2. Live check (our own HTTP probe: status code, redirect chain, response
     time, final URL, simple content sanity check)
  3. Latest Vercel deploy (state, commit message/sha, age, error summary)
  Overall row status = worst of the three (green/amber/red).
- Existing cards (SEO/GEO/AEO, SSL, Lighthouse, malware, AI watchdog, fixes)
  stay as drill-down for the selected site.
- Site registry moves out of browser `localStorage` into a committed
  `sites.json` in this repo. Secrets move to env vars (extend `.env.example`).
- Remove hardcoded fake metrics (uptime/bounceRate/lastScan) from
  `src/lib/siteConfig.ts`. A missing value renders as "no data", never a
  plausible-looking number.

## Non-goals
- Push alerts (email/SMS on down/failed deploy). Explicit follow-up (Approach C),
  built later on top of live data.
- Traffic/analytics, form/lead activity, domain-expiry, content-freshness.
- Netlify deploy status (kept as optional field; Vercel first).
- Multi-user auth or per-client login.

## Anti-goals (failure even if it "works")
- Any number on screen that is stale or seeded but looks live.
- Secrets reachable from the browser or committed to the repo.
- Triage board needing clicks to answer "is it down / what do visitors see /
  did a deploy break it".

## Constraints
- Next.js 14 App Router, Tailwind, existing component style; Node 24.
- Existing API routes under `src/app/api/*` remain; new routes follow their style.
- Vercel API token and Better Stack keys server-side only (env vars).
- `netlify.toml` pins Node 18 vs `package.json` Node 24; resolved as part of
  this work (see Calls).

## Approaches considered
- A. Triage board only. Fast, but registry stays in a browser tab (rented land).
- B. A + sovereign registry (`sites.json`, env-var keys). **Chosen** (builder's
  pick, delegated by Jason: "your pick").
- C. B + push alerts. Deferred; alerting on stale data is noise, so live data
  comes first.

## Decided with Jason
- Triage order: uptime -> live site -> Vercel deploys.
- Goal: single information source for all sites he maintains.
- Approach B, chosen by delegation.

## Design
- `sites.json` (repo root or `src/data/`): array of
  `{ id, name, url, vercelProject?, githubRepo?, netlifyId?, betterStackId? }`.
  Server reads it; client gets it via `GET /api/sites`. UI "add site" button
  is replaced by editing the file (documented in README).
- `GET /api/sites/triage`: for each site, in parallel with per-call timeouts,
  returns `{ id, uptime, live, deploy, overall, checkedAt }`. Each part is
  `{ status: ok|warn|fail|nodata, detail }`. One failing integration yields
  `nodata` for that part, not a failed response.
- Live check: server-side fetch, 10s timeout, follow redirects (cap 5), record
  status, final URL, ms; warn if >3s or non-200 final; fail on error/5xx;
  content sanity = response contains the site's `<title>` or non-empty body.
- Vercel: `GET /v6/deployments?projectId=...&limit=1` (+ team id) with
  `VERCEL_TOKEN`; map READY/ERROR/BUILDING/CANCELED to ok/fail/warn.
- UI: new `TriageBoard` component at top of `page.tsx`; click a row selects the
  site and shows existing cards. Auto-refresh every 60s with visible
  "checked Xs ago".
- Errors: integration failures surface as `nodata` with the reason on hover.

## Testing
- Unit tests for status mapping and the live-check function (mocked fetch).
- API route tests with mocked Vercel/Better Stack responses.
- Manual: run app, verify board against 2 real sites.

## Left to the builder
Component styling within existing design language, exact thresholds beyond
those above, test framework choice (none installed today; Vitest proposed).

## Calls made (not Jason's decisions, flagged for review)
1. Registry as committed JSON file rather than a database (simplest sovereign
   option, no new rented service).
2. Fix `netlify.toml` Node 18 -> 24 to match `package.json`.
3. Keep both `vercel.json` and `netlify.toml`; do not remove a host.
4. Vitest added as the test runner.
5. 60s auto-refresh; 10s probe timeout; 3s slow threshold.
6. Vercel treated as primary host; Netlify stays optional.
