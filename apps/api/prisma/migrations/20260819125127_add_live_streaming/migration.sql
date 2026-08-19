-- CreateEnum
CREATE TYPE "LiveStreamStatus" AS ENUM ('CREATED', 'STARTING', 'LIVE', 'ENDING', 'ENDED');

-- CreateEnum
CREATE TYPE "LiveStreamVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'AUTHENTICATED');

-- CreateEnum
CREATE TYPE "LiveStreamHostRole" AS ENUM ('HOST', 'CO_HOST');

-- CreateTable
CREATE TABLE "live_streams" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT',
    "roomId" TEXT NOT NULL,
    "conversationId" TEXT,
    "chatRootMessageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT,
    "visibility" "LiveStreamVisibility" NOT NULL DEFAULT 'PUBLIC',
    "metadata" JSONB,
    "status" "LiveStreamStatus" NOT NULL DEFAULT 'CREATED',
    "peakViewerCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_stream_hosts" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "role" "LiveStreamHostRole" NOT NULL DEFAULT 'CO_HOST',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "live_stream_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_streams_publicId_key" ON "live_streams"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "live_streams_roomId_key" ON "live_streams"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "live_streams_conversationId_key" ON "live_streams"("conversationId");

-- CreateIndex
CREATE INDEX "live_streams_projectId_environment_status_idx" ON "live_streams"("projectId", "environment", "status");

-- CreateIndex
CREATE INDEX "live_streams_projectId_environment_createdAt_idx" ON "live_streams"("projectId", "environment", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "live_streams_projectId_environment_roomId_key" ON "live_streams"("projectId", "environment", "roomId");

-- CreateIndex
CREATE INDEX "live_stream_hosts_streamId_idx" ON "live_stream_hosts"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "live_stream_hosts_streamId_identity_key" ON "live_stream_hosts"("streamId", "identity");

-- AddForeignKey
ALTER TABLE "live_streams" ADD CONSTRAINT "live_streams_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_streams" ADD CONSTRAINT "live_streams_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_streams" ADD CONSTRAINT "live_streams_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_stream_hosts" ADD CONSTRAINT "live_stream_hosts_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

