-- Standalone Dashboard initial PostgreSQL schema. No website or Analyst tables.
CREATE TYPE "DashboardDatasetStatus" AS ENUM ('INGESTING', 'READY', 'FAILED', 'ARCHIVED');

CREATE TABLE "DashboardUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "externalSubject" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DashboardUser_externalSubject_key" ON "DashboardUser"("externalSubject");

CREATE TABLE "DashboardWorkspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DashboardMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  CONSTRAINT "DashboardMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DashboardMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardMembership_userId_workspaceId_key" ON "DashboardMembership"("userId","workspaceId");
CREATE INDEX "DashboardMembership_workspaceId_role_idx" ON "DashboardMembership"("workspaceId","role");

CREATE TABLE "DashboardDataset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "DashboardDatasetStatus" NOT NULL DEFAULT 'INGESTING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardDataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DashboardDataset_workspaceId_status_idx" ON "DashboardDataset"("workspaceId","status");

CREATE TABLE "DashboardDatasetVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "datasetId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileSize" BIGINT NOT NULL,
  "rowCount" INTEGER,
  "checksum" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardDatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "DashboardDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardDatasetVersion_datasetId_version_key" ON "DashboardDatasetVersion"("datasetId","version");

CREATE TABLE "DashboardView" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DashboardView_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "DashboardDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DashboardView_workspaceId_updatedAt_idx" ON "DashboardView"("workspaceId","updatedAt");

CREATE TABLE "DashboardMetricDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardMetricDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DashboardMetricDefinition_workspaceId_key_key" ON "DashboardMetricDefinition"("workspaceId","key");

CREATE TABLE "DashboardJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DashboardJob_status_createdAt_idx" ON "DashboardJob"("status","createdAt");
CREATE INDEX "DashboardJob_workspaceId_createdAt_idx" ON "DashboardJob"("workspaceId","createdAt");
