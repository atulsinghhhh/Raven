-- Free-tier usage metering: every developer gets a fixed allowance of Livqeno
-- minutes, and every RTC participant-session spends against it.
--
-- Two tables, and the split is the design: `usage_allowances` is the
-- entitlement (what was granted, what has been consumed), `usage_sessions`
-- is the meter (one row per participant-session, each recording how much of
-- itself has already been counted). See docs/usage-metering.md and the
-- comments in schema.prisma.
--
-- The backfill at the bottom grants every existing account the same
-- allowance a new one gets. A developer with six months of projects must
-- not open the dashboard to "0 of 0 minutes".

-- CreateEnum
CREATE TYPE "UsageAllowanceSource" AS ENUM ('FREE_TIER');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('RTC_PARTICIPANT_MINUTES');

-- CreateTable
CREATE TABLE "usage_allowances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "UsageAllowanceSource" NOT NULL DEFAULT 'FREE_TIER',
    "includedMinutes" INTEGER NOT NULL,
    "consumedSeconds" INTEGER NOT NULL DEFAULT 0,
    "exhaustedAt" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_sessions" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "allowanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT',
    "roomId" TEXT,
    "roomName" TEXT NOT NULL,
    "participantIdentity" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL DEFAULT 'RTC_PARTICIPANT_MINUTES',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meteredSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastMeteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_allowances_userId_key" ON "usage_allowances"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_sessions_sessionKey_key" ON "usage_sessions"("sessionKey");

-- CreateIndex
CREATE INDEX "usage_sessions_userId_startedAt_idx" ON "usage_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "usage_sessions_projectId_startedAt_idx" ON "usage_sessions"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "usage_sessions_endedAt_lastMeteredAt_idx" ON "usage_sessions"("endedAt", "lastMeteredAt");

-- AddForeignKey
ALTER TABLE "usage_allowances" ADD CONSTRAINT "usage_allowances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_sessions" ADD CONSTRAINT "usage_sessions_allowanceId_fkey" FOREIGN KEY ("allowanceId") REFERENCES "usage_allowances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_sessions" ADD CONSTRAINT "usage_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guardrails the application also enforces, restated here so the database
-- refuses a broken row whatever writes it. `meteredSeconds` moving backwards
-- would mean an allowance had been credited twice for the same second.
ALTER TABLE "usage_allowances"
  ADD CONSTRAINT "usage_allowances_includedMinutes_nonneg" CHECK ("includedMinutes" >= 0),
  ADD CONSTRAINT "usage_allowances_consumedSeconds_nonneg" CHECK ("consumedSeconds" >= 0);

ALTER TABLE "usage_sessions"
  ADD CONSTRAINT "usage_sessions_meteredSeconds_nonneg" CHECK ("meteredSeconds" >= 0);

-- Backfill: grant every existing developer the same allowance a newly
-- registered one gets. 20000 is written literally because a migration must
-- reproduce itself identically on every database forever — it cannot read
-- USAGE_FREE_TIER_MINUTES, which is a *default for new grants* and may
-- legitimately differ by the time this runs. Accounts created after this
-- migration are provisioned by UsageAllowanceService, not here.
INSERT INTO "usage_allowances" ("id", "userId", "source", "includedMinutes", "consumedSeconds", "grantedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", 'FREE_TIER', 20000, 0, u."createdAt", NOW(), NOW()
FROM "users" u
ON CONFLICT ("userId") DO NOTHING;

-- Same Supabase Data API lockdown every other table gets
-- (20260909000000_enable_row_level_security). A new table created in
-- `public` is exposed through PostgREST to anon/authenticated by default,
-- and these two are as sensitive as anything else here.
--
-- Each role grant is guarded on the role existing. RLS itself is enabled
-- unconditionally — it costs nothing when nothing has a policy and the
-- connecting role carries BYPASSRLS — but `anon`, `authenticated` and
-- `service_role` are Supabase's, not Postgres's. A plain Postgres (CI's
-- throwaway service container, a scratch database for the e2e suite, a
-- self-hosted deployment on RDS) has none of them, and an unguarded
-- REVOKE/CREATE POLICY there aborts the whole migration.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usage_allowances', 'usage_sessions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format(
        'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;
