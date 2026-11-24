# Mission Control Center

Monitoring dashboard for the sites we maintain.

## Adding a site

Sites live in `sites.json` at the repo root (max 20). Edit the file and commit; there is no add-site button.

```json
{
  "id": "site-example",
  "name": "Example Co",
  "url": "https://example.com",
  "vercelProject": "prj_xxx or project name (optional)",
  "githubRepo": "owner/repo (optional)",
  "netlifyId": "optional",
  "betterStackId": "optional monitor id; otherwise matched by host"
}
```

`id`, `name` and `url` are required; ids must be unique.

## Triage board

For each site, in the order we check when a client says "my site is acting weird":

1. **Uptime**: Better Stack monitor (matched by `betterStackId`, else by host).
2. **Live site**: our own HTTP probe (8s timeout, max 5 redirects; warn if >3s or non-200, fail on error/5xx).
3. **Vercel deploy**: latest deployment for `vercelProject`.

The row colour is the worst of the three. Anything we cannot read shows grey "no data", never a guessed value. The board refreshes every 60s.

## Environment variables

Secrets are server-side env vars only (see `.env.example`):

| Variable | Used for |
|---|---|
| `BETTER_STACK_UPTIME_API_KEY` | uptime |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID` (optional) | latest deploy |

## Expiry warnings

Each triage row has an **Expiry** cell with SSL and domain days left (`SSL 62d · Domain 288d`). Amber at 30 days or fewer for domains and 14 or fewer for SSL, red at 7 or fewer, grey "no data" when a lookup fails. (SSL warns later because certificates auto-renew around 30 days out and routinely sit at 29-30 days; only a renewal that has gone wrong reaches 14.) It is informational: it never changes the row colour or triggers a DOWN email.

- **Emails** (through the same 5-minute alert run): once each when a domain first drops to 30, 14, 7, 3 and 1 days (SSL: 14, 7, 3 and 1), and once on expiry. If a site is first seen at 5 days you get one email (the 7-day one), not several. A renewal (later expiry date) re-arms everything with no email.
- **Sources:** SSL is read directly from the site's certificate. Domain expiry comes from RDAP via `rdap.org` (free, no key, `.com` and most TLDs). Subdomains are reduced to the registrable domain; a few multi-part suffixes (`co.uk`, `com.au`, ...) are built in, others may need adding in `src/lib/expiry/parts.ts`.
- **Cache:** lookups are cached for 12 hours in your Postgres (`expiry_cache`) so we don't hammer registries. Without `DATABASE_URL` the board looks up live every refresh.
- **Failed lookups never alarm:** a timeout or refusal is "no data", not "expired".
- **State:** which thresholds were already emailed lives in `expiry_alert_state` (created automatically).

## Push alerts

A GitHub Actions workflow (`.github/workflows/triage-alerts.yml`) calls `GET /api/cron/alerts` every 5 minutes (GitHub may delay scheduled runs by a few minutes).

- **When it emails you:** a site's overall status is FAIL on **2 consecutive runs** (filters one-off blips), and again when it recovers. Grey "no data", amber warnings and unconfigured parts never alert. One email per run batches all alerts.
- **If the email can't be sent**, nothing is lost: the alert is retried on the next run (delivery is at-least-once, so a rare duplicate is possible if the database write fails right after a send).
- **State:** the last status per site is kept in a Postgres table `alert_state` (created automatically). Without `DATABASE_URL` the endpoint refuses to run, so it can never spam you.
- **Env vars (host):** `CRON_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`.
- **GitHub repo secrets** (Settings -> Secrets and variables -> Actions): `ALERT_CRON_SECRET` (same value as `CRON_SECRET`) and `ALERT_APP_URL` (production URL, no trailing slash).
- **Test it:** Actions tab -> "Triage alerts" -> Run workflow. A red run means the pipeline is misconfigured; the log shows the endpoint's error.
- **Vercel Pro alternative:** add a `crons` entry for `/api/cron/alerts` to `vercel.json` (Vercel sends `Authorization: Bearer $CRON_SECRET`) **and disable the workflow**; two callers at once can send duplicate emails. Don't add a sub-daily cron on the Hobby plan; deploys can be rejected.
- **Recovery:** the "recovered" email waits for a clean OK run. A run with missing or unreadable data keeps the site in its failing state rather than guessing.
- **Failure means loud:** if alerts can't be delivered (e.g. bad `RESEND_API_KEY`), the endpoint returns 502 and the workflow run turns red; alerts are retried every run until they go out.
- **Limits to know:** GitHub pauses scheduled workflows after 60 days with no repo activity (re-enable in the Actions tab). A page that returns 404 (warn, not FAIL) does not alert. The route allows up to 60s; on a host with a 10s function limit (e.g. default Netlify) the run can be cut off, so prefer Vercel for the app.

## Development

```bash
npm install
npm run dev
npm test
```

Node 24 (`engines`; `netlify.toml` matches).
