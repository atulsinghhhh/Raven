import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Mirrors app.module.ts's env lookup: root .env first, package-local as fallback.
config({ path: ['../../.env', '.env'] });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // Migrations go over DIRECT_URL when it's set, DATABASE_URL otherwise.
    // The split matters behind a transaction-mode pooler (Supabase's :6543,
    // PgBouncer): the schema engine needs one session it can hold advisory
    // locks on and run multi-statement DDL in, which transaction pooling
    // won't give it. DIRECT_URL points at a session-mode connection
    // (Supabase's :5432) while the app keeps pooling on DATABASE_URL.
    // process.env, not env(): env() throws on an unset name, and DIRECT_URL
    // is optional: a database with no pooler in front of it (CI's service
    // container) needs only DATABASE_URL. `||`, not `??`, so that an empty
    // DIRECT_URL, which is what a compose or k8s default of "" produces,
    // falls back instead of handing the schema engine a blank connection
    // string.
    url: process.env.DIRECT_URL || env('DATABASE_URL'),
    // Only `migrate dev` and `migrate diff --from-migrations` need this,
    // and only because they replay migrations into a throwaway database to
    // diff against. Supabase's pooler role cannot CREATE DATABASE, so
    // there's nothing sensible to default it to. Point it at a scratch
    // Postgres when you are authoring a migration
    // (docs/deployment/managed-postgres.md#authoring-a-new-migration) and
    // leave it unset the rest of the time, which is always for
    // `migrate deploy`.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
