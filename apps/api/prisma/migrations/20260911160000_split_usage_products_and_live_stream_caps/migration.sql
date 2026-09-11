-- Splits the single shared RTC-minutes pool into three independent
-- free-tier allowances (RTC, CHAT, LIVE_STREAMING), and adds the
-- concurrency cap that keeps a developer to one live stream at a time.
--
-- No existing balance is touched: every current `usage_allowances` row
-- backfills to `product = 'RTC'`, which is what it always implicitly meant,
-- and keeps whatever `includedMinutes` it already had (see
-- UsageAllowanceService.ensureProvisioned — the upsert's `update: {}` never
-- rewrites an existing row, so lowering the RTC default elsewhere in this
-- change only affects newly provisioned accounts). CHAT and LIVE_STREAMING
-- allowance rows are not backfilled here; they're lazily provisioned on
-- first use by the same upsert, exactly like pre-metering-era accounts
-- already are today.

-- CreateEnum
CREATE TYPE "UsageProduct" AS ENUM ('RTC', 'CHAT', 'LIVE_STREAMING');

-- AlterEnum: a new UsageKind for live-stream host/co-host connected time.
-- Safe to add inside this migration's transaction — it's DDL-only, nothing
-- in this file writes a row using the new value.
ALTER TYPE "UsageKind" ADD VALUE 'LIVE_STREAMING_HOST_MINUTES';

-- AlterTable: usage_allowances gains a product dimension and the count
-- fields CHAT needs (messages are discrete counts, not durations).
ALTER TABLE "usage_allowances" ADD COLUMN "product" "UsageProduct" NOT NULL DEFAULT 'RTC';
ALTER TABLE "usage_allowances" ADD COLUMN "includedCount" INTEGER;
ALTER TABLE "usage_allowances" ADD COLUMN "consumedCount" INTEGER NOT NULL DEFAULT 0;

-- includedMinutes/consumedSeconds are RTC/LIVE_STREAMING-only now that CHAT
-- rows exist and never populate them; includedMinutes can no longer be
-- NOT NULL. consumedSeconds keeps its NOT NULL/DEFAULT 0, since every
-- product that uses it wants zero, not null, as the empty state.
ALTER TABLE "usage_allowances" ALTER COLUMN "includedMinutes" DROP NOT NULL;

-- One allowance per (developer, product) instead of per developer.
DROP INDEX "usage_allowances_userId_key";
CREATE UNIQUE INDEX "usage_allowances_userId_product_key" ON "usage_allowances"("userId", "product");

-- Same guardrail style as the original usage-metering migration: restated
-- at the database, not just in application code.
ALTER TABLE "usage_allowances"
  ADD CONSTRAINT "usage_allowances_includedCount_nonneg" CHECK ("includedCount" IS NULL OR "includedCount" >= 0),
  ADD CONSTRAINT "usage_allowances_consumedCount_nonneg" CHECK ("consumedCount" >= 0);

-- AlterTable: usage_sessions records which product's allowance it drew
-- against. Existing rows backfill to RTC (every session before this column
-- existed was one).
ALTER TABLE "usage_sessions" ADD COLUMN "product" "UsageProduct" NOT NULL DEFAULT 'RTC';

-- AlterTable: live_streams gains a denormalised owner, so the free-tier
-- "1 concurrent stream" cap — account-wide, same attribution as
-- UsageAllowance, not per-project — can be enforced by a partial unique
-- index rather than a count-then-act check, which races (two `start()`
-- calls on two different CREATED streams for the same owner can both
-- observe count = 0 and both succeed). The database constraint cannot race.
ALTER TABLE "live_streams" ADD COLUMN "ownerId" TEXT;

UPDATE "live_streams" ls
SET "ownerId" = p."ownerId"
FROM "projects" p
WHERE p."id" = ls."projectId";

ALTER TABLE "live_streams" ALTER COLUMN "ownerId" SET NOT NULL;

ALTER TABLE "live_streams"
  ADD CONSTRAINT "live_streams_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The concurrency cap itself: at most one row per owner with status LIVE.
-- `start()`'s existing conditional `updateMany` becomes the enforcement
-- point for free — catch the unique-violation it now raises and translate
-- it into STREAM_CONCURRENCY_LIMIT_EXCEEDED, the same idiom already used
-- for the LiveStreamHost re-registration race in upsertHost().
CREATE UNIQUE INDEX "live_streams_one_live_per_owner" ON "live_streams"("ownerId") WHERE "status" = 'LIVE';
