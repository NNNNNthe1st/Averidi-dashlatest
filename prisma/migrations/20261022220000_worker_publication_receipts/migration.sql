BEGIN;
-- AlterTable
ALTER TABLE "DashboardJob" ADD COLUMN     "effectCommittedAt" TIMESTAMP(3),
ADD COLUMN     "reconciledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DashboardWorkerHeartbeat" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "DashboardJobSchedule" ADD COLUMN     "lastErrorCode" TEXT;

-- AlterTable
ALTER TABLE "DashboardReportSchedule" ADD COLUMN     "lastErrorCode" TEXT;

-- CreateIndex
CREATE INDEX "DashboardJob_status_reconciledAt_idx" ON "DashboardJob"("status", "reconciledAt");


ALTER TABLE "DashboardJob" ADD CONSTRAINT "DashboardJob_valid_progress_attempts" CHECK ("progress" BETWEEN 0 AND 100 AND "attempts">=0);
ALTER TABLE "DashboardJob" ADD CONSTRAINT "DashboardJob_committed_result" CHECK ("effectCommittedAt" IS NULL OR "result" IS NOT NULL);
COMMIT;
