---
title: API keys
description: How a project API key is stored, verified, rotated, and what a leak does and does not expose.
---

An API key authenticates your backend. It is the only credential that can
mint [tokens](/authentication/tokens), and the only one that must never
leave a server you control.

## Format

```
rvk_prod_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
└─┬─┘└─┬─┘└─────┬────┘ └───────────────┬────────────────┘
  │    │        │                      │
  │    │        │                      └ secret, 32 random bytes, base64url
  │    │        └ public id
  │    └ environment: dev · stg · prod
  └ fixed prefix
```

The two halves do different jobs. The public id is the lookup key. The
secret is verified against a hash and never stored in readable form.

## How verification works

The secret is hashed with bcrypt, and a deployment-wide **pepper**
(`API_KEY_HASH_SECRET`) is mixed in before hashing. The per-key salt lives
in the hash; the pepper lives only in the deployment's configuration.

The consequence is worth being precise about: a database leak on its own is
not enough to brute-force key secrets, because the pepper is not in the
database. A leak of both is.

## Create

```bash
raven keys create --name backend --environment production
```

The secret is returned exactly once, at creation. There is no endpoint that
returns it again — a lost key is replaced, not recovered.

`--environment` accepts `dev`/`development`, `stg`/`staging`,
`prod`/`production` in any case. An unrecognised value is refused rather
than defaulted.

## Send it

```bash
curl "$RAVEN_API_URL/v1/rooms" -H "Authorization: Bearer $RAVEN_API_KEY"
```

Both server SDKs hold it in a private field — never an enumerable property,
so `Object.keys`, `JSON.stringify` and `console.log` cannot reach it, and
the client's own inspect output leaves it out. It is never logged at any
level and never included in a thrown error.

## Rotate

Create, deploy, then revoke:

```bash
raven keys create --name backend-2026-09 --environment production
# deploy, confirm traffic is on the new key
raven keys revoke <oldKeyId>
```

Revoking does not invalidate tokens the old key already minted — those
expire on their own. That is intentional: revocation should not disconnect
every call in progress.

## What a leaked key can do

Everything your backend can, within that project and environment: mint
tokens for any identity with any permissions, read connection and error
history, create and delete rooms, post as any chat user.

What it cannot do: reach another project, reach another environment, read
another key's secret, or administer the project (create keys, change
membership) — those need a dashboard session.

If a key leaks, revoke it first and rotate second. Tokens it minted expire
within 6 hours at the outside.

## Related

- [Access tokens](/authentication/tokens) — what the key is for.
- [Security](/authentication/security) — the whole credential model.
- [Environments](/production/environments)
