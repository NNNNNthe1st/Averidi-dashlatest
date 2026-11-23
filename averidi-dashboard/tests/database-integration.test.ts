import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dashboardDb } from "../src/server/db";

test("independent Dashboard database: migrated tables, tenant relationships and rollback", async () => {
  const expected = new URL(process.env.DASHBOARD_DATABASE_URL!).pathname.slice(1);
  const rows = await dashboardDb.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
  assert.equal(rows[0]?.database, expected);
  const id = randomUUID();
  // A transaction that intentionally fails verifies the database can write and roll back
  // without leaving test users, workspaces or memberships behind.
  await assert.rejects(
    dashboardDb.$transaction(async tx => {
      await tx.dashboardUser.create({data:{id, externalSubject:"test|"+id}});
      await tx.dashboardWorkspace.create({data:{id,name:"Dashboard database smoke test"}});
      await tx.dashboardMembership.create({data:{id,userId:id,workspaceId:id,role:"OWNER"}});
      const membership = await tx.dashboardMembership.findUnique({
        where:{userId_workspaceId:{userId:id,workspaceId:id}}
      });
      assert.equal(membership?.role,"OWNER");
      throw new Error("ROLLBACK_EXPECTED");
    }),
    /ROLLBACK_EXPECTED/
  );
  assert.equal(await dashboardDb.dashboardUser.count({where:{id}}),0);
  assert.equal(await dashboardDb.dashboardWorkspace.count({where:{id}}),0);
  assert.equal(await dashboardDb.dashboardMembership.count({where:{id}}),0);
});
