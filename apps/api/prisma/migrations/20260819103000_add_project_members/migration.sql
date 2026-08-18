-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER', 'BILLING');

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'DEVELOPER',
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_members_projectId_idx" ON "project_members"("projectId");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every existing project's owner becomes its OWNER member.
--
-- Not optional. Authorization reads project_members from here on, so
-- without this every project created before this migration would become
-- inaccessible to the person who created it. gen_random_uuid() is from
-- pgcrypto, available by default on PostgreSQL 13+.
INSERT INTO "project_members" ("id", "projectId", "userId", "role", "invitedById", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."id", p."ownerId", 'OWNER', NULL, p."createdAt", NOW()
FROM "projects" p
ON CONFLICT ("projectId", "userId") DO NOTHING;
