ALTER TABLE "DashboardTarget" ADD COLUMN "direction" TEXT, ADD COLUMN "pacing" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "DashboardTarget" ADD CONSTRAINT "DashboardTarget_direction_check" CHECK ("direction" IS NULL OR "direction" IN ('HIGHER','LOWER'));
ALTER TABLE "DashboardTarget" ADD CONSTRAINT "DashboardTarget_pacing_check" CHECK ("pacing" IN ('NONE','LINEAR') AND ("pacing" <> 'LINEAR' OR ("direction" IS NOT NULL AND value > 0)));
