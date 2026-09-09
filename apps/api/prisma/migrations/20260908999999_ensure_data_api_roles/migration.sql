-- Provisions the three Supabase Data API roles that
-- 20260909000000_enable_row_level_security names, when they are missing, so
-- that migration can be replayed on any Postgres.
--
-- # Why this file is timestamped *before* the migration it fixes
--
-- Read the timestamp as ordering, not as chronology. `prisma migrate deploy`
-- applies pending migrations in filename order, so this is the only way one
-- migration can run before another that already exists — and a *later*
-- migration cannot help here, because the failure it fixes aborts the chain
-- before anything downstream is reached.
--
-- The problem: `20260909000000_enable_row_level_security` refers to roles by
-- literal name, and a database lacking any one of them cannot apply it. The
-- failure aborts that migration and then blocks every migration after it
-- with P3009, which is what makes a fresh non-Supabase database
-- unmigratable.
--
-- `anon`, `authenticated` and `service_role` are Supabase's Data API roles,
-- not Postgres's: that migration revokes grants from the first two and
-- creates a policy for the third. On a plain Postgres none of them exist and
-- the first `REVOKE ... FROM anon` fails with `role "anon" does not exist`
-- (SQLSTATE 42704). Those three are what this migration provisions.
--
-- That migration also named `postgres` — its
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` assumed the cluster's
-- superuser is called that, which CI's `POSTGRES_USER: raven` container is
-- not. This migration does **not** provision a `postgres` role: creating
-- one on a cluster whose superuser is named something else would invent a
-- system-looking account that owns nothing and can do nothing. That
-- statement is guarded on `pg_roles` in the migration itself instead, which
-- costs nothing because bound to `postgres` it only ever governed tables
-- created by `postgres` — see the comment there, and the `current_user`
-- version in 20260909130000_portable_data_api_lockdown that does the real
-- work.
--
-- # Why provision these three instead of guarding the statements
--
-- Guarding each statement on `pg_roles` would also work, but it would mean
-- CI and every self-hosted deployment silently skip the revokes and the
-- policies — so the RLS configuration that production actually runs would
-- never be exercised anywhere it could be tested. Creating the roles keeps
-- one configuration everywhere: the same revokes, the same policy set, on
-- Supabase and on a bare Postgres alike.
--
-- # Why this is safe on a database that has no Supabase
--
-- The roles are inert. `NOLOGIN` means nothing can authenticate as them,
-- they are granted nothing, and no role is a member of them — so they are
-- names for the lockdown to revoke from, and nothing more. On a deployment
-- with no PostgREST in front of it there is no Data API to reach anyway;
-- these exist so the lockdown is expressible rather than because anything
-- uses them.
--
-- Deliberately *not* `BYPASSRLS` on `service_role`: that attribute requires
-- superuser to grant, which a managed-Postgres master user does not have.
-- Supabase's own `service_role` already carries it and this migration does
-- not touch a role that already exists, so production is unaffected.
--
-- Idempotent: a no-op on Supabase, and on any database this has already run
-- against.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;

EXCEPTION
  -- Creating a role needs CREATEROLE, which the connecting role may not
  -- have. Swallowed rather than raised: without it the next migration fails
  -- exactly as it does today, so this is never worse than not running — and
  -- raising here would replace one confusing abort with another.
  --
  -- insufficient_privilege (42501) is the expected one; duplicate_object
  -- (42710) covers two deploys racing on the same cluster, where the loser's
  -- CREATE ROLE lands after the winner's and the IF NOT EXISTS above has
  -- already been evaluated.
  WHEN insufficient_privilege OR duplicate_object THEN
    RAISE NOTICE
      'could not provision the Data API roles as %: %. The next migration will fail on whichever role is still missing.',
      current_user, SQLERRM;
END $$;
