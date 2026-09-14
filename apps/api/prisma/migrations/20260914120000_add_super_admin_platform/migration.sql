-- Super Admin Portal: platform-level roles + account status on `users`, and
-- two new append-only tables (`activity_events`, `admin_audit_logs`).
--
-- Everything here is additive. `users.platformRole` is nullable with no
-- default, so every existing row becomes an ordinary developer with zero
-- Super Admin Portal access — the same outcome as before this migration
-- existed. `users.status` defaults to ACTIVE so no existing account is
-- treated as suspended. See docs/super-admin/implementation-plan.md.
--
-- New tables are picked up automatically by the self-discovering RLS
-- lockdown in 20260909130000_portable_data_api_lockdown — no RLS statements
-- needed here (Prisma connects as table owner and bypasses RLS regardless).

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "ActivityActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'API_KEY');

-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM (
    'USER_SIGNED_UP', 'USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'OAUTH_CONNECTED',
    'PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED', 'PROJECT_MEMBER_ADDED', 'PROJECT_MEMBER_REMOVED',
    'API_KEY_CREATED', 'API_KEY_REVOKED', 'API_REQUEST_FAILED',
    'RTC_ROOM_CREATED', 'RTC_ROOM_ENDED', 'RTC_PARTICIPANT_JOINED', 'RTC_PARTICIPANT_LEFT', 'RTC_CONNECTION_FAILED', 'RTC_RECONNECT', 'RTC_TOKEN_CREATED',
    'CHAT_CONVERSATION_CREATED', 'CHAT_MEMBER_ADDED', 'CHAT_MESSAGE_SENT', 'CHAT_MESSAGE_FAILED',
    'LIVE_STREAM_CREATED', 'LIVE_STREAM_STARTED', 'LIVE_STREAM_ENDED', 'LIVE_STREAM_HOST_JOINED', 'LIVE_STREAM_VIEWER_JOINED', 'LIVE_STREAM_FAILED',
    'SUSPICIOUS_ACTIVITY', 'RATE_LIMIT_TRIGGERED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_UNSUSPENDED',
    'ADMIN_LOGIN', 'ADMIN_USER_VIEWED', 'ADMIN_PROJECT_VIEWED', 'ADMIN_ACCOUNT_SUSPENDED', 'ADMIN_ACCOUNT_UNSUSPENDED', 'ADMIN_LIMIT_CHANGED', 'ADMIN_ACTION'
);

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "suspendedAt" TIMESTAMP(3),
    ADD COLUMN "suspendedReason" TEXT,
    ADD COLUMN "platformRole" "PlatformRole";

-- CreateIndex
CREATE INDEX "users_platformRole_idx" ON "users"("platformRole");

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "eventType" "ActivityEventType" NOT NULL,
    "actorType" "ActivityActorType" NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "projectId" TEXT,
    "developerId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_publicId_key" ON "activity_events"("publicId");

-- CreateIndex
CREATE INDEX "activity_events_developerId_createdAt_idx" ON "activity_events"("developerId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_projectId_createdAt_idx" ON "activity_events"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_eventType_createdAt_idx" ON "activity_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_success_createdAt_idx" ON "activity_events"("success", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_createdAt_idx" ON "activity_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_audit_logs_publicId_key" ON "admin_audit_logs"("publicId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminId_createdAt_idx" ON "admin_audit_logs"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
