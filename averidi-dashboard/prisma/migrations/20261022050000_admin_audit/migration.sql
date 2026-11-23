CREATE TABLE "DashboardAdminAudit" ("id" TEXT NOT NULL PRIMARY KEY,"actorIssuer" TEXT NOT NULL,"actorSubject" TEXT NOT NULL,"action" TEXT NOT NULL,"workspaceId" TEXT,"details" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "DashboardAdminAudit_createdAt_idx" ON "DashboardAdminAudit"("createdAt");
CREATE INDEX "DashboardAdminAudit_workspaceId_createdAt_idx" ON "DashboardAdminAudit"("workspaceId","createdAt");
