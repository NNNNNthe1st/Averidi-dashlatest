CREATE TABLE "DashboardCheckoutAttempt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "externalSessionId" TEXT,
  "request" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardCheckoutAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DashboardCheckoutAttempt_externalSessionId_key" ON "DashboardCheckoutAttempt"("externalSessionId");
CREATE UNIQUE INDEX "DashboardCheckoutAttempt_workspaceId_activeKey_key" ON "DashboardCheckoutAttempt"("workspaceId","activeKey");
CREATE INDEX "DashboardCheckoutAttempt_workspaceId_createdAt_idx" ON "DashboardCheckoutAttempt"("workspaceId","createdAt");
ALTER TABLE "DashboardCheckoutAttempt" ADD CONSTRAINT "DashboardCheckoutAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardCheckoutAttempt" ADD CONSTRAINT "DashboardCheckoutAttempt_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DashboardBillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
