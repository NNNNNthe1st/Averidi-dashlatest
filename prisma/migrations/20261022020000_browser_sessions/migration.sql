-- Dashboard-only persisted session revocation. No website/Analyst tables touched.
CREATE TABLE "DashboardSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DashboardSession_userId_revokedAt_idx" ON "DashboardSession"("userId","revokedAt");
CREATE INDEX "DashboardSession_expiresAt_idx" ON "DashboardSession"("expiresAt");
