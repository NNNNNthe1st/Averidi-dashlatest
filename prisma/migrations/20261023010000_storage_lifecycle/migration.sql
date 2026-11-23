BEGIN;
ALTER TABLE "DashboardDatasetSnapshot" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE TABLE "DashboardStoragePolicy" (
 "workspaceId" TEXT PRIMARY KEY REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "inactiveVersionDays" INTEGER, "archivedDatasetDays" INTEGER,
 "orphanGraceHours" INTEGER NOT NULL DEFAULT 168, "quarantineHours" INTEGER NOT NULL DEFAULT 24,
 "legalHold" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DashboardStoragePolicy_bounds" CHECK (("inactiveVersionDays" IS NULL OR "inactiveVersionDays" BETWEEN 1 AND 3650) AND ("archivedDatasetDays" IS NULL OR "archivedDatasetDays" BETWEEN 1 AND 3650) AND "orphanGraceHours" BETWEEN 24 AND 87600 AND "quarantineHours" BETWEEN 24 AND 87600)
);
CREATE TABLE "DashboardStorageDeletion" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "storageKey" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"fileSize" BIGINT NOT NULL,"reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PLANNED',"entityKind" TEXT,"entityId" TEXT,
 "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"eligibleAfter" TIMESTAMP(3) NOT NULL,
 "deletedAt" TIMESTAMP(3),"attempts" INTEGER NOT NULL DEFAULT 0,"lastErrorCode" TEXT,
 CONSTRAINT "DashboardStorageDeletion_bounds" CHECK ("fileSize">=0 AND attempts>=0 AND status IN ('PLANNED','DELETING','DELETED','CANCELLED','CONFLICT'))
);
CREATE UNIQUE INDEX "DashboardStorageDeletion_workspaceId_storageKey_key" ON "DashboardStorageDeletion"("workspaceId","storageKey");
CREATE INDEX "DashboardStorageDeletion_workspaceId_status_eligibleAfter_idx" ON "DashboardStorageDeletion"("workspaceId","status","eligibleAfter");
CREATE TABLE "DashboardStorageMaintenance" ("id" TEXT PRIMARY KEY,"ownerToken" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
-- Database writers and cleanup share a lock. No new reference can attach to a deletion tombstone.
CREATE FUNCTION dashboard_storage_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws TEXT; k TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dashboard-storage-maintenance',0));
 IF EXISTS(SELECT 1 FROM "DashboardStorageMaintenance" WHERE id='storage' AND "expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'STORAGE_MAINTENANCE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 k:=NEW."storageKey";
 IF TG_TABLE_NAME='DashboardDatasetVersion' THEN SELECT "workspaceId" INTO ws FROM "DashboardDataset" WHERE id=NEW."datasetId"; ELSE ws:=NEW."workspaceId"; END IF;
 IF k IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('dashboard-storage-object:'||ws||':'||k,0));
  IF EXISTS(SELECT 1 FROM "DashboardStorageDeletion" WHERE "workspaceId"=ws AND "storageKey"=k AND status IN ('DELETING','DELETED')) THEN
   IF TG_OP='INSERT' OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey" THEN RAISE EXCEPTION 'STORAGE_OBJECT_RETIRED'; END IF;
   IF TG_TABLE_NAME='DashboardDatasetVersion' AND (to_jsonb(NEW)->>'status') NOT IN ('PURGE_PENDING','PURGED') THEN RAISE EXCEPTION 'STORAGE_OBJECT_RETIRED'; END IF;
   IF TG_TABLE_NAME='DashboardReportExport' AND (to_jsonb(NEW)->>'status') NOT IN ('CLEANUP_PENDING','EXPIRED') THEN RAISE EXCEPTION 'STORAGE_OBJECT_RETIRED'; END IF;
   IF TG_TABLE_NAME='DashboardDatasetSnapshot' AND (to_jsonb(NEW)->>'purgedAt') IS NULL THEN RAISE EXCEPTION 'STORAGE_OBJECT_RETIRED'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dashboard_version_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDatasetVersion" FOR EACH ROW EXECUTE FUNCTION dashboard_storage_reference_guard();
CREATE TRIGGER dashboard_snapshot_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDatasetSnapshot" FOR EACH ROW EXECUTE FUNCTION dashboard_storage_reference_guard();
CREATE TRIGGER dashboard_report_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON "DashboardReportExport" FOR EACH ROW EXECUTE FUNCTION dashboard_storage_reference_guard();
CREATE FUNCTION dashboard_storage_active_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dashboard-storage-maintenance',0));
 IF EXISTS(SELECT 1 FROM "DashboardStorageMaintenance" WHERE id='storage' AND "expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'STORAGE_MAINTENANCE'; END IF;
 IF NEW."activeVersionId" IS NOT NULL THEN
  SELECT "storageKey" INTO k FROM "DashboardDatasetVersion" WHERE id=NEW."activeVersionId";
  IF k IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('dashboard-storage-object:'||NEW."workspaceId"||':'||k,0));
   IF EXISTS(SELECT 1 FROM "DashboardDatasetVersion" WHERE id=NEW."activeVersionId" AND status IN ('PURGE_PENDING','PURGED')) OR EXISTS(SELECT 1 FROM "DashboardStorageDeletion" WHERE "workspaceId"=NEW."workspaceId" AND "storageKey"=k AND status IN ('DELETING','DELETED')) THEN RAISE EXCEPTION 'STORAGE_OBJECT_RETIRED'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dashboard_active_storage_guard BEFORE INSERT OR UPDATE OF "activeVersionId" ON "DashboardDataset" FOR EACH ROW EXECUTE FUNCTION dashboard_storage_active_version_guard();
COMMIT;

