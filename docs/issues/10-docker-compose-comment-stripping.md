# 10 — Something strips comments from docker-compose.yml

**Severity:** Low · **Area:** Tooling

## What is wrong

`docker-compose.yml` has twice shown an uncommitted diff consisting of
**nothing but deleted comment lines** — 14 of them, all from the `api`
service's `environment:` block. No functional change, no reordering, just
the explanatory comments gone.

The lines removed each explain something non-obvious that is easy to get
wrong:

- `RTC_TOKEN_SECRET` must differ from `JWT_SECRET` and `CHAT_TOKEN_SECRET`
- `SFU_REGISTRATION_SECRET` is server-to-server only, never client-facing
- `API_PUBLIC_URL` is host-facing and cannot be the internal `api:4000`
- `TURN_INTERNAL_HOST` is hardcoded to the Docker service name because only
  the API's own STUN health check uses it
- `STORAGE_ENDPOINT` is container-to-container, unlike `.env`'s localhost

Losing these makes the file look arbitrary and invites someone to "fix" a
value that is deliberate.

## Status

Restored with `git checkout -- docker-compose.yml` both times. Never
committed.

## Likely cause

An editor or formatter with YAML comment handling that drops comments on
save or reformat — Prettier's YAML parser and some IDE "organize/normalize"
actions do this. It is not in the repo's own tooling: `eslint.config.mjs`
does not cover YAML, and there is no Prettier config for it.

## What to do

1. Identify the tool. If it is an editor-on-save formatter, disable it for
   `*.yml`/`*.yaml` in the workspace settings and commit that so it does not
   recur for others.
2. If a YAML formatter is genuinely wanted, pin one that preserves comments
   and run it in CI so the result is deterministic rather than
   editor-dependent.
3. Watch for it in review — a diff that only removes comments is almost
   never intentional.

## Files

- `docker-compose.yml`
- `docker-compose.scale.yml` (same risk, not yet observed)
