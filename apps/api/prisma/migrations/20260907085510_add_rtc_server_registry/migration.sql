-- CreateEnum
CREATE TYPE "RtcServerStatus" AS ENUM ('HEALTHY', 'DRAINING', 'UNHEALTHY');

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "rtcServerId" TEXT;

-- CreateTable
CREATE TABLE "rtc_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" "RtcServerStatus" NOT NULL DEFAULT 'HEALTHY',
    "publicHost" TEXT NOT NULL,
    "internalUrl" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "activeRooms" INTEGER NOT NULL DEFAULT 0,
    "activeParticipants" INTEGER NOT NULL DEFAULT 0,
    "cpuPercent" DOUBLE PRECISION,
    "memoryPercent" DOUBLE PRECISION,
    "networkInBps" DOUBLE PRECISION,
    "networkOutBps" DOUBLE PRECISION,
    "version" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rtc_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rtc_servers_name_key" ON "rtc_servers"("name");

-- CreateIndex
CREATE INDEX "rtc_servers_region_status_idx" ON "rtc_servers"("region", "status");

-- CreateIndex
CREATE INDEX "rooms_rtcServerId_idx" ON "rooms"("rtcServerId");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_rtcServerId_fkey" FOREIGN KEY ("rtcServerId") REFERENCES "rtc_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
