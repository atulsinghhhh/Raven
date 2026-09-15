-- Phase 5F: real, persistent dashboard notifications, replacing
-- NotificationsBell's previous behavior of re-deriving a fake list from
-- diagnostics/webhooks/audit logs on every page render with no read
-- state. One row per (recipient, incident): userId is always a real
-- User, projectId is nullable so a future user-global notification has
-- somewhere to live without a schema change, and `dedupeKey` is the
-- idempotency mechanism — see notifications.service.ts.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WEBHOOK_DELIVERY_FAILED', 'WEBHOOK_ENDPOINT_DISABLED', 'LIVE_STREAM_STARTED', 'LIVE_STREAM_ENDED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_publicId_key" ON "notifications"("publicId");

-- CreateIndex: the idempotency constraint — one row per (recipient, incident).
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex: the list/unread-count query's access path.
CREATE INDEX "notifications_userId_projectId_read_createdAt_idx" ON "notifications"("userId", "projectId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data API lockdown for the new table (docs/security/data-api.md), same
-- treatment 20260909130000_portable_data_api_lockdown's own comment says
-- to copy for any table added after it: that migration's schema-level
-- ALTER DEFAULT PRIVILEGES only stops a fresh CREATE TABLE from being
-- auto-granted to Supabase's anon/authenticated Data API roles — it does
-- not enable RLS or add a policy, both of which are per-table and only
-- take effect once actually applied here. Guarded throughout so this is a
-- no-op on a plain Postgres (CI, self-hosted) that has none of Supabase's
-- three Data API roles.
DO $$
BEGIN
  ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "notifications" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "notifications" FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access ON "notifications" FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
