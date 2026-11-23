ALTER TABLE "DashboardUser" ADD COLUMN "email" TEXT, ADD COLUMN "passwordHash" TEXT, ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "DashboardUser_email_key" ON "DashboardUser"("email");
CREATE TABLE "DashboardCredentialToken"("id" TEXT NOT NULL,"userId" TEXT NOT NULL,"kind" TEXT NOT NULL,"tokenHash" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"consumedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "DashboardCredentialToken_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "DashboardCredentialToken_tokenHash_key" ON "DashboardCredentialToken"("tokenHash");
CREATE INDEX "DashboardCredentialToken_userId_kind_expiresAt_idx" ON "DashboardCredentialToken"("userId","kind","expiresAt");
ALTER TABLE "DashboardCredentialToken" ADD CONSTRAINT "DashboardCredentialToken_userId_fkey" FOREIGN KEY("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
