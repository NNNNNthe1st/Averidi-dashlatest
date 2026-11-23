CREATE TABLE "DashboardQueryCache" (
 id TEXT PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 "workspaceId" TEXT NOT NULL,"viewId" TEXT NOT NULL,
 "scopeHash" TEXT NOT NULL CHECK("scopeHash" ~ '^[a-f0-9]{64}$'),
 payload TEXT NOT NULL CHECK(octet_length(payload)<=262144),
 signature TEXT NOT NULL CHECK(signature ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DashboardQueryCache_lifetime_check" CHECK("expiresAt">"createdAt"),
 CONSTRAINT "DashboardQueryCache_workspaceId_fkey" FOREIGN KEY("workspaceId") REFERENCES "DashboardWorkspace"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DashboardQueryCache_viewId_workspaceId_fkey" FOREIGN KEY("viewId","workspaceId") REFERENCES "DashboardView"(id,"workspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DashboardQueryCache_workspaceId_viewId_scopeHash_idx" ON "DashboardQueryCache"("workspaceId","viewId","scopeHash");
CREATE INDEX "DashboardQueryCache_expiresAt_idx" ON "DashboardQueryCache"("expiresAt");
CREATE INDEX "DashboardQueryCache_createdAt_idx" ON "DashboardQueryCache"("createdAt");
CREATE TRIGGER dashboard_erasure_fence BEFORE INSERT OR UPDATE OR DELETE ON "DashboardQueryCache" FOR EACH ROW EXECUTE FUNCTION dashboard_erasure_admission_guard();
CREATE TRIGGER dashboard_mutation_evidence AFTER INSERT OR UPDATE OR DELETE ON "DashboardQueryCache" FOR EACH ROW EXECUTE FUNCTION dashboard_record_mutation();
