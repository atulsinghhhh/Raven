---
title: API credentials
description: Create a project API key, store it server-side, and never ship it to a client.
---

Your backend authenticates to Raven with a **project API key**. It is the
only credential that can mint tokens, and it must never leave your server.

## Create a key

```bash
raven keys create --name backend --environment development
```

The secret is printed exactly once:

```
rvk_dev_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
```

Store it as `RAVEN_API_KEY` in your backend's secret storage. Raven keeps
only a hash — there is no endpoint that returns a key secret again, so a
lost key is replaced rather than recovered.

`--environment` accepts `dev`/`development`, `stg`/`staging`,
`prod`/`production`, in any case. An unrecognised value is refused rather
than defaulted: quietly issuing a development key to someone who typed
`--environment prd` is the worst available outcome. Omitting the flag
creates a development key.

## Anatomy

```
rvk_dev_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
└─┬─┘└┬┘└─────┬─────┘ └────────────────┬────────────────┘
  │   │       │                        │
  │   │       └ public id              └ secret — hashed server-side
  │   └ environment label (for you to read)
  └ prefix
```

A development key cannot reach production data however it is asked, because
**the environment is a property of the key's record** and is never something
a request can specify. Authentication looks the key up by its public id and
reads the environment off the row.

The `dev`/`stg`/`prod` segment is a label so you can tell keys apart at a
glance. It is not what is checked — editing it changes nothing, and a key
minted without one (the seed script does this) authenticates normally.

## Use it

```bash
curl https://api.your-raven-deployment.example/v1/rooms \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

An integration needs **two** values, not one — the key, and the URL of the
control plane it authenticates against. Both server SDKs require each to be
passed explicitly, and neither scans the environment for you:

| Variable | Value | Why it is required |
|---|---|---|
| `RAVEN_API_KEY` | `rvk_<publicId>.<secret>` | Authenticates your backend. Server-side only. |
| `RAVEN_API_URL` | `https://api.ravenstack.online`, or your own deployment | `baseUrl`/`base_url` defaults to `http://localhost:4100`. Omit it against a hosted deployment and every call fails with a network error, not an auth error. |


```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL!, // https://api.ravenstack.online
});
```

```python
import os
from raven import Raven

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ["RAVEN_API_URL"],  # https://api.ravenstack.online
)
```

Implicit environment-scanning is exactly the behaviour that picks up a
production key in a development process.

## Rotate and revoke

```bash
raven keys list
raven keys revoke <keyId>
```

Revoking a key does not invalidate the tokens it already minted — those
expire on their own schedule. Rotation is create-then-revoke: issue the new
key, deploy it, then revoke the old one.

## Never in a client

An API key in a browser bundle, a mobile binary, or a committed file is a
full-project credential in public. What a client gets instead is a
[token](/get-started/first-token): short-lived, scoped to one room or
conversation, and useless anywhere else.

Read [Security](/authentication/security) before you go to production.

## Next steps

- [Install an SDK](/get-started/install-an-sdk).
- [API keys in depth](/authentication/api-keys) — hashing, pepper, and what a leak does and does not expose.
