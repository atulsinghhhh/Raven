---
title: Create a project
description: A project scopes every room, conversation, key, and quota. Create one before anything else.
---

A **project** is the unit everything else belongs to. A room, a conversation,
a live stream, an API key, an audit entry — each belongs to exactly one
project, and nothing crosses between them.

You need one before you can mint a credential.

## First, find your deployment

Raven is self-hostable, so there is no single dashboard URL to send you to.
Yours is one of:

| Situation | Dashboard |
|---|---|
| Your team runs Raven | The deployment's own dashboard host — linked in the top bar of this site |
| You are running it locally | `http://localhost:3000` (see [Docker Compose](/self-hosting/docker-compose)) |

Running locally, `pnpm db:seed` creates a demo project **and prints an API
key**, which skips this page entirely. See
[Quickstart](/getting-started/quickstart#1-create-a-project-and-a-key).

## From the dashboard

Register, then create a project from the projects screen. The project id
comes back server-side; you never choose it.

Every new project starts with three [environments](/concepts/environment) —
development, staging, production — already isolated from each other. You do
not create them and you cannot add a fourth.

## From the CLI

```bash
raven login
raven projects create my-video-app
```

The CLI is not published to a registry yet, so install it from a checkout
first — [Installing from source](/getting-started/installing-from-source).

`raven login` opens a browser and reuses the dashboard session you already
have. On a machine with no browser, set `RAVEN_TOKEN` instead — see
[CLI](/sdk/cli#authenticate).

List what you have, and set a default so later commands do not need
`--project`:

```bash
raven projects list
raven projects use my-video-app
```

Or link the current directory, which writes a small config file:

```bash
raven init
```

## What a project gives you

| | Scoped to the project |
|---|---|
| Rooms and conversations | Including their names — two projects can both have a `support` room |
| API keys | Revoking one project's key affects no other |
| Webhook endpoints | Per project *and* per environment |
| Connections, errors, usage | Tagged, so metrics read per environment |
| Audit log | Every administrative action, attributable |

What is **not** scoped: the project itself, its name, and who administers
it. See [Roles & permissions](/production/roles-and-permissions).

## Next steps

- [API credentials](/get-started/api-credentials) — create the key your backend will hold.
- [Project concept](/concepts/project) — how a project relates to everything else.
