CREATE TABLE "DashboardLoginAttempt" (
 "id" TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DashboardLoginAttempt_expiresAt_idx" ON "DashboardLoginAttempt"("expiresAt");
ALTER TABLE "DashboardJob" ADD COLUMN "idempotencyKey" TEXT, ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "result" JSONB, ADD COLUMN "cancelRequestedAt" TIMESTAMP(3), ADD COLUMN "finishedAt" TIMESTAMP(3);
ALTER TABLE "DashboardJob" ADD CONSTRAINT "DashboardJob_progress_check" CHECK ("progress" BETWEEN 0 AND 100);
CREATE UNIQUE INDEX "DashboardJob_workspaceId_idempotencyKey_key" ON "DashboardJob"("workspaceId","idempotencyKey");
CREATE TABLE "DashboardWorkerHeartbeat" ("id" TEXT PRIMARY KEY,"seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"activeJobId" TEXT,"stopping" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE "DashboardJobSchedule" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"kind" TEXT NOT NULL,"payload" JSONB NOT NULL,"intervalSeconds" INTEGER NOT NULL,"nextRunAt" TIMESTAMP(3) NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT "DashboardJobSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DashboardJobSchedule_interval_check" CHECK ("intervalSeconds" BETWEEN 60 AND 2592000));
CREATE INDEX "DashboardJobSchedule_enabled_nextRunAt_idx" ON "DashboardJobSchedule"("enabled","nextRunAt");
