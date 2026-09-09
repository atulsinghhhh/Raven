-- Makes the Supabase Data API lockdown portable, self-healing, and complete.
--
-- 20260909000000_enable_row_level_security introduced the lockdown against a
-- hardcoded list of 28 tables and bound the schema-level default-privileges
-- fix to `FOR ROLE postgres`. Both of those have since caused problems, and
-- this migration is the authoritative statement of the policy from here on.
-- Copy *this* file's shape when adding a table, not the original's.
--
-- Three things change:
--
--   1. **Tables are discovered, not listed.** The original's hardcoded array
--      is why `usage_allowances` and `usage_sessions` needed a second copy
--      of the same block in their own migration. A `pg_class` scan cannot
--      miss a table, so a future migration that forgets to lock one down is
--      corrected the next time this pattern runs rather than leaving a hole
--      nobody notices.
--
--   2. **Default privileges follow the role that actually runs migrations.**
--      `ALTER DEFAULT PRIVILEGES` binds per (role, schema): the original's
--      `FOR ROLE postgres` protects only tables created *by* `postgres`.
--      Supabase's migration role is `postgres`, so production was covered —
--      but CI's Postgres runs as `raven` and a self-hosted deployment uses
--      whatever role its DATABASE_URL names, and for those every new table
--      would have gone on receiving Supabase's default `anon`/
--      `authenticated` grants. `current_user` closes that.
--
--   3. **Every statement is role-guarded.** `anon`, `authenticated` and
--      `service_role` are Supabase's roles, not Postgres's. A plain Postgres
--      has none of them, and an unguarded `REVOKE ... FROM anon` there
--      aborts the whole migration with `role "anon" does not exist` (42704).
--
-- Idempotent throughout, so it is a no-op on a database the original already
-- locked down correctly. See docs/usage-metering.md and
-- docs/security/data-api.md.

-- Per-table: RLS on, the two web roles' grants revoked, and one documented
-- policy for the intended access path.
--
-- Note this covers *every* ordinary table in `public`, including
-- `_prisma_migrations` (as the original did) and anything a future migration
-- adds. Enabling RLS is safe for the application either way: a table's owner
-- bypasses row security unless FORCE ROW LEVEL SECURITY is set, and Prisma
-- connects as the owner — which is also why the app was unaffected by the
-- original.
DO $$
DECLARE
  target record;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  has_service_role boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOR target IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.name);

    IF has_anon THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', target.name);
    END IF;

    IF has_authenticated THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', target.name);
    END IF;

    -- Guarded on the policy not already existing, so this migration can run
    -- on the database the original already treated without failing on a
    -- duplicate name. Postgres has no CREATE POLICY IF NOT EXISTS.
    IF has_service_role AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target.name
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        target.name
      );
    END IF;
  END LOOP;
END $$;

-- Schema-level: stop a *future* CREATE TABLE in `public` from being
-- auto-granted to the web roles. Applied for the role running this
-- migration, which is the role that will create those tables.
--
-- The original's `FOR ROLE postgres` is deliberately left in place rather
-- than revoked: on Supabase that is the migration role, and dropping it
-- would reopen the hole it closed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon',
      current_user
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated',
      current_user
    );
  END IF;
END $$;
