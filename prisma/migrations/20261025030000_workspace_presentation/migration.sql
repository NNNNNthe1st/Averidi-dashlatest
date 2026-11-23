-- Explicit preferences are optional for existing workspaces. Never rewrite dataset rules.
ALTER TABLE "DashboardWorkspace" ADD COLUMN "presentation" JSONB,
 ADD COLUMN "presentationRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DashboardWorkspace" ADD CONSTRAINT "DashboardWorkspace_presentation_revision_check"
 CHECK ("presentationRevision" >= 0);
