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

## Push alerts

A GitHub Actions workflow (`.github/workflows/triage-alerts.yml`) calls `GET /api/cron/alerts` every 5 minutes (GitHub may delay scheduled runs by a few minutes).

- **When it emails you:** a site's overall status is FAIL on **2 consecutive runs** (filters one-off blips), and again when it recovers. Grey "no data", amber warnings and unconfigured parts never alert. One email per run batches all alerts.
- **If the email can't be sent**, nothing is lost: the alert is retried on the next run.
- **State:** the last status per site is kept in a Postgres table `alert_state` (created automatically). Without `DATABASE_URL` the endpoint refuses to run, so it can never spam you.
- **Env vars (host):** `CRON_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`.
- **GitHub repo secrets** (Settings -> Secrets and variables -> Actions): `ALERT_CRON_SECRET` (same value as `CRON_SECRET`) and `ALERT_APP_URL` (production URL, no trailing slash).
- **Test it:** Actions tab -> "Triage alerts" -> Run workflow. A red run means the pipeline is misconfigured; the log shows the endpoint's error.
- **Vercel Pro alternative:** instead of the workflow, add a `crons` entry for `/api/cron/alerts` to `vercel.json` (Vercel sends `Authorization: Bearer $CRON_SECRET`). Don't add a sub-daily cron on the Hobby plan; deploys can be rejected.

## Development

```bash
npm install
npm run dev
npm test
```

Node 24 (`engines`; `netlify.toml` matches).
