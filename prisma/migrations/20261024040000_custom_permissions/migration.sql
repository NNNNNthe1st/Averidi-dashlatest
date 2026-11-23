ALTER TABLE "DashboardWorkspaceRole" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DashboardPermissionGrant" ADD COLUMN "membershipId" TEXT;
CREATE UNIQUE INDEX "DashboardMembership_id_userId_workspaceId_key" ON "DashboardMembership"("id","userId","workspaceId");
ALTER TABLE "DashboardPermissionGrant" ADD CONSTRAINT "DashboardPermissionGrant_membershipId_userId_workspaceId_fkey" FOREIGN KEY ("membershipId","userId","workspaceId") REFERENCES "DashboardMembership"("id","userId","workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
