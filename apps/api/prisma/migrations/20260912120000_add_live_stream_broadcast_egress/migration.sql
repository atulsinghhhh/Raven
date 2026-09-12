-- Broadcast-first Live Streaming redesign, backend core.
--
-- Adds an opt-in delivery mode to LiveStream (RTC_ONLY, today's behavior,
-- stays the default so every existing row and every current integrator is
-- completely unaffected) and a new LiveStreamEgress child table tracking
-- the HLS egress-worker pipeline's own lifecycle for BROADCAST-mode
-- streams. See LIVE_STREAM_P0_FIX_REPORT.md and
-- docs/architecture/cdn-hls-egress-scope.md for background — this
-- supersedes that doc's narrower "HLS past viewer 50" model with HLS as
-- the sole audience path for any stream that opts into BROADCAST.
--
-- No existing data is touched: deliveryMode defaults 'RTC_ONLY' for every
-- current row, and LiveStreamEgress is only ever created for streams that
-- explicitly opt into BROADCAST at creation time.

-- CreateEnum
CREATE TYPE "LiveStreamDeliveryMode" AS ENUM ('RTC_ONLY', 'BROADCAST');

CREATE TYPE "LiveStreamEgressStatus" AS ENUM ('NOT_STARTED', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED');

-- AlterTable
ALTER TABLE "live_streams" ADD COLUMN "deliveryMode" "LiveStreamDeliveryMode" NOT NULL DEFAULT 'RTC_ONLY';

-- CreateTable
CREATE TABLE "live_stream_egress" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "status" "LiveStreamEgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "workerId" TEXT,
    "playbackUrl" TEXT,
    "hlsReadyAt" TIMESTAMP(3),
    "lastSegmentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_stream_egress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_stream_egress_streamId_key" ON "live_stream_egress"("streamId");
CREATE INDEX "live_stream_egress_status_idx" ON "live_stream_egress"("status");

ALTER TABLE "live_stream_egress"
  ADD CONSTRAINT "live_stream_egress_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data-API lockdown: this is a new table, so it needs the same treatment
-- 20260909130000_portable_data_api_lockdown applies to every existing
-- table. That migration's own default-privileges fix only prevents this
-- table from being auto-granted to anon/authenticated; RLS itself has no
-- "apply to future tables" mechanism in Postgres, so it's restated here
-- per that migration's own instruction ("copy this file's shape when
-- adding a table, not the original's").
DO $$
BEGIN
  ALTER TABLE public.live_stream_egress ENABLE ROW LEVEL SECURITY;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.live_stream_egress FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.live_stream_egress FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'live_stream_egress'
      AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access ON public.live_stream_egress FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
