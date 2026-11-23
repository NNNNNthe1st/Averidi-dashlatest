-- AlterTable
ALTER TABLE "DashboardSubscription" ADD COLUMN     "accessSuspended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DashboardBillingPlan" ADD COLUMN     "amountMinor" INTEGER,
ADD COLUMN     "billingInterval" TEXT,
ADD COLUMN     "currency" CHAR(3),
ADD COLUMN     "externalPriceId" TEXT;

-- CreateTable
CREATE TABLE "DashboardBillingBinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalSubscriptionId" TEXT NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardBillingBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardBillingEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "workspaceId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardBillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingBinding_workspaceId_key" ON "DashboardBillingBinding"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingBinding_customerId_key" ON "DashboardBillingBinding"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingBinding_externalSubscriptionId_key" ON "DashboardBillingBinding"("externalSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingBinding_customerId_workspaceId_key" ON "DashboardBillingBinding"("customerId", "workspaceId");

-- CreateIndex
CREATE INDEX "DashboardBillingEvent_workspaceId_createdAt_idx" ON "DashboardBillingEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardBillingPlan_externalPriceId_key" ON "DashboardBillingPlan"("externalPriceId");

-- AddForeignKey
ALTER TABLE "DashboardBillingBinding" ADD CONSTRAINT "DashboardBillingBinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "DashboardWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardBillingBinding" ADD CONSTRAINT "DashboardBillingBinding_customerId_workspaceId_fkey" FOREIGN KEY ("customerId", "workspaceId") REFERENCES "DashboardBillingCustomer"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Complete mappings only; legacy unmapped plans remain valid and inactive by default.
ALTER TABLE "DashboardBillingPlan" ADD CONSTRAINT "DashboardBillingPlan_price_mapping_check" CHECK (
 ("externalPriceId" IS NULL AND "currency" IS NULL AND "amountMinor" IS NULL AND "billingInterval" IS NULL) OR
 ("externalPriceId" IS NOT NULL AND "currency" IS NOT NULL AND "amountMinor" IS NOT NULL AND "billingInterval" IS NOT NULL AND
 "externalPriceId" ~ '^price_[A-Za-z0-9]{1,100}$' AND "currency" ~ '^[A-Z]{3}$' AND "amountMinor">=0 AND "billingInterval" IN ('month','year'))
);
ALTER TABLE "DashboardBillingBinding" ADD CONSTRAINT "DashboardBillingBinding_resource_check" CHECK ("externalSubscriptionId" ~ '^sub_[A-Za-z0-9]{1,100}$');
ALTER TABLE "DashboardBillingEvent" ADD CONSTRAINT "DashboardBillingEvent_receipt_check" CHECK (id ~ '^evt_[A-Za-z0-9]{1,100}$' AND "payloadDigest" ~ '^[a-f0-9]{64}$' AND outcome IN ('APPLIED','IGNORED'));
