-- Additive Dashboard-only migration. Invalid existing active-version links abort atomically.
BEGIN;

-- AlterTable
ALTER TABLE "DashboardWorkspace" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DashboardSubscription" ADD COLUMN     "billingPlanId" TEXT;

-- CreateTable
CREATE TABLE "DashboardExternalIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardOrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DashboardOrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardOrganizationInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DashboardOrganizationInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWorkspaceRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardWorkspaceRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardPermissionGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "DashboardPermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardDatasetSchema" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,

    CONSTRAINT "DashboardDatasetSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardDatasetSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,

    CONSTRAINT "DashboardDatasetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardQualityCheck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "summary" JSONB,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,

    CONSTRAINT "DashboardQualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardQualityIssue" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "field" TEXT,
    "rowNumber" INTEGER,
    "details" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkId" TEXT NOT NULL,

    CONSTRAINT "DashboardQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardBusinessEntity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datasetId" TEXT NOT NULL,

    CONSTRAINT "DashboardBusinessEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardDataRelationship" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL,
    "fieldMappings" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,

    CONSTRAINT "DashboardDataRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardMetricComponent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricId" TEXT NOT NULL,

    CONSTRAINT "DashboardMetricComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardMetricResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "value" DECIMAL(30,10),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lineage" JSONB NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,

    CONSTRAINT "DashboardMetricResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewId" TEXT NOT NULL,

    CONSTRAINT "DashboardPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageId" TEXT NOT NULL,
    "metricId" TEXT,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSavedView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "layout" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewId" TEXT NOT NULL,

    CONSTRAINT "DashboardSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardTarget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(30,10) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricId" TEXT NOT NULL,

    CONSTRAINT "DashboardTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardAlertRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricId" TEXT NOT NULL,
    "targetId" TEXT,

    CONSTRAINT "DashboardAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardAlertEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "observedValue" DECIMAL(30,10) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,

    CONSTRAINT "DashboardAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardRefreshExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT NOT NULL,
    "jobId" TEXT,
    "scheduleId" TEXT,

    CONSTRAINT "DashboardRefreshExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardReportDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewId" TEXT,

    CONSTRAINT "DashboardReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardReportSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "recipients" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportId" TEXT NOT NULL,

    CONSTRAINT "DashboardReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardReportExport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "checksum" TEXT,
    "fileSize" BIGINT,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportId" TEXT NOT NULL,

    CONSTRAINT "DashboardReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardReportDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportId" TEXT NOT NULL,
    "scheduleId" TEXT,

    CONSTRAINT "DashboardReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardShare" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'VIEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewId" TEXT NOT NULL,

    CONSTRAINT "DashboardShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardAccessGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shareId" TEXT NOT NULL,

    CONSTRAINT "DashboardAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardAuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorIssuer" TEXT NOT NULL,
    "actorSubject" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardBillingPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entitlements" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardBillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardBillingCustomer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardBillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardInvoice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalInvoiceId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "DashboardInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardConnectorConfiguration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "scopes" TEXT[],
    "cursor" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "DashboardConnectorConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardCredentialReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "secretReference" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectorId" TEXT NOT NULL,

    CONSTRAINT "DashboardCredentialReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWebhookRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectorId" TEXT NOT NULL,

    CONSTRAINT "DashboardWebhookRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardOperationalEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardOperationalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSupportCase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "details" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardConfiguration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardExternalIdentity_userId_idx" ON "DashboardExternalIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardExternalIdentity_issuer_subject_key" ON "DashboardExternalIdentity"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardOrganizationMember_organizationId_userId_key" ON "DashboardOrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardOrganizationInvitation_tokenHash_key" ON "DashboardOrganizationInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "DashboardOrganizationInvitation_organizationId_expiresAt_idx" ON "DashboardOrganizationInvitation"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWorkspaceRole_workspaceId_key_key" ON "DashboardWorkspaceRole"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWorkspaceRole_id_workspaceId_key" ON "DashboardWorkspaceRole"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardPermissionGrant_roleId_idx" ON "DashboardPermissionGrant"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPermissionGrant_workspaceId_userId_roleId_key" ON "DashboardPermissionGrant"("workspaceId", "userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPermissionGrant_id_workspaceId_key" ON "DashboardPermissionGrant"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardDatasetSchema_datasetId_idx" ON "DashboardDatasetSchema"("datasetId");

-- CreateIndex
CREATE INDEX "DashboardDatasetSchema_workspaceId_datasetId_idx" ON "DashboardDatasetSchema"("workspaceId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardDatasetSchema_versionId_key" ON "DashboardDatasetSchema"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardDatasetSchema_id_workspaceId_key" ON "DashboardDatasetSchema"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardDatasetSnapshot_datasetId_idx" ON "DashboardDatasetSnapshot"("datasetId");

-- CreateIndex
CREATE INDEX "DashboardDatasetSnapshot_workspaceId_datasetId_idx" ON "DashboardDatasetSnapshot"("workspaceId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardDatasetSnapshot_workspaceId_storageKey_key" ON "DashboardDatasetSnapshot"("workspaceId", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardDatasetSnapshot_id_workspaceId_key" ON "DashboardDatasetSnapshot"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardQualityCheck_datasetId_idx" ON "DashboardQualityCheck"("datasetId");

-- CreateIndex
CREATE INDEX "DashboardQualityCheck_workspaceId_datasetId_idx" ON "DashboardQualityCheck"("workspaceId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardQualityCheck_id_workspaceId_key" ON "DashboardQualityCheck"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardQualityIssue_checkId_idx" ON "DashboardQualityIssue"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardQualityIssue_id_workspaceId_key" ON "DashboardQualityIssue"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardBusinessEntity_datasetId_idx" ON "DashboardBusinessEntity"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBusinessEntity_workspaceId_datasetId_key_key" ON "DashboardBusinessEntity"("workspaceId", "datasetId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBusinessEntity_id_workspaceId_key" ON "DashboardBusinessEntity"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardDataRelationship_fromEntityId_idx" ON "DashboardDataRelationship"("fromEntityId");

-- CreateIndex
CREATE INDEX "DashboardDataRelationship_toEntityId_idx" ON "DashboardDataRelationship"("toEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardDataRelationship_id_workspaceId_key" ON "DashboardDataRelationship"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardMetricComponent_metricId_idx" ON "DashboardMetricComponent"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMetricComponent_metricId_key_key" ON "DashboardMetricComponent"("metricId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMetricComponent_id_workspaceId_key" ON "DashboardMetricComponent"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardMetricResult_datasetId_idx" ON "DashboardMetricResult"("datasetId");

-- CreateIndex
CREATE INDEX "DashboardMetricResult_workspaceId_datasetId_idx" ON "DashboardMetricResult"("workspaceId", "datasetId");

-- CreateIndex
CREATE INDEX "DashboardMetricResult_metricId_idx" ON "DashboardMetricResult"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMetricResult_metricId_versionId_periodStart_period_key" ON "DashboardMetricResult"("metricId", "versionId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMetricResult_id_workspaceId_key" ON "DashboardMetricResult"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardPage_viewId_idx" ON "DashboardPage"("viewId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPage_viewId_position_key" ON "DashboardPage"("viewId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPage_id_workspaceId_key" ON "DashboardPage"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardWidget_pageId_idx" ON "DashboardWidget"("pageId");

-- CreateIndex
CREATE INDEX "DashboardWidget_metricId_idx" ON "DashboardWidget"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWidget_pageId_position_key" ON "DashboardWidget"("pageId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWidget_id_workspaceId_key" ON "DashboardWidget"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardSavedView_viewId_idx" ON "DashboardSavedView"("viewId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSavedView_id_workspaceId_key" ON "DashboardSavedView"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardTarget_metricId_idx" ON "DashboardTarget"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardTarget_id_workspaceId_key" ON "DashboardTarget"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardAlertRule_metricId_idx" ON "DashboardAlertRule"("metricId");

-- CreateIndex
CREATE INDEX "DashboardAlertRule_targetId_idx" ON "DashboardAlertRule"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAlertRule_id_workspaceId_key" ON "DashboardAlertRule"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardAlertEvent_ruleId_idx" ON "DashboardAlertEvent"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAlertEvent_ruleId_eventKey_key" ON "DashboardAlertEvent"("ruleId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAlertEvent_id_workspaceId_key" ON "DashboardAlertEvent"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardRefreshExecution_workspaceId_createdAt_idx" ON "DashboardRefreshExecution"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DashboardRefreshExecution_sourceId_idx" ON "DashboardRefreshExecution"("sourceId");

-- CreateIndex
CREATE INDEX "DashboardRefreshExecution_jobId_idx" ON "DashboardRefreshExecution"("jobId");

-- CreateIndex
CREATE INDEX "DashboardRefreshExecution_scheduleId_idx" ON "DashboardRefreshExecution"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardRefreshExecution_id_workspaceId_key" ON "DashboardRefreshExecution"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardReportDefinition_viewId_idx" ON "DashboardReportDefinition"("viewId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardReportDefinition_id_workspaceId_key" ON "DashboardReportDefinition"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardReportSchedule_enabled_nextRunAt_idx" ON "DashboardReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "DashboardReportSchedule_reportId_idx" ON "DashboardReportSchedule"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardReportSchedule_id_workspaceId_key" ON "DashboardReportSchedule"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardReportExport_workspaceId_expiresAt_idx" ON "DashboardReportExport"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "DashboardReportExport_reportId_idx" ON "DashboardReportExport"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardReportExport_id_workspaceId_key" ON "DashboardReportExport"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardReportDelivery_status_availableAt_idx" ON "DashboardReportDelivery"("status", "availableAt");

-- CreateIndex
CREATE INDEX "DashboardReportDelivery_exportId_idx" ON "DashboardReportDelivery"("exportId");

-- CreateIndex
CREATE INDEX "DashboardReportDelivery_scheduleId_idx" ON "DashboardReportDelivery"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardReportDelivery_workspaceId_idempotencyKey_key" ON "DashboardReportDelivery"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardReportDelivery_id_workspaceId_key" ON "DashboardReportDelivery"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardShare_tokenHash_key" ON "DashboardShare"("tokenHash");

-- CreateIndex
CREATE INDEX "DashboardShare_workspaceId_expiresAt_idx" ON "DashboardShare"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "DashboardShare_viewId_idx" ON "DashboardShare"("viewId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardShare_id_workspaceId_key" ON "DashboardShare"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardAccessGrant_shareId_idx" ON "DashboardAccessGrant"("shareId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAccessGrant_shareId_userId_key" ON "DashboardAccessGrant"("shareId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAccessGrant_id_workspaceId_key" ON "DashboardAccessGrant"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardAuditEvent_workspaceId_createdAt_idx" ON "DashboardAuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAuditEvent_id_workspaceId_key" ON "DashboardAuditEvent"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingPlan_code_key" ON "DashboardBillingPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingCustomer_provider_externalCustomerId_key" ON "DashboardBillingCustomer"("provider", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingCustomer_workspaceId_provider_key" ON "DashboardBillingCustomer"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingCustomer_id_workspaceId_key" ON "DashboardBillingCustomer"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardInvoice_subscriptionId_idx" ON "DashboardInvoice"("subscriptionId");

-- CreateIndex
CREATE INDEX "DashboardInvoice_customerId_idx" ON "DashboardInvoice"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardInvoice_provider_externalInvoiceId_key" ON "DashboardInvoice"("provider", "externalInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardInvoice_id_workspaceId_key" ON "DashboardInvoice"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardConnectorConfiguration_sourceId_idx" ON "DashboardConnectorConfiguration"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardConnectorConfiguration_sourceId_key" ON "DashboardConnectorConfiguration"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardConnectorConfiguration_id_workspaceId_key" ON "DashboardConnectorConfiguration"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardCredentialReference_connectorId_idx" ON "DashboardCredentialReference"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardCredentialReference_connectorId_purpose_key" ON "DashboardCredentialReference"("connectorId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardCredentialReference_id_workspaceId_key" ON "DashboardCredentialReference"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardWebhookRecord_status_createdAt_idx" ON "DashboardWebhookRecord"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DashboardWebhookRecord_connectorId_idx" ON "DashboardWebhookRecord"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWebhookRecord_connectorId_externalEventId_key" ON "DashboardWebhookRecord"("connectorId", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWebhookRecord_id_workspaceId_key" ON "DashboardWebhookRecord"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardOperationalEvent_workspaceId_createdAt_idx" ON "DashboardOperationalEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardOperationalEvent_id_workspaceId_key" ON "DashboardOperationalEvent"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardSupportCase_workspaceId_status_updatedAt_idx" ON "DashboardSupportCase"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSupportCase_id_workspaceId_key" ON "DashboardSupportCase"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardConfiguration_key_key" ON "DashboardConfiguration"("key");

-- CreateIndex
CREATE INDEX "DashboardWorkspace_organizationId_idx" ON "DashboardWorkspace"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardDatasetVersion_id_datasetId_key" ON "DashboardDatasetVersion"("id", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardView_id_workspaceId_key" ON "DashboardView"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMetricDefinition_id_workspaceId_key" ON "DashboardMetricDefinition"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardJob_id_workspaceId_key" ON "DashboardJob"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSubscription_id_workspaceId_key" ON "DashboardSubscription"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardJobSchedule_id_workspaceId_key" ON "DashboardJobSchedule"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "DashboardWorkspace" ADD CONSTRAINT "DashboardWorkspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "DashboardOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDataset" ADD CONSTRAINT "DashboardDataset_activeVersionId_id_fkey" FOREIGN KEY ("activeVersionId", "id") REFERENCES "DashboardDatasetVersion"("id", "datasetId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DashboardSubscription" ADD CONSTRAINT "DashboardSubscription_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "DashboardBillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardExternalIdentity" ADD CONSTRAINT "DashboardExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardOrganizationMember" ADD CONSTRAINT "DashboardOrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "DashboardOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardOrganizationMember" ADD CONSTRAINT "DashboardOrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardOrganizationInvitation" ADD CONSTRAINT "DashboardOrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "DashboardOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardOrganizationInvitation" ADD CONSTRAINT "DashboardOrganizationInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWorkspaceRole" ADD CONSTRAINT "DashboardWorkspaceRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardPermissionGrant" ADD CONSTRAINT "DashboardPermissionGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardPermissionGrant" ADD CONSTRAINT "DashboardPermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardPermissionGrant" ADD CONSTRAINT "DashboardPermissionGrant_roleId_workspaceId_fkey" FOREIGN KEY ("roleId", "workspaceId") REFERENCES "DashboardWorkspaceRole"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDatasetSchema" ADD CONSTRAINT "DashboardDatasetSchema_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDatasetSchema" ADD CONSTRAINT "DashboardDatasetSchema_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDatasetSchema" ADD CONSTRAINT "DashboardDatasetSchema_versionId_datasetId_fkey" FOREIGN KEY ("versionId", "datasetId") REFERENCES "DashboardDatasetVersion"("id", "datasetId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDatasetSnapshot" ADD CONSTRAINT "DashboardDatasetSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDatasetSnapshot" ADD CONSTRAINT "DashboardDatasetSnapshot_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDatasetSnapshot" ADD CONSTRAINT "DashboardDatasetSnapshot_versionId_datasetId_fkey" FOREIGN KEY ("versionId", "datasetId") REFERENCES "DashboardDatasetVersion"("id", "datasetId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardQualityCheck" ADD CONSTRAINT "DashboardQualityCheck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardQualityCheck" ADD CONSTRAINT "DashboardQualityCheck_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardQualityCheck" ADD CONSTRAINT "DashboardQualityCheck_versionId_datasetId_fkey" FOREIGN KEY ("versionId", "datasetId") REFERENCES "DashboardDatasetVersion"("id", "datasetId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardQualityIssue" ADD CONSTRAINT "DashboardQualityIssue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardQualityIssue" ADD CONSTRAINT "DashboardQualityIssue_checkId_workspaceId_fkey" FOREIGN KEY ("checkId", "workspaceId") REFERENCES "DashboardQualityCheck"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardBusinessEntity" ADD CONSTRAINT "DashboardBusinessEntity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardBusinessEntity" ADD CONSTRAINT "DashboardBusinessEntity_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDataRelationship" ADD CONSTRAINT "DashboardDataRelationship_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDataRelationship" ADD CONSTRAINT "DashboardDataRelationship_fromEntityId_workspaceId_fkey" FOREIGN KEY ("fromEntityId", "workspaceId") REFERENCES "DashboardBusinessEntity"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDataRelationship" ADD CONSTRAINT "DashboardDataRelationship_toEntityId_workspaceId_fkey" FOREIGN KEY ("toEntityId", "workspaceId") REFERENCES "DashboardBusinessEntity"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardMetricComponent" ADD CONSTRAINT "DashboardMetricComponent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardMetricComponent" ADD CONSTRAINT "DashboardMetricComponent_metricId_workspaceId_fkey" FOREIGN KEY ("metricId", "workspaceId") REFERENCES "DashboardMetricDefinition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardMetricResult" ADD CONSTRAINT "DashboardMetricResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardMetricResult" ADD CONSTRAINT "DashboardMetricResult_datasetId_workspaceId_fkey" FOREIGN KEY ("datasetId", "workspaceId") REFERENCES "DashboardDataset"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardMetricResult" ADD CONSTRAINT "DashboardMetricResult_versionId_datasetId_fkey" FOREIGN KEY ("versionId", "datasetId") REFERENCES "DashboardDatasetVersion"("id", "datasetId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardMetricResult" ADD CONSTRAINT "DashboardMetricResult_metricId_workspaceId_fkey" FOREIGN KEY ("metricId", "workspaceId") REFERENCES "DashboardMetricDefinition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardPage" ADD CONSTRAINT "DashboardPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardPage" ADD CONSTRAINT "DashboardPage_viewId_workspaceId_fkey" FOREIGN KEY ("viewId", "workspaceId") REFERENCES "DashboardView"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_pageId_workspaceId_fkey" FOREIGN KEY ("pageId", "workspaceId") REFERENCES "DashboardPage"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_metricId_workspaceId_fkey" FOREIGN KEY ("metricId", "workspaceId") REFERENCES "DashboardMetricDefinition"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSavedView" ADD CONSTRAINT "DashboardSavedView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSavedView" ADD CONSTRAINT "DashboardSavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSavedView" ADD CONSTRAINT "DashboardSavedView_viewId_workspaceId_fkey" FOREIGN KEY ("viewId", "workspaceId") REFERENCES "DashboardView"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardTarget" ADD CONSTRAINT "DashboardTarget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardTarget" ADD CONSTRAINT "DashboardTarget_metricId_workspaceId_fkey" FOREIGN KEY ("metricId", "workspaceId") REFERENCES "DashboardMetricDefinition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAlertRule" ADD CONSTRAINT "DashboardAlertRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAlertRule" ADD CONSTRAINT "DashboardAlertRule_metricId_workspaceId_fkey" FOREIGN KEY ("metricId", "workspaceId") REFERENCES "DashboardMetricDefinition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAlertRule" ADD CONSTRAINT "DashboardAlertRule_targetId_workspaceId_fkey" FOREIGN KEY ("targetId", "workspaceId") REFERENCES "DashboardTarget"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAlertEvent" ADD CONSTRAINT "DashboardAlertEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAlertEvent" ADD CONSTRAINT "DashboardAlertEvent_ruleId_workspaceId_fkey" FOREIGN KEY ("ruleId", "workspaceId") REFERENCES "DashboardAlertRule"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardRefreshExecution" ADD CONSTRAINT "DashboardRefreshExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardRefreshExecution" ADD CONSTRAINT "DashboardRefreshExecution_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId", "workspaceId") REFERENCES "DashboardDataSource"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardRefreshExecution" ADD CONSTRAINT "DashboardRefreshExecution_jobId_workspaceId_fkey" FOREIGN KEY ("jobId", "workspaceId") REFERENCES "DashboardJob"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardRefreshExecution" ADD CONSTRAINT "DashboardRefreshExecution_scheduleId_workspaceId_fkey" FOREIGN KEY ("scheduleId", "workspaceId") REFERENCES "DashboardJobSchedule"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportDefinition" ADD CONSTRAINT "DashboardReportDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportDefinition" ADD CONSTRAINT "DashboardReportDefinition_viewId_workspaceId_fkey" FOREIGN KEY ("viewId", "workspaceId") REFERENCES "DashboardView"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportSchedule" ADD CONSTRAINT "DashboardReportSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportSchedule" ADD CONSTRAINT "DashboardReportSchedule_reportId_workspaceId_fkey" FOREIGN KEY ("reportId", "workspaceId") REFERENCES "DashboardReportDefinition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportExport" ADD CONSTRAINT "DashboardReportExport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportExport" ADD CONSTRAINT "DashboardReportExport_reportId_workspaceId_fkey" FOREIGN KEY ("reportId", "workspaceId") REFERENCES "DashboardReportDefinition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportDelivery" ADD CONSTRAINT "DashboardReportDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportDelivery" ADD CONSTRAINT "DashboardReportDelivery_exportId_workspaceId_fkey" FOREIGN KEY ("exportId", "workspaceId") REFERENCES "DashboardReportExport"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardReportDelivery" ADD CONSTRAINT "DashboardReportDelivery_scheduleId_workspaceId_fkey" FOREIGN KEY ("scheduleId", "workspaceId") REFERENCES "DashboardReportSchedule"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardShare" ADD CONSTRAINT "DashboardShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardShare" ADD CONSTRAINT "DashboardShare_viewId_workspaceId_fkey" FOREIGN KEY ("viewId", "workspaceId") REFERENCES "DashboardView"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAccessGrant" ADD CONSTRAINT "DashboardAccessGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAccessGrant" ADD CONSTRAINT "DashboardAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAccessGrant" ADD CONSTRAINT "DashboardAccessGrant_shareId_workspaceId_fkey" FOREIGN KEY ("shareId", "workspaceId") REFERENCES "DashboardShare"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAuditEvent" ADD CONSTRAINT "DashboardAuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardBillingCustomer" ADD CONSTRAINT "DashboardBillingCustomer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardInvoice" ADD CONSTRAINT "DashboardInvoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardInvoice" ADD CONSTRAINT "DashboardInvoice_subscriptionId_workspaceId_fkey" FOREIGN KEY ("subscriptionId", "workspaceId") REFERENCES "DashboardSubscription"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardInvoice" ADD CONSTRAINT "DashboardInvoice_customerId_workspaceId_fkey" FOREIGN KEY ("customerId", "workspaceId") REFERENCES "DashboardBillingCustomer"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardConnectorConfiguration" ADD CONSTRAINT "DashboardConnectorConfiguration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardConnectorConfiguration" ADD CONSTRAINT "DashboardConnectorConfiguration_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId", "workspaceId") REFERENCES "DashboardDataSource"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardCredentialReference" ADD CONSTRAINT "DashboardCredentialReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardCredentialReference" ADD CONSTRAINT "DashboardCredentialReference_connectorId_workspaceId_fkey" FOREIGN KEY ("connectorId", "workspaceId") REFERENCES "DashboardConnectorConfiguration"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWebhookRecord" ADD CONSTRAINT "DashboardWebhookRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWebhookRecord" ADD CONSTRAINT "DashboardWebhookRecord_connectorId_workspaceId_fkey" FOREIGN KEY ("connectorId", "workspaceId") REFERENCES "DashboardConnectorConfiguration"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardOperationalEvent" ADD CONSTRAINT "DashboardOperationalEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSupportCase" ADD CONSTRAINT "DashboardSupportCase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSupportCase" ADD CONSTRAINT "DashboardSupportCase_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "DashboardUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "DashboardDatasetVersion" ADD CONSTRAINT "DashboardDatasetVersion_valid_values" CHECK ("version" > 0 AND "fileSize" >= 0 AND ("rowCount" IS NULL OR "rowCount" >= 0));

ALTER TABLE "DashboardDatasetSnapshot" ADD CONSTRAINT "DashboardDatasetSnapshot_valid_values" CHECK ("fileSize" >= 0 AND "rowCount" >= 0);

ALTER TABLE "DashboardPage" ADD CONSTRAINT "DashboardPage_valid_values" CHECK ("position" >= 0);

ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_valid_values" CHECK ("position" >= 0);

ALTER TABLE "DashboardMetricResult" ADD CONSTRAINT "DashboardMetricResult_valid_values" CHECK ("periodEnd" > "periodStart" AND (("status" = 'READY' AND "value" IS NOT NULL) OR ("status" <> 'READY' AND "value" IS NULL)));

ALTER TABLE "DashboardTarget" ADD CONSTRAINT "DashboardTarget_valid_values" CHECK ("periodEnd" > "periodStart");

ALTER TABLE "DashboardReportSchedule" ADD CONSTRAINT "DashboardReportSchedule_valid_values" CHECK ("intervalSeconds" >= 60);

ALTER TABLE "DashboardReportDelivery" ADD CONSTRAINT "DashboardReportDelivery_valid_values" CHECK ("attempts" >= 0);

ALTER TABLE "DashboardReportExport" ADD CONSTRAINT "DashboardReportExport_valid_values" CHECK (("fileSize" IS NULL OR "fileSize" >= 0) AND ("status" <> 'READY' OR ("storageKey" IS NOT NULL AND "checksum" IS NOT NULL AND "fileSize" IS NOT NULL AND "completedAt" IS NOT NULL)));

ALTER TABLE "DashboardInvoice" ADD CONSTRAINT "DashboardInvoice_valid_values" CHECK ("periodEnd" > "periodStart" AND "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "DashboardQualityIssue" ADD CONSTRAINT "DashboardQualityIssue_valid_values" CHECK ("rowNumber" IS NULL OR "rowNumber" > 0);

COMMIT;
