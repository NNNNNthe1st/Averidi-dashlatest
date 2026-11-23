import { test } from "node:test";
import assert from "node:assert/strict";
import { requireDashboardDatabaseUrl, requireDashboardStorageRoot } from "../src/server/data-boundary";

test("Dashboard rejects website and Analyst database names",()=>{
  for(const database of ["averidi_dev","averidi","analyst","sales_solutions","postgres"]){
    assert.throws(()=>requireDashboardDatabaseUrl("postgresql://user:pass@localhost:5432/"+database));
  }
});
test("Dashboard accepts separately named PostgreSQL database",()=>{
  const url="postgresql://dashboard:secret@127.0.0.1:5434/dashboard_dev";
  assert.equal(requireDashboardDatabaseUrl(url),url);
  assert.throws(()=>requireDashboardDatabaseUrl("sqlite:///dashboard.db"));
});
test("Dashboard storage rejects unconfigured or filesystem-root values",()=>{
  assert.throws(()=>requireDashboardStorageRoot(undefined));
  assert.throws(()=>requireDashboardStorageRoot("/"));
});

test("Dashboard rejects credentials that cannot establish a dedicated database connection",()=>{
 for(const url of [
  "postgresql://dashboard@localhost:5432/dashboard_dev",
  "postgresql://localhost:5432/dashboard_dev",
  "postgresql://dashboard:secret@localhost:5432/postgres",
  "postgresql://dashboard:secret@localhost:5432/dashboard_dev#fragment",
  "postgresql://dashboard:secret@localhost:5432/%ZZ"
 ])assert.throws(()=>requireDashboardDatabaseUrl(url));
});
