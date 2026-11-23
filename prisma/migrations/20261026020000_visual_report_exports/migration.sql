ALTER TABLE "DashboardReportExport" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'CSV';
ALTER TABLE "DashboardReportExport" ADD CONSTRAINT "DashboardReportExport_format_check" CHECK ("format" IN ('CSV','PDF','PNG'));
