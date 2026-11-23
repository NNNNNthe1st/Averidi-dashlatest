import { PrismaClient } from "@prisma/client";
import { requireDashboardDatabaseUrl } from "./data-boundary";

// Only the standalone Dashboard database URL may be used here.
const databaseUrl = requireDashboardDatabaseUrl(process.env.DASHBOARD_DATABASE_URL);
export const dashboardDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
