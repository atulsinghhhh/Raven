# Super Admin Portal — Implementation Plan

## 0. Findings from the codebase inspection

- **Monorepo**: plain pnpm workspaces (no Turborepo). `apps/api` (NestJS 10 + Prisma 7 + Supabase Postgres via `@prisma/adapter-pg`), `apps/dashboard` (Next.js 16 App Router), `apps/docs`, `apps/www`.
- **Auth today**: JWT bearer tokens (`JwtAuthGuard`), no platform-level role anywhere. Authorization is entirely project-scoped (`ProjectRole` + `Capability`/`can()` in `apps/api/src/modules/projects/project-permissions.ts`). The dashboard is a BFF: the browser never holds the JWT or calls the API directly (`apps/dashboard/src/lib/api-client.ts`, `session.ts`, `proxy.ts`).
- **No platform-admin concept exists anywhere** — confirmed by repo-wide grep. This is genuinely new infrastructure, not an extension of something partial.
- **Existing audit trail** (`AuditLog` / `AuditService`) is project-scoped, append-only, and only covers 4 domains (keys, members, webhooks, project). It's the template to imitate for the new platform-wide log, not something to extend in place (its `projectId` is required/non-null; a platform admin action often has no project).
- **RLS**: handled automatically. `20260909130000_portable_data_api_lockdown` discovers every table in `public` and locks it down — any new table this plan adds is covered with zero extra migration work.
- **No design-system package** (`packages/ui` does not exist) — the dashboard owns its whole Tailwind theme and component library directly.

## 1. Architecture decision: route inside `apps/dashboard`, not a new app

The spec allows either a dedicated app or "whatever routing structure best matches the existing application." Given there's no shared design-system package, a second Next.js app would mean re-implementing the entire Tailwind theme, shell components, and BFF session plumbing from scratch for no real isolation gain — the actual isolation requirement ("normal developers must never reach this") is enforced by the **API**, not by which repo a page lives in.

**Decision**: build it as `apps/dashboard/src/app/super-admin/**`, with:

- Its own layout (`super-admin/layout.tsx`) that is a hard auth gate — separate from `dashboard/layout.tsx`, checks a platform role, not a session cookie alone.
- Its own shell/nav (visually distinct "console" chrome, no shared sidebar with the developer dashboard, no cross-links).
- A `proxy.ts` matcher addition so unauthenticated hits redirect to `/login` before any page code runs.
- Every single data call going through the same BFF pattern (`api-client.ts`-style, new `super-admin-api-client.ts`) to a **new, separately-guarded** NestJS module — `/v1/super-admin/*` — that re-checks the platform role on every request regardless of what the frontend did. This is what actually satisfies "a manual request to `/api/super-admin/*` must be rejected."

If real isolation (separate deploy, separate domain, separate session lifetime) is wanted later, this structure extracts cleanly since all super-admin code lives under one route subtree and one Nest module.

## 2. Data model additions (additive only — nothing existing is renamed or removed)

- `PlatformRole` enum: `SUPER_ADMIN | ADMIN | SUPPORT | READ_ONLY`.
- `User.platformRole PlatformRole?` — nullable; `null` means "ordinary developer," the default and unchanged case for every existing row.
- `AccountStatus` enum: `ACTIVE | SUSPENDED`. `User.status`, `User.suspendedAt`, `User.suspendedReason` — needed because the spec requires "suspended developers" as an Overview metric and an admin action; no status field existed before. `AuthService.login` gets one additive check: a suspended account gets 403, same `AppError` pattern already used everywhere else.
- `ActivityEvent` model + `ActivityEventType` enum (every type from spec §7) + `ActivityActorType` enum (`USER | ADMIN | SYSTEM | API_KEY`) — the cross-product business/security event stream backing the Developer Activity timeline (§6/§20) and Global Activity Explorer (§8). Optional `projectId`/`developerId` FKs (`onDelete: SetNull`) since not every event has both.
- `AdminAuditLog` model — the separate, stricter, immutable log for actions *administrators* take (§9), with `beforeState`/`afterState` JSON and no update/delete path, following `AuditService`'s existing pattern verbatim (service-only writes, failures logged and swallowed, never thrown, since an audit write must never block the action it's recording — except where the admin write itself *is* the action, e.g. suspending an account, in which case the DB write and the audit write happen in the same transaction).
- No new aggregation tables (usage rollups, error grouping) are added in this pass — metrics are computed by querying existing tables (`Connection`, `ConnectionEvent`, `ErrorEvent`, `UsageSession`, `Message`, `LiveStream`, `RtcServer`, etc.) directly. This avoids inventing numbers and keeps the change additive; see §7 (Retention) below for what to revisit if query cost becomes a problem at scale.

## 3. Retention policy (documented now, enforced later)

- **Admin audit logs (`AdminAuditLog`)**: indefinite retention. Never auto-deleted.
- **Security-relevant `ActivityEvent`s** (auth, suspicious activity, rate limits): indefinite retention for now; revisit once volume is measured.
- **Business `ActivityEvent`s** (project/API/RTC/chat/live lifecycle): no automatic deletion is added in this pass. A future migration can add a scheduled job once real volume data exists — inventing a TTL today would be a guess, not a policy.
- **High-volume telemetry** (`Connection`, `ConnectionEvent`, per-message rows): unchanged — these already exist and already aren't touched by this plan. Note for follow-up: `ConnectionEvent` and chat `Message` volume is the likely first thing to need a retention job; not addressed here because it predates this feature and touches live product paths, not admin-only ones.

## 4. What does *not* get a discrete `ActivityEvent` row per occurrence

Per-message chat sends and per-viewer live-stream joins are explicitly called out in the spec as things that must be aggregated carefully, not logged wholesale. `CHAT_MESSAGE_SENT`/`LIVE_STREAM_VIEWER_JOINED` exist in the enum (so the Activity Explorer can filter by them if a future aggregation job emits rollup events), but this pass does **not** wire per-message/per-viewer-join emission into the hot path — the Chat/Live Streaming operational pages instead read live counts directly off `Message`/`Conversation`/`LiveStream`. This is the one deliberate gap between "every enum value exists" and "every enum value is actively emitted," and it's intentional, not an oversight.

## 5. Backend module layout (`apps/api/src/modules/super-admin/`)

```
super-admin/
  guards/platform-role.guard.ts       — checks req.user.platformRole after JwtAuthGuard has run
  decorators/require-platform-role.decorator.ts
  activity-events.service.ts          — write-through, used by super-admin AND existing modules
  admin-audit.service.ts              — admin-action log, mirrors AuditService
  admin-audit.constants.ts
  dto/*
  overview.controller.ts              — GET /v1/super-admin/overview
  developers.controller.ts            — GET /v1/super-admin/developers, /:id, suspend/unsuspend
  activity.controller.ts              — GET /v1/super-admin/activity (global explorer)
  audit-logs.controller.ts            — GET /v1/super-admin/audit-logs (admin actions only)
  rtc.controller.ts / chat.controller.ts / live.controller.ts
  api.controller.ts / usage.controller.ts / errors.controller.ts
  security.controller.ts / infrastructure.controller.ts
  admins.controller.ts                — manage who holds a PlatformRole
  super-admin.module.ts
```

All controllers: `@UseGuards(JwtAuthGuard, PlatformRoleGuard)`, most `@RequirePlatformRole(PlatformRole.SUPPORT)` (read-only-ish surfaces) or higher for mutating ones (`ADMIN`/`SUPER_ADMIN`). `PlatformRoleGuard` returns 401 if `req.user` is absent (shouldn't happen after `JwtAuthGuard`, but explicit) and 403 if the user's `platformRole` doesn't meet the requirement — never a redirect, never a silent empty response.

## 6. Frontend layout (`apps/dashboard/src/app/super-admin/`)

```
super-admin/
  layout.tsx              — fetches /v1/super-admin/me (new endpoint), redirects non-admins to /dashboard
  page.tsx                — Overview
  developers/page.tsx
  developers/[id]/page.tsx
  activity/page.tsx
  audit-logs/page.tsx
  rtc/page.tsx  chat/page.tsx  live/page.tsx  api/page.tsx
  usage/page.tsx  errors/page.tsx  security/page.tsx  infrastructure/page.tsx
  admins/page.tsx  settings/page.tsx
```

New `lib/super-admin-api-client.ts` (separate from `api-client.ts` — different base concerns, different types, and a page reading it should never accidentally think it's calling the developer-facing API). New `components/console/*` for the distinct ops-console chrome (dark-leaning, denser tables, mono labels for IDs) — built from the *existing* `components/ui/*` primitives (Table, Card, Badge, StatCard, etc.), not a parallel design system.

## 7. Build order

1. Schema + migration (additive, backed by the self-discovering RLS migration already in place).
2. Backend core: guard, decorator, `ActivityEventsService`, `AdminAuditService`, module registration, `/v1/super-admin/me`.
3. Backend + frontend for Overview, Developers (list + detail), Activity Explorer, Admin Audit Logs — the highest-value, most-specified sections.
4. Remaining sections (RTC, Chat, Live, API, Usage, Errors, Security, Infrastructure, Admins, Settings) — built against existing tables, real queries, no invented numbers.
5. Wire `ActivityEventsService` into a representative set of existing mutation points (auth login/signup/failed-login, project CRUD, API key create/revoke, member add/remove, room create, live stream start/end) — chosen because they're the ones the spec's example timeline (§6/§20) actually shows. Exhaustively wiring all ~40 enum values into every corner of the codebase in one pass risks destabilizing working product code for events nobody asked to see yet; this list is deliberately the subset with concrete UI/spec justification, and the rest of the enum stands ready for the next pass.
6. Guard tests (401/403/200).
7. Build/lint verification.

## 8. Security invariants carried through every page/endpoint

- No endpoint trusts a frontend route being hidden — every one re-checks `platformRole` server-side.
- Never expose: password hashes, API key secrets, TURN/JWT secrets, env vars, raw tokens. Developer detail/API pages show key *metadata* only (same rule the existing `ApiKey` model already enforces — `secretHash` is never selected into a response anywhere today, and this plan doesn't change that).
- Chat message *content* is never shown in the admin portal in this pass — only counts/metadata, matching the existing dashboard's own privacy rule (`ChatMessageSummary` has no content field).
- Every admin mutation (suspend, unsuspend, limit change, role grant) requires a `reason` string and writes to `AdminAuditLog` in the same transaction as the mutation.
