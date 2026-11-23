-- Standalone Dashboard subscription only; no website or Analyst billing tables.
CREATE TABLE "DashboardSubscription" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "workspaceId" TEXT NOT NULL,
 "planCode" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'INACTIVE',
 "currentPeriodEnd" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DashboardSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardSubscription_workspaceId_key" ON "DashboardSubscription"("workspaceId");
