---
title: Installing from source
description: How to use Raven's SDKs today, before they're published to npm and PyPI.
---

None of Raven's SDKs are published to a package registry yet. Every
`npm install @ravenkash/...` and `pip install` command in these docs shows
what installation *will* look like once they are. Raven's source isn't
public — this page is for a checkout your Raven contact has already
given you access to, not something to clone from a public URL.

> **Do not `pip install raven-sdk`.** That name already belongs to an
> unrelated project on PyPI — the checkout's own package is named
> `raven-sdk` too, but it will need to be renamed before it can be
> published; don't assume the local name is what ends up on PyPI.

## 1. Build the checkout

```bash
cd <your Raven checkout>
pnpm install                              # setup — this is a pnpm workspace
npm run build --workspaces --if-present
```

The build step matters: every package's `package.json` points at
`dist/`, so a package that hasn't been built resolves to nothing and you
get a confusing "cannot find module" rather than a useful error.

## 2. Link into your project

### JavaScript / TypeScript

pnpm, npm, and yarn all understand a filesystem path as a dependency
version:

```json
{
  "dependencies": {
    "@ravenkash/rtc": "file:../Raven/packages/sdk",
    "@ravenkash/chat": "file:../Raven/packages/chat-sdk",
    "@ravenkash/client": "file:../Raven/packages/client",
    "@ravenkash/react": "file:../Raven/packages/react-sdk",
    "@ravenkash/react-native": "file:../Raven/packages/react-native-sdk",
    "@ravenkash/server": "file:../Raven/packages/server-sdk"
  }
}
```

Adjust the relative paths to wherever you cloned Raven, then
`npm install` (or `pnpm install`). Imports then work exactly as the docs
show them:

```ts
import { createRTCClient } from '@ravenkash/rtc';
```

| Package | Path in the repo |
|---|---|
| `@ravenkash/rtc` | `packages/sdk` |
| `@ravenkash/chat` | `packages/chat-sdk` |
| `@ravenkash/client` | `packages/client` |
| `@ravenkash/react` | `packages/react-sdk` |
| `@ravenkash/react-native` | `packages/react-native-sdk` |
| `@ravenkash/server` | `packages/server-sdk` |
| `@ravenkash/cli` | `packages/cli` |

### The CLI

```bash
cd Raven/packages/cli
npm link          # puts `raven` on your PATH
raven --version
```

Or run it without linking:

```bash
node /path/to/Raven/packages/cli/dist/index.js --version
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

A path dependency, not a git one — Raven's source isn't a public
repository to point `flutter pub get` at.

## 3. Run Raven itself

The SDKs need a Raven control plane to talk to. To run one locally:

```bash
cp .env.example .env
npm run infra:up       # Redis, the media server, TURN, the API
npm run infra:verify   # confirms everything is healthy
npm run db:migrate     # apply migrations to your Postgres
npm run db:seed        # optional: a demo developer, project, key, and room
```

`.env` needs a `DATABASE_URL` and `DIRECT_URL` before any of this works —
Postgres is not part of the compose stack. Any Postgres will do; Raven's
own deployment uses managed Postgres on Supabase, whose free tier gives you
both connection strings in a couple of minutes.

The API is then at `http://localhost:4100`, with interactive docs at
`/docs`. Point your SDK's `apiUrl`/`endpoint` there. See
[Quickstart](/getting-started/quickstart) for what to do next.

## When this page goes away

Once the packages are published to a registry, every install command in
these docs becomes literally correct and this page is deleted. Until
then, treat any `npm install @ravenkash/...` you see as aspirational —
this page is the one that reflects reality.
