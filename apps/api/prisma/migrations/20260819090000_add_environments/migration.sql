-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- DropIndex
DROP INDEX "chat_conversations_projectId_name_key";

-- DropIndex
DROP INDEX "rooms_projectId_name_key";

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- AlterTable
ALTER TABLE "chat_connections" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- AlterTable
ALTER TABLE "chat_conversations" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- AlterTable
ALTER TABLE "error_events" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- AlterTable
ALTER TABLE "webhook_endpoints" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'DEVELOPMENT';

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_projectId_environment_name_key" ON "chat_conversations"("projectId", "environment", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_projectId_environment_name_key" ON "rooms"("projectId", "environment", "name");

