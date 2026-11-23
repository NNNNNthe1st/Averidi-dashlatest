BEGIN;
ALTER TABLE "DashboardConnectorConfiguration" ADD COLUMN "activeRefreshJobId" TEXT, ADD COLUMN "activeRefreshLeaseToken" TEXT, ADD COLUMN "oauthAttemptId" TEXT, ADD COLUMN "refreshNotBefore" TIMESTAMP(3);
ALTER TABLE "DashboardCredentialReference" ADD COLUMN "encryptedValue" TEXT;
CREATE TABLE "DashboardConnectorOAuthAttempt" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "connectorId" TEXT NOT NULL,
 "encryptedVerifier" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "consumedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "DashboardConnectorOAuthAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DashboardConnectorOAuthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DashboardConnectorOAuthAttempt_connectorId_workspaceId_fkey" FOREIGN KEY ("connectorId","workspaceId") REFERENCES "DashboardConnectorConfiguration"("id","workspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DashboardConnectorOAuthAttempt_connectorId_consumedAt_idx" ON "DashboardConnectorOAuthAttempt"("connectorId","consumedAt");
CREATE INDEX "DashboardConnectorOAuthAttempt_expiresAt_idx" ON "DashboardConnectorOAuthAttempt"("expiresAt");
COMMIT;
