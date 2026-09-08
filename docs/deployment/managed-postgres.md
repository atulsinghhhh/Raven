# Raven's database: managed Postgres on Supabase

Raven has no Postgres container. There is **one** database — managed
Postgres on Supabase — and every environment talks to it, including your
laptop. `docker-compose.yml` provides Redis, the SFU, coturn and MinIO;
Postgres is deliberately absent from it.

Supabase supplies managed Postgres and nothing else. Raven does not use the
Supabase JS SDK, Supabase Auth, Supabase Storage or the Supabase REST API,
and adding any of them would be a change in architecture rather than in
hosting. The application still reaches Postgres through Prisma 7 and the
`@prisma/adapter-pg` driver adapter, exactly as it did when Postgres was a
container — the only thing that changed is the connection string.

Neon is the same shape if you ever want to move: a pooled endpoint and a
direct endpoint, used the same two ways.

## Why not a container

The container was the obvious local-first choice and it was wrong for this
one service.

- **Postgres is the system of record.** A per-developer container meant
  per-developer schema drift, and `docker compose down -v` — documented as
  the normal way to get a clean slate — was one keystroke from destroying
  it.
- **Production needed a pooler and backups regardless.** N API instances ×
  `DATABASE_POOL_MAX` competing for `max_connections` is the real ceiling
  on horizontal scaling (`docs/production/capacity-report.md`), and the
  answer to it is a transaction-mode pooler. Supabase ships one. So does
  its backup story.
- **Nothing else in the stack has this property.** Redis holds only
  ephemeral state, MinIO holds attachments that are already replaceable in
  dev, and the SFU and coturn hold nothing at all. They stay local.

## The two connection strings

Managed providers put a **transaction-mode pooler** (PgBouncer or
equivalent) in front of the database and expose it on a different port from
the database itself:

| | Supabase port | Who uses it | Why |
|---|---|---|---|
| Transaction pooler | `6543` | The running API | Many short-lived queries multiplexed over few real backends — this is what keeps `instances × DATABASE_POOL_MAX` under the project's connection ceiling |
| Session mode | `5432` | The Prisma CLI only | One long-lived session that can hold an advisory lock and run multi-statement DDL |

Transaction pooling hands a backend back at the end of every transaction.
That is exactly right for the API and exactly wrong for `prisma migrate`,
which takes an advisory lock and expects to still hold it several
statements later. Run migrations through the pooler and you get a hang or a
lock error — not a message about pooling.

Hence:

```bash
# The running API's pool connects here.
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres"

# The Prisma CLI connects here. Nothing else reads it.
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Both are under **Project Settings → Database → Connection string** in the
Supabase dashboard. Use the shared pooler hostname
(`aws-0-<region>.pooler.supabase.com`) rather than the direct
`db.<ref>.supabase.co` host: the latter is IPv6-only on the free tier,
which is a common cause of `ENETUNREACH` from CI runners and small VMs.

`DIRECT_URL` is optional in the code — the CLI falls back to `DATABASE_URL`
when it is unset, which is correct for a database with no pooler in front
of it (CI's throwaway service container). It is **required** against
Supabase, and `docker-compose.yml` enforces that for the `migrate` service
specifically, since that is the only container that applies migrations.
The `api` service is not given it at all: the running app reads only
`DATABASE_URL`.

## Where each variable is wired

| File | Reads | Purpose |
|---|---|---|
| `apps/api/src/shared/database/prisma.service.ts` | `DATABASE_URL`, `DATABASE_POOL_*` | Builds the `pg.Pool` the app queries through |
| `apps/api/prisma.config.ts` | `DIRECT_URL` ?? `DATABASE_URL`, `SHADOW_DATABASE_URL` | The Prisma CLI's datasource |
| `apps/api/src/shared/config/configuration.ts` | both | Documents every env-driven knob in one place |
| `apps/community-api/**` | `COMMUNITY_DATABASE_URL` | A separate app, separate schema — see below |

`schema.prisma` has no `url`/`directUrl` in its `datasource` block. Prisma 7
dropped them: the CLI reads `prisma.config.ts`, and `PrismaClient` gets its
connection from the driver adapter. Snippets that tell you to add
`directUrl = env("DIRECT_URL")` to the schema are written for Prisma 5/6 and
will not parse here.

## Applying migrations

```bash
cd apps/api
npm run prisma:migrate:deploy   # applies prisma/migrations/ over DIRECT_URL
npm run prisma:seed             # optional: demo developer, project, key, room
```

or `npm run db:migrate` / `npm run db:seed` from the repo root.

Use `migrate deploy`, never `migrate dev`, against Supabase. `migrate dev`
wants a **shadow database** it can create and drop in order to diff your
schema, and Supabase's pooler role cannot `CREATE DATABASE`. The root
`db:migrate` script therefore runs `migrate deploy`; `prisma:migrate:dev`
still exists in `apps/api/package.json` for the authoring workflow below,
which points it at a scratch database instead.

`migrate deploy` is idempotent and applies only what is missing, so
re-running it is always safe.

It still runs as **one** step rather than once per app instance. Locally
that is the `migrate` service in `docker-compose.yml`; in production it is
a one-shot job — the same `apps/api` image with
`command: pnpm exec prisma migrate deploy` and `DIRECT_URL` set — run to
completion before the API instances roll. N instances migrating
concurrently would be N schema-engine sessions contending for one advisory
lock that a transaction-mode pooler cannot hold across multi-statement
DDL, which surfaces as a hang or a lock error on every replica at boot.

## Authoring a new migration

There is no local Postgres to run `migrate dev` against any more, and it
must not be pointed at Supabase. Use a throwaway container for the duration:

```bash
docker run --rm -d --name raven-migrate-scratch \
  -p 5455:5432 -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=raven \
  postgres:16-alpine

SCRATCH="postgresql://postgres:scratch@localhost:5455/raven"

cd apps/api
DIRECT_URL="$SCRATCH" DATABASE_URL="$SCRATCH" \
  npm run prisma:migrate:dev -- --name add_the_thing

docker rm -f raven-migrate-scratch
```

That writes a new directory under `prisma/migrations/`. Commit it, then
apply it to Supabase with `npm run db:migrate` like any other.

`prisma.config.ts` also reads an optional `SHADOW_DATABASE_URL`, which is
what `prisma migrate diff --from-migrations` needs — useful for checking
that the migrations directory and `schema.prisma` still agree:

```bash
SHADOW_DATABASE_URL="$SCRATCH" npm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma --exit-code
```

Leave `SHADOW_DATABASE_URL` unset the rest of the time. `migrate deploy`
never needs it.

## Sizing the pool

`DATABASE_POOL_MAX` (10) is the per-instance `pg.Pool` ceiling;
`instances × DATABASE_POOL_MAX` is what actually competes for the project's
connection limit. A Supabase free-tier project allows far fewer direct
connections than a self-hosted Postgres — the pooler on `:6543` is what
makes this default workable, so keep `DATABASE_URL` pointed at it even for
a single instance. `docs/production/capacity-report.md` has the measured
numbers behind the default.

## Raven Community's schema

`apps/community-api` is a separate application with its own Prisma schema
and its own migrations. It used to get its own logical database
(`raven_community`) on the same container. On Supabase it gets its own
**schema** in the same database instead, selected by the connection string:

```bash
COMMUNITY_DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=raven_community"
```

A separate *database* would have been the closer analogue, but the shared
pooler will not route to one on the free tier. A separate schema preserves
what actually mattered: that app owns its own tables and never touches
Raven's `public` schema, exactly as an external customer's application
wouldn't. Prisma creates the schema on the first `migrate deploy`.

## CI is the one exception

`.github/workflows/e2e.yml` runs against a **throwaway Postgres service
container**, not Supabase. The e2e suite applies migrations and writes
freely, and two concurrent CI runs would corrupt each other's fixtures —
neither is acceptable against a database every environment shares. That
container is a test fixture, not Raven's database.

`.github/workflows/ci.yml` needs no database at all: its `DATABASE_URL` is a
deliberately unreachable placeholder, present only because
`prisma.config.ts` resolves the variable eagerly when generating a client.

### Running the e2e suite locally

A developer's terminal has the same problem CI does, without CI's rewritten
URL: `.env`'s `DATABASE_URL` now points at Supabase, and `npm run test:e2e`
would write dozens of `signaling-e2e-*` users, projects and rooms straight
into it. Nothing about that fails loudly — the connection succeeds and the
tests pass.

`apps/api/test/guard-database-target.ts` (wired in as `globalSetup` in
`test/jest-e2e.json`) refuses to start the suite unless `DATABASE_URL`
resolves to a local host, and prints the scratch-database recipe when it
refuses:

```bash
docker run --rm -d --name raven-e2e-db   -p 5455:5432 -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=raven   postgres:16-alpine

E2E_DB="postgresql://postgres:scratch@localhost:5455/raven"
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" npm run prisma:migrate:deploy --workspace=@raven/api
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" npm run test:e2e --workspace=@raven/api

docker rm -f raven-e2e-db
```

`ALLOW_E2E_AGAINST_REMOTE_DB=1` overrides the guard, with a warning. There
is rarely a good reason to use it.

Cleaning up fixtures that already leaked into the hosted database — the
suites key everything off an `*-e2e-*@raven.local` developer, and cascades
take the projects, rooms and tokens with it:

```sql
delete from users where email like '%e2e%@raven.local';
delete from rtc_servers where name like 'sfu-e2e%';
```

## Resetting

There is no `docker compose down -v` that empties the database any more.
Resetting Raven's data means doing it deliberately, against a database
every environment shares — so it is now a decision rather than a side
effect of cleaning up containers. `prisma migrate reset` (drops everything
and replays every migration) is the blunt instrument, and it goes over
`DIRECT_URL` like every other CLI command:

```bash
cd apps/api && npm exec prisma migrate reset   # destroys all data
```

If you want per-developer scratch data instead, use the throwaway container
from the authoring section above.

## Verifying

```bash
npm run infra:verify
```

The database check there is not a container check: it opens a connection
with the same `pg` client `apps/api` uses and runs `SELECT 1`, so a pass
means the app's own connection path works rather than merely that a port is
open.

`GET /health` is the other half — it reports the database dependency
(`apps/api/src/modules/health`) from inside the running API, which is the
only thing that proves `DATABASE_URL` (the pooler) works. A successful
migration only proves `DIRECT_URL` does.

## Troubleshooting

**`Can't reach database server` / `ENETUNREACH`** — check the host is
`aws-0-<region>.pooler.supabase.com`, not `db.<ref>.supabase.co` (IPv6-only
on the free tier). A paused free-tier project gives the same symptom; resume
it in the dashboard.

**`prisma migrate deploy` hangs or reports a lock error** — it is going
through `:6543`. Check `DIRECT_URL` is set and uses `:5432`.

**`P3005: The database schema is not empty`** — something already created
tables in `public` before the first migration ran. A brand-new Supabase
project has an empty `public` schema, so this usually means a partial
earlier attempt. Confirm what is there
(`select tablename from pg_tables where schemaname = 'public'`) and either
drop it, or baseline: `prisma migrate resolve --applied <migration-name>`
for each migration already reflected in the schema.

**`password authentication failed`** — the username is
`postgres.<project-ref>`, not `postgres`, on the shared pooler. A password
containing `@`, `/`, `:` or `?` must be percent-encoded in the URL.

**No `?pgbouncer=true` needed.** That flag existed to stop Prisma's Rust
query engine from using named prepared statements. `@prisma/adapter-pg`
does not name or cache prepared statements unless you pass a
`statementNameGenerator`, so unnamed statements are already safe through
transaction pooling.
