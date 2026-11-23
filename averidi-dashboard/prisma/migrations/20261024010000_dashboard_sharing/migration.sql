-- CreateEnum
CREATE TYPE "DashboardViewAccessMode" AS ENUM ('WORKSPACE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "DashboardShareKind" AS ENUM ('LINK', 'DIRECT');

-- AlterTable
ALTER TABLE "DashboardView" ADD COLUMN     "accessMode" "DashboardViewAccessMode" NOT NULL DEFAULT 'WORKSPACE';

-- AlterTable
ALTER TABLE "DashboardShare" ADD COLUMN     "kind" "DashboardShareKind" NOT NULL DEFAULT 'LINK';

-- AlterTable
ALTER TABLE "DashboardAccessGrant" ADD COLUMN     "membershipId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMembership_id_workspaceId_key" ON "DashboardMembership"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "DashboardAccessGrant" ADD CONSTRAINT "DashboardAccessGrant_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "DashboardMembership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

