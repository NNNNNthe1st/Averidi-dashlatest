ALTER TABLE "DashboardBillingBinding" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "DashboardUser" ADD COLUMN "erasureRequestedAt" TIMESTAMP(3);
ALTER TABLE "DashboardWorkspace" ADD COLUMN "erasureRequestId" TEXT;
ALTER TABLE "DashboardOrganization" ADD COLUMN "erasureRequestId" TEXT;
CREATE TABLE "DashboardAccountErasure" (
 id TEXT PRIMARY KEY,"userId" TEXT,"receiptHash" TEXT NOT NULL,decision JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','BLOCKED','FAILED','COMPLETED')),
 "leaseToken" TEXT,"leaseExpiresAt" TIMESTAMP(3),"availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 attempts INTEGER NOT NULL DEFAULT 0,"deletedObjects" INTEGER NOT NULL DEFAULT 0,"errorCode" TEXT,"completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),"updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "DashboardAccountErasure_status_availableAt_leaseExpiresAt_idx" ON "DashboardAccountErasure"(status,"availableAt","leaseExpiresAt");
CREATE INDEX "DashboardAccountErasure_userId_idx" ON "DashboardAccountErasure"("userId");
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAccountErasure" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE FUNCTION dashboard_erasure_admission_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r jsonb;wid text;uid text;oid text;pending text;own_request text:=nullif(current_setting('dashboard.erasure_request',true),'');approved boolean:=false;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 wid:=r->>'workspaceId';oid:=r->>'organizationId';uid:=coalesce(r->>'userId',r->>'requesterId',r->>'invitedById');
 IF TG_TABLE_NAME='DashboardWorkspace' THEN wid:=r->>'id'; END IF;
 IF TG_TABLE_NAME='DashboardOrganization' THEN oid:=r->>'id'; END IF;
 IF TG_TABLE_NAME='DashboardUser' THEN uid:=r->>'id'; END IF;
 IF wid IS NULL AND r->>'datasetId' IS NOT NULL THEN SELECT "workspaceId" INTO wid FROM "DashboardDataset" WHERE id=r->>'datasetId'; END IF;
 IF TG_TABLE_NAME='DashboardMembership' AND TG_OP<>'INSERT' AND to_jsonb(OLD)->>'role'='OWNER' AND (TG_OP='DELETE' OR r->>'role'<>'OWNER') AND EXISTS(SELECT 1 FROM "DashboardWorkspace" WHERE id=wid AND "erasureRequestId" IS NULL) THEN
  PERFORM id FROM "DashboardWorkspace" WHERE id=wid FOR UPDATE;
  IF EXISTS(SELECT 1 FROM "DashboardMembership" m JOIN "DashboardUser" u ON u.id=m."userId" WHERE m."workspaceId"=wid AND m.role='OWNER' AND u."erasureRequestedAt" IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM "DashboardMembership" m JOIN "DashboardUser" u ON u.id=m."userId" WHERE m."workspaceId"=wid AND m.role='OWNER' AND m.id<>r->>'id' AND u."erasureRequestedAt" IS NULL) THEN RAISE EXCEPTION 'ERASURE_OWNERSHIP_CHANGED'; END IF;
 END IF;
 IF TG_TABLE_NAME='DashboardOrganizationMember' AND TG_OP<>'INSERT' AND to_jsonb(OLD)->>'role'='OWNER' AND (TG_OP='DELETE' OR r->>'role'<>'OWNER') AND EXISTS(SELECT 1 FROM "DashboardOrganization" WHERE id=oid AND "erasureRequestId" IS NULL) THEN
  PERFORM id FROM "DashboardOrganization" WHERE id=oid FOR UPDATE;
  IF EXISTS(SELECT 1 FROM "DashboardOrganizationMember" m JOIN "DashboardUser" u ON u.id=m."userId" WHERE m."organizationId"=oid AND m.role='OWNER' AND u."erasureRequestedAt" IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM "DashboardOrganizationMember" m JOIN "DashboardUser" u ON u.id=m."userId" WHERE m."organizationId"=oid AND m.role='OWNER' AND m.id<>r->>'id' AND u."erasureRequestedAt" IS NULL) THEN RAISE EXCEPTION 'ERASURE_OWNERSHIP_CHANGED'; END IF;
 END IF;
 IF TG_TABLE_NAME='DashboardStoragePolicy' AND wid IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('dashboard-storage-policy:'||wid,0)); END IF;
 IF own_request IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM "DashboardAccountErasure" e WHERE e.id=own_request AND e.status IN ('PENDING','RUNNING','BLOCKED','FAILED') AND (e."userId"=uid OR e.decision->>'userId'=uid OR e.decision->'workspaceIds' ? wid OR e.decision->'organizationIds' ? oid)) INTO approved;
 END IF;
 IF approved THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF uid IS NOT NULL THEN
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('dashboard-erasure-user:'||uid,0)) THEN RAISE EXCEPTION 'ACCOUNT_ERASURE_BUSY'; END IF;
 END IF;
 IF wid IS NOT NULL THEN
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('dashboard-erasure-workspace:'||wid,0)) THEN RAISE EXCEPTION 'ACCOUNT_ERASURE_BUSY'; END IF;
 END IF;
 IF oid IS NOT NULL THEN
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('dashboard-erasure-organization:'||oid,0)) THEN RAISE EXCEPTION 'ACCOUNT_ERASURE_BUSY'; END IF;
 END IF;
 IF uid IS NOT NULL AND EXISTS(SELECT 1 FROM "DashboardUser" WHERE id=uid AND "erasureRequestedAt" IS NOT NULL) THEN RAISE EXCEPTION 'ACCOUNT_ERASING'; END IF;
 IF TG_TABLE_NAME='DashboardUser' AND TG_OP<>'DELETE' AND r->>'erasureRequestedAt' IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_ERASING'; END IF;
 IF wid IS NOT NULL THEN SELECT "erasureRequestId" INTO pending FROM "DashboardWorkspace" WHERE id=wid; END IF;
 IF TG_TABLE_NAME='DashboardWorkspace' AND TG_OP<>'DELETE' THEN pending:=coalesce(r->>'erasureRequestId',pending); END IF;
 -- Legal holds remain independently writable by the operator while erasure is paused.
 IF oid IS NOT NULL AND pending IS NULL THEN SELECT "erasureRequestId" INTO pending FROM "DashboardOrganization" WHERE id=oid; END IF;
 IF TG_TABLE_NAME='DashboardOrganization' AND TG_OP<>'DELETE' THEN pending:=coalesce(r->>'erasureRequestId',pending); END IF;
 IF pending IS NOT NULL AND TG_TABLE_NAME<>'DashboardStoragePolicy' THEN RAISE EXCEPTION 'WORKSPACE_ERASING'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
-- A privacy operation may remove identifying references, never rewrite mutation evidence.
CREATE OR REPLACE FUNCTION dashboard_protect_mutation_audit() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE req text:=nullif(current_setting('dashboard.erasure_request',true),'');uid text;subjects jsonb;subject_match boolean;expected jsonb;
BEGIN
 IF TG_OP='UPDATE' AND req IS NOT NULL THEN
  SELECT decision->>'userId' INTO uid FROM "DashboardAccountErasure" WHERE id=req AND status='RUNNING';
  subjects:=coalesce(nullif(current_setting('dashboard.erasure_subjects',true),'')::jsonb,'[]');
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(subjects) s WHERE s->>'issuer'=OLD."actorIssuer" AND s->>'subject'=OLD."actorSubject") INTO subject_match;
  IF uid IS NOT NULL THEN
   expected:=to_jsonb(OLD)||jsonb_build_object(
    'userId',CASE WHEN OLD."userId"=uid THEN NULL ELSE OLD."userId" END,
    'actorUserId',CASE WHEN OLD."actorUserId"=uid THEN NULL ELSE OLD."actorUserId" END,
    'actorIssuer',CASE WHEN subject_match OR OLD."actorUserId"=uid THEN 'erased-account' ELSE OLD."actorIssuer" END,
    'actorSubject',CASE WHEN subject_match OR OLD."actorUserId"=uid THEN req ELSE OLD."actorSubject" END);
   IF to_jsonb(NEW)=expected THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'AUDIT_APPEND_ONLY';
END;
$$;
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardUser" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardWorkspace" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardMembership" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDataSource" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDataset" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDatasetVersion" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardView" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardMetricDefinition" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardJob" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardSession" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardWorkspaceInvitation" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardSubscription" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardLoginAttempt" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardJobSchedule" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardExternalIdentity" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardOrganization" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardOrganizationMember" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardOrganizationInvitation" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardWorkspaceRole" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardPermissionGrant" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDatasetSchema" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDatasetSnapshot" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardQualityCheck" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardQualityIssue" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardBusinessEntity" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardDataRelationship" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardMetricComponent" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardMetricResult" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardPage" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardWidget" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardSavedView" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardTarget" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardAlertRule" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardAlertEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardRefreshExecution" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardReportDefinition" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardReportSchedule" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardReportExport" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardReportDelivery" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardShare" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardAccessGrant" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardBillingPlan" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardBillingCustomer" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardInvoice" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardConnectorConfiguration" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardCredentialReference" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardWebhookRecord" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardSupportCase" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardConfiguration" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardAnalysisRun" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardConnectorOAuthAttempt" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardStoragePolicy" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardStorageDeletion" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardStorageMaintenance" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardBillingBinding" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardBillingEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardTeam" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardTeamMember" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardCheckoutAttempt" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
