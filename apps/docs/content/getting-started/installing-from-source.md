---
title: Installing from source
description: How to use Livqeno's Python and Flutter SDKs today, before they're published to PyPI and pub.dev.
---

The `@ravenkash/*` JavaScript/TypeScript packages (including the CLI) are
published to npm — see [Install an SDK](/get-started/install-an-sdk) and
just `npm install` them. This page is only for **Python** and **Flutter**,
which aren't on PyPI or pub.dev yet and need a checkout.

> **Do not `pip install raven-sdk`.** That name already belongs to an
> unrelated project on PyPI — the checkout's own package is named
> `raven-sdk` too, but it will need to be renamed before it can be
> published; don't assume the local name is what ends up on PyPI.

## 1. Get a checkout

```bash
git clone https://github.com/atulsinghhhh/Raven.git
cd Raven
```

### Python

```bash
pip install -e /path/to/Raven/sdks/python
```

The `-e` (editable) install points at your checkout, so pulling new
commits updates the package without reinstalling. Then:

```python
from raven import Raven
```

### Flutter

Flutter reads git dependencies directly — no clone or build step needed:

```yaml
dependencies:
  raven_rtc:
    path: ../path/to/your-checkout/sdks/flutter/raven_rtc
  raven_chat:
    path: ../path/to/your-checkout/sdks/flutter/raven_chat
```

A path dependency, not a git one — Livqeno's source isn't a public
repository to point `flutter pub get` at.

## 2. Run Livqeno itself

The SDKs need a Livqeno control plane to talk to. To run one locally:

```bash
cp .env.example .env
npm run infra:up       # Redis, the media server, TURN, the API
npm run infra:verify   # confirms everything is healthy
npm run db:migrate     # apply migrations to your Postgres
npm run db:seed        # optional: a demo developer, project, key, and room
```

`.env` needs a `DATABASE_URL` and `DIRECT_URL` before any of this works —
Postgres is not part of the compose stack. Any Postgres will do; Livqeno's
own deployment uses managed Postgres on Supabase, whose free tier gives you
both connection strings in a couple of minutes.

The API is then at `http://localhost:4100`, with interactive docs at
`/docs`. Point your SDK's `apiUrl`/`endpoint` there. See
[Quickstart](/getting-started/quickstart) for what to do next.

## When this page goes away

Once Python and Flutter are published to PyPI and pub.dev, `pip install`
and the `raven_rtc`/`raven_chat`/`raven_live` pub.dev dependencies
elsewhere in these docs become literally correct, and this page is
deleted.
