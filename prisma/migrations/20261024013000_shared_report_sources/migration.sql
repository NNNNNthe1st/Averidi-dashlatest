-- AlterTable
ALTER TABLE "DashboardReportExport" ADD COLUMN     "sourceViewId" TEXT;

-- CreateIndex
CREATE INDEX "DashboardReportExport_sourceViewId_idx" ON "DashboardReportExport"("sourceViewId");

-- AddForeignKey
ALTER TABLE "DashboardReportExport" ADD CONSTRAINT "DashboardReportExport_sourceViewId_workspaceId_fkey" FOREIGN KEY ("sourceViewId", "workspaceId") REFERENCES "DashboardView"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Existing exports were created under workspace-wide access. Preserve their source binding.
UPDATE "DashboardReportExport" AS e SET "sourceViewId" = r."viewId" FROM "DashboardReportDefinition" AS r WHERE e."reportId" = r.id AND e."workspaceId" = r."workspaceId" AND r."viewId" IS NOT NULL;
