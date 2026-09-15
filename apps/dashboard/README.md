# `@raven/dashboard`

The Livqeno developer dashboard — see **[docs/dashboard.md](../../docs/dashboard.md)**
for the full architecture, authentication model, and feature reference.
This file is just the quick start.

## Run it locally

```
pnpm dashboard:dev   # from the repo root — starts on :3001
```

Requires the Control API (`apps/api`) already running — see
[docs/local-development.md](../../docs/local-development.md) for the full
stack, or `pnpm dev` from the repo root for the API alone. There is no
mock/offline mode: every non-marketing page calls the real API.

## Checks

```
pnpm --filter @raven/dashboard test        # Jest
pnpm --filter @raven/dashboard typecheck   # tsc --noEmit
pnpm --filter @raven/dashboard lint        # eslint
pnpm --filter @raven/dashboard build       # production build
```

## Where things live

- `src/app/` — routes. `dashboard/projects/[projectId]/**` is the
  project-scoped console; `super-admin/**` is the separate internal
  operator portal (see docs/dashboard.md).
- `src/app/api/` — the BFF: one Route Handler per Control API call the
  browser needs, following the pattern in
  `lib/route-helpers.ts`/`lib/api-client.ts`.
- `src/components/ui/` — shared primitives (`Dialog`, `Menu`,
  `InlineConfirm`, `Button`, `Field`, …). Extend these before reaching for
  a new one-off pattern.
- `src/lib/realtime/` — the shared Dashboard WebSocket connection
  (`DashboardRealtimeProvider`) and the debounced-refetch hook every
  realtime list uses.
- `src/__tests__/` — Jest + Testing Library. Prefer semantic queries
  (`getByRole`) over test ids; mock `fetch`, not the components under
  test.

Full detail, including what's deliberately *not* here yet, is in
[docs/dashboard.md](../../docs/dashboard.md).
