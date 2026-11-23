CREATE TABLE "DashboardSourceMonitoringPolicy" (
 "id" TEXT NOT NULL PRIMARY KEY,"workspaceId" TEXT NOT NULL,"sourceId" TEXT NOT NULL,
 "maxAgeMinutes" INTEGER,"notifyFailures" BOOLEAN NOT NULL DEFAULT true,"notifyMetricFailures" BOOLEAN NOT NULL DEFAULT true,
 "revision" INTEGER NOT NULL DEFAULT 0,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DashboardSourceMonitoringPolicy_age_check" CHECK ("maxAgeMinutes" IS NULL OR "maxAgeMinutes" BETWEEN 1 AND 525600),
 CONSTRAINT "DashboardSourceMonitoringPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DashboardSourceMonitoringPolicy_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId","workspaceId") REFERENCES "DashboardDataSource"("id","workspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardSourceMonitoringPolicy_sourceId_workspaceId_key" ON "DashboardSourceMonitoringPolicy"("sourceId","workspaceId");
CREATE TABLE "DashboardSourceIncident" (
 "id" TEXT NOT NULL PRIMARY KEY,"workspaceId" TEXT NOT NULL,"sourceId" TEXT NOT NULL,"kind" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'OPEN',"code" TEXT NOT NULL,
 "generation" INTEGER NOT NULL DEFAULT 1,"occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"acknowledgedAt" TIMESTAMP(3),"resolvedAt" TIMESTAMP(3),
 CONSTRAINT "DashboardSourceIncident_kind_check" CHECK ("kind" IN ('REFRESH_FAILURE','METRIC_FAILURE','STALE_SOURCE')),
 CONSTRAINT "DashboardSourceIncident_status_check" CHECK ("status" IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
 CONSTRAINT "DashboardSourceIncident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DashboardSourceIncident_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId","workspaceId") REFERENCES "DashboardDataSource"("id","workspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardSourceIncident_sourceId_workspaceId_kind_key" ON "DashboardSourceIncident"("sourceId","workspaceId","kind");
CREATE INDEX "DashboardSourceIncident_workspaceId_status_occurredAt_idx" ON "DashboardSourceIncident"("workspaceId","status","occurredAt");
CREATE TABLE "DashboardObservationBucket" (
 "window" TIMESTAMP(3) NOT NULL,"kind" TEXT NOT NULL,"name" TEXT NOT NULL,"outcome" TEXT NOT NULL,"count" INTEGER NOT NULL DEFAULT 0,"totalMs" DOUBLE PRECISION NOT NULL DEFAULT 0,"maxMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
 CONSTRAINT "DashboardObservationBucket_pkey" PRIMARY KEY ("window","kind","name","outcome")
);
CREATE INDEX "DashboardObservationBucket_kind_window_idx" ON "DashboardObservationBucket"("kind","window");
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardSourceMonitoringPolicy" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardSourceIncident" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
