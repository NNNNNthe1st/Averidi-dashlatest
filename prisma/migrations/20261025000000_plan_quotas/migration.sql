-- Opt-in Dashboard-owned plan policy. Existing plans and subscriptions are unchanged.
-- SECURITY INVOKER, migration-schema search path; no dynamic SQL or external data.
CREATE FUNCTION dashboard_quota_usage(wid text) RETURNS jsonb LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$
 SELECT jsonb_build_object(
 'seats',(SELECT count(*)::text FROM "DashboardMembership" WHERE "workspaceId"=wid),
 'datasets',(SELECT count(*)::text FROM "DashboardDataset" WHERE "workspaceId"=wid AND status<>'ARCHIVED'),
 'dashboards',(SELECT count(*)::text FROM "DashboardView" WHERE "workspaceId"=wid),
 'connectors',(SELECT count(*)::text FROM "DashboardConnectorConfiguration" WHERE "workspaceId"=wid),
 'reports',(SELECT count(*)::text FROM "DashboardReportDefinition" WHERE "workspaceId"=wid),
 'schedules',((SELECT count(*) FROM "DashboardJobSchedule" WHERE "workspaceId"=wid AND enabled)+(SELECT count(*) FROM "DashboardReportSchedule" WHERE "workspaceId"=wid AND enabled))::text,
 'customMetrics',(SELECT count(*)::text FROM "DashboardMetricDefinition" WHERE "workspaceId"=wid AND "key" LIKE 'CUSTOM\_FORMULA\_%' ESCAPE '\'),
 'relationships',(SELECT count(*)::text FROM "DashboardDataRelationship" WHERE "workspaceId"=wid),
 'alerts',(SELECT count(*)::text FROM "DashboardAlertRule" WHERE "workspaceId"=wid AND enabled),
 'targets',(SELECT count(*)::text FROM "DashboardTarget" WHERE "workspaceId"=wid),
 'teams',(SELECT count(*)::text FROM "DashboardTeam" WHERE "workspaceId"=wid),
 'customRoles',(SELECT count(*)::text FROM "DashboardWorkspaceRole" WHERE "workspaceId"=wid),
 'shares',(SELECT count(*)::text FROM "DashboardShare" sh WHERE sh."workspaceId"=wid AND sh."revokedAt" IS NULL AND sh."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND (sh.kind='LINK' OR EXISTS(SELECT 1 FROM "DashboardAccessGrant" g JOIN "DashboardMembership" m ON m.id=g."membershipId" AND m."userId"=g."userId" AND m."workspaceId"=g."workspaceId" WHERE g."shareId"=sh.id AND g."workspaceId"=wid AND g."revokedAt" IS NULL AND (g."expiresAt" IS NULL OR g."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))))),
 'storedBytes',coalesce((SELECT sum(bytes)::text FROM (
  SELECT v."storageKey",max(v."fileSize") bytes FROM "DashboardDatasetVersion" v JOIN "DashboardDataset" d ON d.id=v."datasetId" WHERE d."workspaceId"=wid GROUP BY v."storageKey"
  UNION ALL SELECT s."storageKey",max(s."fileSize") FROM "DashboardDatasetSnapshot" s WHERE s."workspaceId"=wid GROUP BY s."storageKey"
  UNION ALL SELECT r."storageKey",max(r."fileSize") FROM "DashboardReportExport" r WHERE r."workspaceId"=wid AND r."storageKey" IS NOT NULL GROUP BY r."storageKey"
 ) files WHERE NOT EXISTS(SELECT 1 FROM "DashboardStorageDeletion" x WHERE x."workspaceId"=wid AND x."storageKey"=files."storageKey" AND x.status='DELETED')),'0')
 );
$$;
CREATE FUNCTION dashboard_storage_quota_allows(wid text, object_key text, incoming bigint) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path FROM CURRENT AS $$
DECLARE policy jsonb; used numeric; existing numeric;
BEGIN
 SELECT p.entitlements->'quotas' INTO policy FROM "DashboardSubscription" s JOIN "DashboardBillingPlan" p ON p.id=s."billingPlanId" WHERE s."workspaceId"=wid;
 IF policy->>'storedBytes' IS NULL THEN RETURN true; END IF;
 SELECT coalesce(max(bytes),0) INTO existing FROM (
 SELECT v."fileSize" AS bytes FROM "DashboardDatasetVersion" v JOIN "DashboardDataset" d ON d.id=v."datasetId" WHERE d."workspaceId"=wid AND v."storageKey"=object_key
 UNION ALL SELECT "fileSize" FROM "DashboardDatasetSnapshot" WHERE "workspaceId"=wid AND "storageKey"=object_key
 UNION ALL SELECT "fileSize" FROM "DashboardReportExport" WHERE "workspaceId"=wid AND "storageKey"=object_key
 ) f;
 IF existing>=incoming AND incoming>=0 THEN RETURN true; END IF;
 used:=(dashboard_quota_usage(wid)->>'storedBytes')::numeric;
 RETURN incoming>=0 AND used+greatest(incoming-existing,0)<=(policy->>'storedBytes')::numeric;
END;
$$;
CREATE FUNCTION dashboard_enforce_quota() RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path FROM CURRENT AS $$
DECLARE wid text; resource text:=TG_ARGV[0]; policy jsonb; used numeric; old_counted boolean:=false; new_counted boolean:=true; before_bytes bigint:=0;
BEGIN
 IF TG_TABLE_NAME='DashboardDatasetVersion' THEN
  SELECT "workspaceId" INTO wid FROM "DashboardDataset" WHERE id=NEW."datasetId";
 ELSE wid:=to_jsonb(NEW)->>'workspaceId'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME<>'DashboardDatasetVersion' AND (to_jsonb(OLD)->>'workspaceId') IS DISTINCT FROM wid THEN RAISE EXCEPTION 'DASHBOARD_QUOTA_SCOPE_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='DashboardDatasetVersion' AND (to_jsonb(OLD)->>'datasetId') IS DISTINCT FROM (to_jsonb(NEW)->>'datasetId') THEN RAISE EXCEPTION 'DASHBOARD_QUOTA_SCOPE_IMMUTABLE'; END IF;
 IF resource='storedBytes' THEN
  IF TG_OP='UPDATE' THEN before_bytes:=coalesce((to_jsonb(OLD)->>'fileSize')::bigint,0); END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'storageKey') IS NOT NULL AND (to_jsonb(OLD)->>'storageKey') IS DISTINCT FROM (to_jsonb(NEW)->>'storageKey') THEN RAISE EXCEPTION 'DASHBOARD_QUOTA_SCOPE_IMMUTABLE'; END IF;
  IF coalesce((to_jsonb(NEW)->>'fileSize')::bigint,0)<=before_bytes THEN RETURN NEW; END IF;
 ELSIF resource='schedules' OR resource='alerts' THEN
  new_counted:=(to_jsonb(NEW)->>'enabled')::boolean;
  IF TG_OP='UPDATE' THEN old_counted:=(to_jsonb(OLD)->>'enabled')::boolean; END IF;
 ELSIF resource='datasets' THEN
  new_counted:=NEW.status<>'ARCHIVED';
  IF TG_OP='UPDATE' THEN old_counted:=OLD.status<>'ARCHIVED'; END IF;
 ELSIF resource='customMetrics' THEN
  new_counted:=(NEW."key" LIKE 'CUSTOM\_FORMULA\_%' ESCAPE '\');
  IF TG_OP='UPDATE' THEN old_counted:=(OLD."key" LIKE 'CUSTOM\_FORMULA\_%' ESCAPE '\'); END IF;
 ELSIF resource='shares' THEN
  new_counted:=NEW."revokedAt" IS NULL AND (NEW."expiresAt" IS NULL OR NEW."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'));
  IF TG_TABLE_NAME='DashboardAccessGrant' THEN new_counted:=new_counted AND (to_jsonb(NEW)->>'membershipId') IS NOT NULL; END IF;
  IF TG_OP='UPDATE' THEN old_counted:=OLD."revokedAt" IS NULL AND (OLD."expiresAt" IS NULL OR OLD."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')); IF TG_TABLE_NAME='DashboardAccessGrant' THEN old_counted:=old_counted AND (to_jsonb(OLD)->>'membershipId') IS NOT NULL; IF (to_jsonb(OLD)->>'shareId') IS DISTINCT FROM (to_jsonb(NEW)->>'shareId') OR (to_jsonb(OLD)->>'membershipId') IS DISTINCT FROM (to_jsonb(NEW)->>'membershipId') OR (to_jsonb(OLD)->>'userId') IS DISTINCT FROM (to_jsonb(NEW)->>'userId') THEN old_counted:=false; END IF; END IF; END IF;
 ELSE old_counted:=TG_OP='UPDATE'; END IF;
 IF resource<>'storedBytes' AND (NOT new_counted OR old_counted) THEN RETURN NEW; END IF;
 SELECT p.entitlements->'quotas' INTO policy FROM "DashboardSubscription" s JOIN "DashboardBillingPlan" p ON p.id=s."billingPlanId" WHERE s."workspaceId"=wid;
 IF policy->>resource IS NULL THEN RETURN NEW; END IF;
 -- Every writer uses this same lock, including native workers, webhook and generic routes.
 PERFORM pg_advisory_xact_lock(hashtextextended('dashboard-quota:'||wid,0));
 SELECT p.entitlements->'quotas' INTO policy FROM "DashboardSubscription" s JOIN "DashboardBillingPlan" p ON p.id=s."billingPlanId" WHERE s."workspaceId"=wid;
 IF policy->>resource IS NULL THEN RETURN NEW; END IF;
 used:=(dashboard_quota_usage(wid)->>resource)::numeric;
 IF used>(policy->>resource)::numeric THEN RAISE EXCEPTION 'DASHBOARD_QUOTA_EXCEEDED:%',resource USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardMembership" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('seats');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardDataset" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('datasets');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardView" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('dashboards');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardConnectorConfiguration" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('connectors');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardReportDefinition" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('reports');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardJobSchedule" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('schedules');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardReportSchedule" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('schedules');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardMetricDefinition" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('customMetrics');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardDataRelationship" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('relationships');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardAlertRule" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('alerts');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardTarget" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('targets');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardTeam" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('teams');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardWorkspaceRole" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('customRoles');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardShare" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('shares');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardDatasetVersion" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('storedBytes');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardDatasetSnapshot" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('storedBytes');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardReportExport" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('storedBytes');
CREATE TRIGGER dashboard_plan_quota AFTER INSERT OR UPDATE ON "DashboardAccessGrant" FOR EACH ROW EXECUTE FUNCTION dashboard_enforce_quota('shares');
