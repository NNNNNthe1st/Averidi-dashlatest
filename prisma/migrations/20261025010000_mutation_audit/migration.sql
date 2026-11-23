CREATE TABLE "DashboardMutationAudit" (
 id TEXT PRIMARY KEY,
 "workspaceId" TEXT,
 "organizationId" TEXT,
 "userId" TEXT,
 "actorUserId" TEXT,
 "actorIssuer" TEXT NOT NULL,
 "actorSubject" TEXT NOT NULL,
 "actorSource" TEXT NOT NULL,
 "transactionId" TEXT NOT NULL,
 "resourceType" TEXT NOT NULL,
 "resourceId" TEXT NOT NULL,
 operation TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
 action TEXT,
 "changedFields" TEXT[] NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "DashboardMutationAudit_workspaceId_createdAt_id_idx" ON "DashboardMutationAudit"("workspaceId","createdAt",id);
CREATE INDEX "DashboardMutationAudit_organizationId_createdAt_id_idx" ON "DashboardMutationAudit"("organizationId","createdAt",id);
CREATE INDEX "DashboardMutationAudit_userId_createdAt_id_idx" ON "DashboardMutationAudit"("userId","createdAt",id);
CREATE INDEX "DashboardMutationAudit_transactionId_idx" ON "DashboardMutationAudit"("transactionId");
CREATE INDEX "DashboardMutationAudit_createdAt_id_idx" ON "DashboardMutationAudit"("createdAt",id);
CREATE FUNCTION dashboard_record_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE before_row jsonb:='{}'; after_row jsonb:='{}'; row_data jsonb; fields text[]; wid text; oid text; uid text; issuer text; subject text; actor_uid text; source text; rid text; event_action text;
BEGIN
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 SELECT array_agg(key ORDER BY key) INTO fields FROM (SELECT key FROM jsonb_object_keys(before_row||after_row) AS keys(key) WHERE before_row->key IS DISTINCT FROM after_row->key AND key NOT IN ('updatedAt','seenAt','leaseExpiresAt','leaseToken','progress','refreshNotBefore','activeRefreshLeaseToken')) changes;
 IF fields IS NULL THEN RETURN NULL; END IF;
 row_data:=CASE WHEN TG_OP='DELETE' THEN before_row ELSE after_row END;
 wid:=row_data->>'workspaceId';oid:=row_data->>'organizationId';uid:=coalesce(row_data->>'userId',row_data->>'requesterId');
 IF TG_TABLE_NAME='DashboardWorkspace' THEN wid:=row_data->>'id'; END IF;
 IF TG_TABLE_NAME='DashboardOrganization' THEN oid:=row_data->>'id'; END IF;
 IF TG_TABLE_NAME='DashboardUser' THEN uid:=row_data->>'id'; END IF;
 IF wid IS NULL AND row_data->>'datasetId' IS NOT NULL THEN SELECT "workspaceId" INTO wid FROM "DashboardDataset" WHERE id=row_data->>'datasetId'; END IF;
 IF wid IS NULL AND TG_TABLE_NAME='DashboardDatasetVersion' AND row_data->>'storageKey' ~ '^uploads/[A-Za-z0-9_-]+/' THEN wid:=split_part(row_data->>'storageKey','/',2); END IF;
 rid:=coalesce(row_data->>'id',row_data->>'key',wid,oid,uid);
 issuer:=nullif(current_setting('dashboard.audit_issuer',true),'');subject:=nullif(current_setting('dashboard.audit_subject',true),'');actor_uid:=nullif(current_setting('dashboard.audit_user',true),'');source:=nullif(current_setting('dashboard.audit_source',true),'');
 IF TG_TABLE_NAME IN ('DashboardAuditEvent','DashboardAdminAudit','DashboardOrganizationAuditEvent') THEN IF issuer IS DISTINCT FROM row_data->>'actorIssuer' OR subject IS DISTINCT FROM row_data->>'actorSubject' THEN actor_uid:=NULL; END IF; issuer:=row_data->>'actorIssuer';subject:=row_data->>'actorSubject';source:='DOMAIN_EVENT';event_action:=row_data->>'action'; END IF;
 IF issuer IS NULL OR subject IS NULL THEN issuer:='dashboard-database';subject:=current_user;source:='DATABASE_ROLE';actor_uid:=NULL; END IF;
 INSERT INTO "DashboardMutationAudit" (id,"workspaceId","organizationId","userId","actorUserId","actorIssuer","actorSubject","actorSource","transactionId","resourceType","resourceId",operation,action,"changedFields")
 VALUES (gen_random_uuid()::text,wid,oid,uid,actor_uid,issuer,subject,source,txid_current()::text,TG_TABLE_NAME,coalesce(rid,'unidentified'),TG_OP,event_action,fields);
 RETURN NULL;
END;
$$;
-- Runtime writes cannot change past evidence. No retention period is invented here.
CREATE FUNCTION dashboard_protect_mutation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AUDIT_APPEND_ONLY'; END;
$$;
CREATE TRIGGER dashboard_mutation_audit_immutable BEFORE UPDATE OR DELETE ON "DashboardMutationAudit" FOR EACH ROW EXECUTE FUNCTION dashboard_protect_mutation_audit();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardUser" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardWorkspace" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardMembership" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardDataSource" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardDataset" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardDatasetVersion" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardView" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardMetricDefinition" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardJob" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardSession" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardWorkspaceInvitation" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardSubscription" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAdminAudit" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardLoginAttempt" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardJobSchedule" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardExternalIdentity" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardOrganization" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardOrganizationMember" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardOrganizationInvitation" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardWorkspaceRole" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardPermissionGrant" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardDatasetSchema" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardDatasetSnapshot" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardQualityCheck" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardQualityIssue" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardBusinessEntity" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardDataRelationship" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardMetricComponent" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardMetricResult" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardPage" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardWidget" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardSavedView" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardTarget" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAlertRule" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAlertEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardRefreshExecution" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardReportDefinition" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardReportSchedule" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardReportExport" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardReportDelivery" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardShare" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAccessGrant" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAuditEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardBillingPlan" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardBillingCustomer" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardInvoice" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardConnectorConfiguration" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardCredentialReference" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardWebhookRecord" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardOperationalEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardSupportCase" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardConfiguration" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardAnalysisRun" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardConnectorOAuthAttempt" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardStoragePolicy" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardStorageDeletion" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardStorageMaintenance" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardBillingBinding" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardBillingEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardTeam" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardTeamMember" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardOrganizationAuditEvent" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardCheckoutAttempt" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
