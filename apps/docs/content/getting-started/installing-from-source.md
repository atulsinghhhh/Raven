---
title: Installing from source
description: How to use Raven's SDKs today, before they're published to npm and PyPI.
---

None of Raven's SDKs are published to a package registry yet. Every
`npm install @raven/...` and `pip install` command in these docs shows
what installation *will* look like — until release, you install from a
local checkout.

> **Do not `pip install raven-sdk`.** That name already belongs to an
> unrelated project on PyPI. Use the local-checkout instructions below.

## 1. Clone and build

```bash
git clone https://github.com/atulsinghhhh/Raven.git
cd Raven
pnpm install
pnpm --filter "./packages/*" run build
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
    "@raven/rtc": "file:../Raven/packages/sdk",
    "@raven/chat": "file:../Raven/packages/chat-sdk",
    "@raven/client": "file:../Raven/packages/client",
    "@raven/react": "file:../Raven/packages/react-sdk",
    "@raven/react-native": "file:../Raven/packages/react-native-sdk",
    "@raven/server": "file:../Raven/packages/server-sdk"
  }
}
```

Adjust the relative paths to wherever you cloned Raven, then
`npm install` (or `pnpm install`). Imports then work exactly as the docs
show them:

```ts
import { createRTCClient } from '@raven/rtc';
```

| Package | Path in the repo |
|---|---|
| `@raven/rtc` | `packages/sdk` |
| `@raven/chat` | `packages/chat-sdk` |
| `@raven/client` | `packages/client` |
| `@raven/react` | `packages/react-sdk` |
| `@raven/react-native` | `packages/react-native-sdk` |
| `@raven/server` | `packages/server-sdk` |
| `@raven/cli` | `packages/cli` |

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
    git:
      url: https://github.com/atulsinghhhh/Raven.git
      path: sdks/flutter/raven_rtc
  raven_chat:
    git:
      url: https://github.com/atulsinghhhh/Raven.git
      path: sdks/flutter/raven_chat
```

Pin to a tag or commit (`ref: v0.1.0`) once you've picked a version, so
`flutter pub get` doesn't silently pull a newer commit later.

## 3. Run Raven itself

The SDKs need a Raven control plane to talk to. To run one locally:

```bash
cp .env.example .env
pnpm infra:up       # Postgres, Redis, LiveKit, coturn, the API
pnpm infra:verify   # confirms everything is healthy
pnpm db:seed        # optional: a demo developer, project, key, and room
```

The API is then at `http://localhost:4100`, with interactive docs at
`/docs`. Point your SDK's `apiUrl`/`endpoint` there. See
[Quickstart](/getting-started/quickstart) for what to do next.

## When this page goes away

Once the packages are published, every install command in these docs
becomes literally correct and this page is deleted. Until then, treat
any `npm install @raven/...` you see as aspirational — this page is the
one that reflects reality.
