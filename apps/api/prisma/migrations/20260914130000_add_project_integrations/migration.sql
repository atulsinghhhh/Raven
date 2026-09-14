-- Integration wizard (quickstart page): one row per (project, product) the
-- developer has picked. Only real facts are stored — the stack selection,
-- and the outcome of an actual server-side verification check. Nothing
-- here is a self-reported "mark as done" checkbox.

-- AlterEnum: new ActivityEventType values for the integration wizard's
-- telemetry (stack selection + connection-test outcomes). DDL-only — safe
-- inside this migration's transaction, nothing here writes a row using
-- these values yet.
ALTER TYPE "ActivityEventType" ADD VALUE 'INTEGRATION_STACK_SELECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INTEGRATION_CONNECTION_TESTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INTEGRATION_CONNECTION_SUCCEEDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'INTEGRATION_CONNECTION_FAILED';

-- CreateTable
CREATE TABLE "project_integrations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "product" "UsageProduct" NOT NULL,
    "language" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerifiedSuccess" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_integrations_projectId_product_key" ON "project_integrations"("projectId", "product");

-- CreateIndex
CREATE INDEX "project_integrations_projectId_idx" ON "project_integrations"("projectId");

-- AddForeignKey
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
