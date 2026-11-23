-- Keep queued-job availability in the same UTC wall-clock convention used by worker claims.
ALTER TABLE "DashboardJob"
  ALTER COLUMN "availableAt"
  SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text);
