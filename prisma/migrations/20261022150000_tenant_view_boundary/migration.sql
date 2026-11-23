-- Refuse cross-workspace dataset/view relationships at the database boundary.
CREATE UNIQUE INDEX "DashboardDataset_id_workspaceId_key" ON "DashboardDataset"("id", "workspaceId");
ALTER TABLE "DashboardView" DROP CONSTRAINT "DashboardView_datasetId_fkey";
ALTER TABLE "DashboardView" ADD CONSTRAINT "DashboardView_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
