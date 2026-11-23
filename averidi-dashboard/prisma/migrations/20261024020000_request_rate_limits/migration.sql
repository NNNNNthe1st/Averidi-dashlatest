CREATE TABLE "DashboardRequestBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DashboardRequestBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "DashboardRequestBucket_expiresAt_idx" ON "DashboardRequestBucket"("expiresAt");
