---
title: Environment
description: Development, staging, production. Fixed at three, isolated all the way down.
---

Every project has exactly three environments:

```
Project
├── development   (the default, everywhere)
├── staging
└── production
```

You cannot add a fourth, and you cannot rename them.

## Why it exists

So that testing cannot touch real customer data. The isolation is not a
naming convention — it is enforced at the credential level.

## How isolation works

An [API key](/concepts/api-key) belongs to one environment, and the
environment is part of the key itself (`rvk_prod_...`). Every
[token](/concepts/token) that key mints carries the environment as a signed
claim. So the environment is never something a request specifies, which
means no client can reach production by editing a field.

| | Isolated |
|---|---|
| API keys | A key belongs to exactly one environment |
| Tokens | Inherited from the minting key, signed in |
| Rooms and conversations | Including their names |
| Webhook endpoints | A staging endpoint never receives production events |
| Connections, errors, usage | Tagged, so metrics read per environment |

## Minimal example

```bash
raven keys create --name backend --environment production
```

API-key routes take no `environment` parameter — the key decides.
Dashboard-session routes that need one accept `?environment=` and default to
development.

## Related

- [Environments](/production/environments) — the full behaviour, including what is *not* isolated.
- [Known limitations](/reference/known-limitations) — one deployment-level caveat worth reading.
