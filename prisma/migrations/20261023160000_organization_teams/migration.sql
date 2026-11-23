-- AlterTable
ALTER TABLE "DashboardUser" ADD COLUMN     "displayName" TEXT;

-- CreateTable
CREATE TABLE "DashboardTeam" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardTeamMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DashboardTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardOrganizationAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorIssuer" TEXT NOT NULL,
    "actorSubject" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardOrganizationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardTeam_workspaceId_createdAt_idx" ON "DashboardTeam"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardTeam_id_workspaceId_key" ON "DashboardTeam"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardTeamMember_userId_workspaceId_idx" ON "DashboardTeamMember"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardTeamMember_teamId_userId_key" ON "DashboardTeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "DashboardOrganizationAuditEvent_organizationId_createdAt_idx" ON "DashboardOrganizationAuditEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "DashboardTeam" ADD CONSTRAINT "DashboardTeam_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardTeamMember" ADD CONSTRAINT "DashboardTeamMember_teamId_workspaceId_fkey" FOREIGN KEY ("teamId", "workspaceId") REFERENCES "DashboardTeam"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardTeamMember" ADD CONSTRAINT "DashboardTeamMember_userId_workspaceId_fkey" FOREIGN KEY ("userId", "workspaceId") REFERENCES "DashboardMembership"("userId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardOrganizationAuditEvent" ADD CONSTRAINT "DashboardOrganizationAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "DashboardOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

