BEGIN;
-- AlterTable
ALTER TABLE "DashboardDatasetVersion" ADD COLUMN     "semanticRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DashboardView" ADD COLUMN     "analysisId" TEXT;

-- CreateTable
CREATE TABLE "DashboardAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "semanticRevision" INTEGER NOT NULL,
    "engineVersion" INTEGER NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardAnalysisRun_workspaceId_datasetId_createdAt_idx" ON "DashboardAnalysisRun"("workspaceId", "datasetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAnalysisRun_versionId_semanticRevision_engineVersi_key" ON "DashboardAnalysisRun"("versionId", "semanticRevision", "engineVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAnalysisRun_id_datasetId_workspaceId_key" ON "DashboardAnalysisRun"("id", "datasetId", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardView_analysisId_idx" ON "DashboardView"("analysisId");

-- AddForeignKey
ALTER TABLE "DashboardView" ADD CONSTRAINT "DashboardView_analysisId_datasetId_workspaceId_fkey" FOREIGN KEY ("analysisId", "datasetId", "workspaceId") REFERENCES "DashboardAnalysisRun"("id", "datasetId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAnalysisRun" ADD CONSTRAINT "DashboardAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAnalysisRun" ADD CONSTRAINT "DashboardAnalysisRun_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAnalysisRun" ADD CONSTRAINT "DashboardAnalysisRun_versionId_datasetId_fkey" FOREIGN KEY ("versionId", "datasetId") REFERENCES "DashboardDatasetVersion"("id", "datasetId") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "DashboardAnalysisRun" ADD CONSTRAINT "DashboardAnalysisRun_valid_state" CHECK ("semanticRevision">=0 AND "engineVersion">0 AND "status" IN ('READY','BLOCKED'));
COMMIT;
