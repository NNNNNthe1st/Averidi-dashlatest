-- Development-only standalone Dashboard schema evolution.
-- Existing DashboardDatasetVersion table must be created before this migration.
ALTER TABLE "DashboardDatasetVersion"
  ADD COLUMN "profile" JSONB,
  ADD COLUMN "semantics" JSONB,
  ADD COLUMN "profiledAt" TIMESTAMP(3);
