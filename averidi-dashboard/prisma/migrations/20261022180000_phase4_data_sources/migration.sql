-- Add a tenant-bound, Dashboard-owned data-source registry. Existing datasets become FILE sources.
CREATE TABLE "DashboardDataSource" (
 "id" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "lastCheckedAt" TIMESTAMP(3),
 "lastSyncedAt" TIMESTAMP(3),
 "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DashboardDataSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardDataSource_id_workspaceId_key" ON "DashboardDataSource"("id","workspaceId");
CREATE INDEX "DashboardDataSource_workspaceId_status_idx" ON "DashboardDataSource"("workspaceId","status");
ALTER TABLE "DashboardDataSource" ADD CONSTRAINT "DashboardDataSource_workspaceId_fkey"
 FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardDataset" ADD COLUMN "sourceId" TEXT;
INSERT INTO "DashboardDataSource" ("id","workspaceId","kind","name","status","createdAt","updatedAt")
 SELECT 'file_source_' || "id", "workspaceId", 'FILE', "name", 'CONNECTED', "createdAt", "updatedAt"
 FROM "DashboardDataset";
UPDATE "DashboardDataset" SET "sourceId"='file_source_' || "id";
ALTER TABLE "DashboardDataset" ADD CONSTRAINT "DashboardDataset_sourceId_workspaceId_fkey"
 FOREIGN KEY ("sourceId","workspaceId") REFERENCES "DashboardDataSource"("id","workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
