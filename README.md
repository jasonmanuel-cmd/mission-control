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
