-- CreateEnum
CREATE TYPE "ConnectionState" AS ENUM ('CONNECTING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR', 'TOKEN_ERROR', 'SIGNALING_ERROR', 'ICE_ERROR', 'TURN_ERROR', 'SFU_ERROR', 'NETWORK_ERROR', 'CLIENT_ERROR', 'UNKNOWN_ERROR');

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT,
    "roomName" TEXT NOT NULL,
    "participantId" TEXT,
    "participantIdentity" TEXT NOT NULL,
    "state" "ConnectionState" NOT NULL DEFAULT 'CONNECTING',
    "disconnectReason" TEXT,
    "region" TEXT,
    "sdkVersion" TEXT,
    "platform" TEXT,
    "browser" TEXT,
    "networkType" TEXT,
    "iceConnectionState" TEXT,
    "signalingState" TEXT,
    "reconnectCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_events" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "roomId" TEXT,
    "participantId" TEXT,
    "category" "ErrorCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "likelyCause" TEXT,
    "suggestedAction" TEXT,
    "sdkVersion" TEXT,
    "platform" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connections_publicId_key" ON "connections"("publicId");

-- CreateIndex
CREATE INDEX "connections_projectId_idx" ON "connections"("projectId");

-- CreateIndex
CREATE INDEX "connections_roomId_idx" ON "connections"("roomId");

-- CreateIndex
CREATE INDEX "connections_participantId_idx" ON "connections"("participantId");

-- CreateIndex
CREATE INDEX "connections_createdAt_idx" ON "connections"("createdAt");

-- CreateIndex
CREATE INDEX "connection_events_connectionId_idx" ON "connection_events"("connectionId");

-- CreateIndex
CREATE INDEX "connection_events_timestamp_idx" ON "connection_events"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "error_events_publicId_key" ON "error_events"("publicId");

-- CreateIndex
CREATE INDEX "error_events_projectId_idx" ON "error_events"("projectId");

-- CreateIndex
CREATE INDEX "error_events_connectionId_idx" ON "error_events"("connectionId");

-- CreateIndex
CREATE INDEX "error_events_category_idx" ON "error_events"("category");

-- CreateIndex
CREATE INDEX "error_events_timestamp_idx" ON "error_events"("timestamp");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
