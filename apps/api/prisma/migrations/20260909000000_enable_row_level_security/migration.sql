-- Lock down Supabase's auto-exposed Data API (PostgREST) for every table
-- Prisma manages.
--
-- Livqeno never uses Supabase Auth, supabase-js, or PostgREST: the backend
-- authenticates its own users with its own JWT (see AuthService) and talks
-- to Postgres only through Prisma, connected as the `postgres` role
-- (DATABASE_URL/DIRECT_URL — see prisma.service.ts). Supabase nonetheless
-- grants its `anon` and `authenticated` roles full CRUD on every table
-- created in `public` by default and leaves RLS off, which means anyone
-- holding this project's anon key could read or write any row here through
-- the auto-generated REST API. Since `postgres` (and `service_role`) carry
-- BYPASSRLS, enabling RLS here has zero effect on the application itself —
-- Livqeno's real authorization (project membership, capability roles; see
-- project-permissions.ts) already lives entirely in the NestJS layer and is
-- unchanged by this migration.
--
-- Every table below gets the same treatment:
--   1. RLS enabled, with no policy granted to `anon`/`authenticated` —
--      the Data API sees nothing.
--   2. The default `anon`/`authenticated` grants revoked outright, as
--      defense in depth alongside RLS.
--   3. An explicit `service_role` policy, so the intended access path
--      (Supabase's service-role key, which already bypasses RLS) is
--      documented rather than merely implied by role attributes.
--   4. Default privileges on the schema fixed so a future migration that
--      creates a new table does not silently reopen this hole.

-- AlterDefaultPrivileges: stop future CREATE TABLEs in public from being
-- auto-granted to anon/authenticated.
--
-- Guarded on `postgres` existing. This statement assumes the cluster's
-- superuser is called `postgres`; on Supabase it is, but CI's Postgres
-- service container sets `POSTGRES_USER: raven`, and a managed instance
-- uses whatever its master user is called. Unguarded, it fails there with
-- `role "postgres" does not exist` (SQLSTATE 42704), which aborts this
-- migration and blocks every migration after it with P3009.
--
-- Skipping it on those clusters loses nothing, because it never did
-- anything for them: `ALTER DEFAULT PRIVILEGES` binds per (role, schema),
-- so bound to `postgres` it only governs tables created *by* `postgres`.
-- 20260909130000_portable_data_api_lockdown binds the same revoke to
-- `current_user` — the role that actually creates the tables — and that is
-- the one doing the real work. See
-- docs/deployment/managed-postgres.md#never-name-a-role-in-a-migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
  END IF;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'user_tokens',
    'auth_accounts',
    'user_onboarding',
    'projects',
    'project_members',
    'audit_logs',
    'api_keys',
    'rooms',
    'participants',
    'rtc_tokens',
    'connections',
    'connection_events',
    'error_events',
    'chat_conversations',
    'chat_members',
    'chat_messages',
    'chat_reactions',
    'chat_read_states',
    'chat_attachments',
    'chat_connections',
    'webhook_endpoints',
    'webhook_events',
    'webhook_deliveries',
    'live_streams',
    'live_stream_hosts',
    'rtc_servers',
    '_prisma_migrations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;
