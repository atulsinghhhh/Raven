import { config } from 'dotenv';

// Jest globalSetup for the e2e suite. Runs once, before any suite boots the
// app, and refuses to let the tests touch a database that is not local.
//
// This exists because Postgres stopped being a container. `.env`'s
// DATABASE_URL now points at Supabase: the one database every environment
// shares, and the e2e suites create users, projects, rooms and RTC server
// registrations freely, then leave most of them behind. Run against
// Supabase, a single `pnpm test:e2e` writes dozens of `signaling-e2e-*`
// rows into real data, and two concurrent runs fail each other on top of
// that. There is no warning from Prisma or Jest about any of it: the
// connection succeeds and the tests pass.
//
// CI is already safe: .github/workflows/e2e.yml rewrites the URL to its own
// throwaway service container. This guard is what protects a developer's
// terminal, where the failure mode is silent and the damage is to shared
// state. See docs/deployment/managed-postgres.md.

const OVERRIDE = 'ALLOW_E2E_AGAINST_REMOTE_DB';

// host.docker.internal counts as local: it is how a container reaches a
// Postgres on the developer's own machine.
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
]);

export default function guardDatabaseTarget(): void {
  // Same lookup order as app.module.ts and prisma.config.ts, so the guard
  // reads exactly what the suites are about to connect with. dotenv does
  // not overwrite an already-set variable, which is what lets CI (and the
  // override below) win.
  config({ path: ['../../.env', '.env'] });

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — the e2e suite needs a database. See .env.example.',
    );
  }

  let host: string;
  try {
    // Brackets are part of the URL syntax for an IPv6 literal, not the host.
    host = new URL(url).hostname.replace(/^\[|]$/g, '');
  } catch {
    throw new Error(`DATABASE_URL is not a parseable URL: ${url.slice(0, 24)}...`);
  }

  if (LOCAL_HOSTS.has(host)) return;

  if (process.env[OVERRIDE] === '1') {
    console.warn(
      `\n  WARNING: running the e2e suite against ${host} because ${OVERRIDE}=1.\n` +
        '  These tests write real rows and do not clean all of them up.\n',
    );
    return;
  }

  throw new Error(
    `Refusing to run the e2e suite against "${host}".\n\n` +
      'DATABASE_URL points at a remote database. The e2e suites write users,\n' +
      'projects, rooms and RTC server registrations, and leave most of them\n' +
      'behind — that is fine against a throwaway database and not fine against\n' +
      'the one every environment shares.\n\n' +
      'Start a scratch Postgres and point the run at it:\n\n' +
      '  docker run --rm -d --name raven-e2e-db \\\n' +
      '    -p 5455:5432 -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=raven \\\n' +
      '    postgres:16-alpine\n\n' +
      '  E2E_DB="postgresql://postgres:scratch@localhost:5455/raven"\n' +
      // Nothing extra to set up: 20260908999999_ensure_data_api_roles
      // provisions the roles the RLS migration names, so the chain applies
      // to a bare postgres:16-alpine. See
      // docs/deployment/managed-postgres.md#never-name-a-role-in-a-migration.
      '  DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" \\\n' +
      '    pnpm --filter @raven/api prisma:migrate:deploy\n' +
      '  DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" \\\n' +
      '    pnpm --filter @raven/api test:e2e\n\n' +
      `If you really mean to use the remote database, set ${OVERRIDE}=1.\n` +
      'See docs/deployment/managed-postgres.md.',
  );
}
