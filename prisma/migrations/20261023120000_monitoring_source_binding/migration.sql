-- Nullable additions preserve existing targets and legacy explicit evaluations.
ALTER TABLE "DashboardTarget"
  ADD COLUMN "datasetId" TEXT,
  ADD COLUMN "currency" CHAR(3),
  ADD COLUMN "definitionVersion" TEXT;
CREATE INDEX "DashboardTarget_datasetId_idx" ON "DashboardTarget"("datasetId");
ALTER TABLE "DashboardTarget" ADD CONSTRAINT "DashboardTarget_datasetId_workspaceId_fkey"
  FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
