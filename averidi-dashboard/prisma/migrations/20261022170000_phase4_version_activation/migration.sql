-- Independent Dashboard schema only. Existing READY datasets retain their last profiled version.
ALTER TABLE "DashboardDataset"
  ADD COLUMN "activeVersionId" TEXT;
ALTER TABLE "DashboardDatasetVersion"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "sourceFormat" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "sourceWorksheetName" TEXT,
  ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'REPLACE',
  ADD COLUMN "recordIdentityField" TEXT,
  ADD COLUMN "importSummary" JSONB;

UPDATE "DashboardDatasetVersion"
SET "status" = 'READY'
WHERE "profiledAt" IS NOT NULL;

UPDATE "DashboardDataset" d
SET "activeVersionId" = (
  SELECT v."id"
  FROM "DashboardDatasetVersion" v
  WHERE v."datasetId" = d."id" AND v."status" = 'READY'
  ORDER BY v."version" DESC
  LIMIT 1
)
WHERE d."status" = 'READY';

CREATE INDEX "DashboardDataset_activeVersionId_idx"
  ON "DashboardDataset"("activeVersionId");
