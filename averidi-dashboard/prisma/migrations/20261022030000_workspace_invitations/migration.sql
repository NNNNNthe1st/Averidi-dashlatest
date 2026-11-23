CREATE TABLE "DashboardWorkspaceInvitation" (
"id" TEXT NOT NULL PRIMARY KEY,
"workspaceId" TEXT NOT NULL,
"invitedById" TEXT NOT NULL,
"tokenHash" TEXT NOT NULL,
"role" TEXT NOT NULL,
"expiresAt" TIMESTAMP(3) NOT NULL,
"revokedAt" TIMESTAMP(3),
"acceptedAt" TIMESTAMP(3),
"acceptedById" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "DashboardWorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
CONSTRAINT "DashboardWorkspaceInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardWorkspaceInvitation_tokenHash_key" ON "DashboardWorkspaceInvitation"("tokenHash");
CREATE INDEX "DashboardWorkspaceInvitation_workspaceId_expiresAt_idx" ON "DashboardWorkspaceInvitation"("workspaceId","expiresAt");
