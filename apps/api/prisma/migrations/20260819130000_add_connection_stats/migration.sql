-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "bitrateBps" INTEGER,
ADD COLUMN     "codec" TEXT,
ADD COLUMN     "connectionQuality" TEXT,
ADD COLUMN     "jitterMs" INTEGER,
ADD COLUMN     "packetLossPercent" DOUBLE PRECISION,
ADD COLUMN     "rttMs" INTEGER;

