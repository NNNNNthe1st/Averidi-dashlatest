ALTER TABLE "DashboardJob" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "DashboardJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "DashboardJob" ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DashboardJob" ADD COLUMN "lastError" TEXT;
CREATE INDEX "DashboardJob_status_availableAt_idx" ON "DashboardJob"("status","availableAt");
CREATE INDEX "DashboardJob_status_leaseExpiresAt_idx" ON "DashboardJob"("status","leaseExpiresAt");
