---
title: API key
description: Your backend's permanent credential. The only thing that can mint tokens.
---

An API key identifies your backend to Raven. Treat it like a database
password.

```
rvk_dev_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
└─┬─┘└┬┘└─────┬─────┘ └────────────────┬────────────────┘
  │   │       │                        │
  │   │       └ public id              └ secret, hashed server-side
  │   └ environment
  └ prefix
```

## Why it exists

Three reasons, and each one matters on its own:

- **It is the only thing that can mint a token.** A client cannot call the
  minting endpoints, which is what makes it safe for your backend to decide
  identity and permissions from its own session.
- **It scopes everything downstream** to one project and one environment.
- **It is independently revocable and auditable.** Revoking one project's
  key affects no other, and every call made with it is attributable.

## Where it lives

Your backend's secret storage. Never a frontend bundle, never a mobile
binary, never a committed file. Both server SDKs require it passed
explicitly rather than scanning the environment, because implicit scanning
is how a production key ends up in a development process.

## Minimal example

```ts
import { Raven } from '@corvidhq/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });
```

## Related

- [Token](/concepts/token) — what a client gets instead.
- [API keys](/authentication/api-keys) — hashing, rotation, and what a leak exposes.
- [Security](/authentication/security).
