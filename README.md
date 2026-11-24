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

## Development

```bash
npm install
npm run dev
npm test
```

Node 24 (`engines`; `netlify.toml` matches).
