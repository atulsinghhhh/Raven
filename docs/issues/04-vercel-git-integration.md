# 04 — Vercel has no Git integration, so `git push` does not deploy

**Severity:** Medium · **Area:** CI/CD

## What is wrong

The three Vercel projects (`raven-landing`, `raven-dashboard`,
`raven-docs`) are **not connected to the GitHub repository**. Production
deploys are CLI uploads from whatever is in someone's working tree, which
means the deployed bytes are not guaranteed to match any commit.

There are also no preview deployments, so pull requests cannot be reviewed
against a running build.

## Root cause

The Vercel account has no GitHub **Login Connection**. Creating a
git-linked project fails:

```
Failed to link atulsinghhhh/Raven. You need to add a Login Connection
to your GitHub account first.
```

and `GET /v1/integrations/git-namespaces` returns `[]`. Older projects
(`mehfil`, `qwaali`) still carry github links from when a connection
existed, which is why the dashboard looks partly wired up.

This cannot be fixed from the CLI or the REST API — it needs a browser.

## Fix

1. Vercel dashboard → Settings → **Login Connections** → connect GitHub.
   (Importing any project through the GitHub flow also establishes it.)
2. Per project: Settings → **Git** → connect `atulsinghhhh/Raven`.
3. Set the production branch to `main`.
4. **Re-check each project's Root Directory** — `apps/www`,
   `apps/dashboard`, `apps/docs`. Connecting Git can reset it, and a wrong
   root silently builds the wrong app.
5. Once previews exist, add `RAVEN_API_URL` to the **Preview** target too.
   It is currently Production-only because previews do not exist.

## Consequence today

`docs/deployment/vercel.md` documents the manual flow:

```bash
vercel link --project raven-dashboard --yes
vercel deploy --prod --yes
```

Each `vercel link` rewrites `.vercel/project.json` at the repo root, so
those two commands must be run as a pair per project. Easy to get wrong —
deploying one project's code under another project's name is a single
forgotten `link` away.
