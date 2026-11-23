import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  dashboardStorageKey,
  dashboardWorkspaceArtifactKey,
  dashboardStoragePath,
  readDashboardObject,
  writeDashboardObject,
} from "../src/server/storage";

test("standalone storage rejects traversal and cannot overwrite immutable versions", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "averidi-dashboard-storage-"));
  const previous = process.env.DASHBOARD_STORAGE_ROOT;
  process.env.DASHBOARD_STORAGE_ROOT = base;
  try {
    assert.throws(() => dashboardStoragePath("../secret"));
    assert.throws(() => dashboardStoragePath("datasets//wrong"));
    assert.throws(() => dashboardStoragePath("website/uploads/file.bin"));
    assert.throws(() => dashboardStoragePath("reports/work/file.txt"));
    assert.throws(() => dashboardStoragePath("exports/work/../report.bin"));
    assert.throws(() => dashboardStorageKey("../escape", "dataset", "version"));
    assert.equal(dashboardStorageKey("workspace", "dataset", "v1"),"uploads/workspace/dataset/v1/source.bin");
    const key = dashboardStorageKey("workspace", "dataset", "v1");
    await writeDashboardObject(key, Buffer.from("original"));
    assert.equal((await readDashboardObject(key)).toString(), "original");
    await assert.rejects(() => writeDashboardObject(key, Buffer.from("replacement")), { code: "EEXIST" });
    assert.equal((await readDashboardObject(key)).toString(), "original");
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_STORAGE_ROOT;
    else process.env.DASHBOARD_STORAGE_ROOT = previous;
    await rm(base, { recursive: true, force: true });
  }
});

test("standalone storage rejects a symlink as the data object", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "averidi-dashboard-link-"));
  const previous = process.env.DASHBOARD_STORAGE_ROOT;
  process.env.DASHBOARD_STORAGE_ROOT = base;
  try {
    const key = dashboardStorageKey("workspace", "dataset", "v2");
    const target = dashboardStoragePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(path.join(base, "not-the-object"), target);
    await assert.rejects(() => readDashboardObject(key));
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_STORAGE_ROOT;
    else process.env.DASHBOARD_STORAGE_ROOT = previous;
    await rm(base, { recursive: true, force: true });
  }
});

test("standalone storage refuses symlinked root outside isolated directory", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "dashboard-isolation-"));
  const linkRoot = path.join(base,"dashboard-link");
  const realRoot = path.join(base,"outside");
  const previous = process.env.DASHBOARD_STORAGE_ROOT;
  try {
    await mkdir(realRoot);
    await symlink(realRoot,linkRoot);
    process.env.DASHBOARD_STORAGE_ROOT=linkRoot;
    await assert.rejects(()=>writeDashboardObject(dashboardStorageKey("w","d","v"),Buffer.from("secret")),/symlink/);
  } finally {
    if(previous===undefined) delete process.env.DASHBOARD_STORAGE_ROOT;
    else process.env.DASHBOARD_STORAGE_ROOT=previous;
    await rm(base,{recursive:true,force:true});
  }
});

test("workspace artifacts use dedicated categories and reject traversal",()=>{
  assert.equal(dashboardWorkspaceArtifactKey("reports","work_a","report_1"),"reports/work_a/report_1.bin");
  assert.equal(dashboardWorkspaceArtifactKey("exports","work_a","export_1"),"exports/work_a/export_1.bin");
  assert.throws(()=>dashboardWorkspaceArtifactKey("reports","../escape","file"));
  assert.throws(()=>dashboardWorkspaceArtifactKey("other" as "reports","work","file"));
});

test("temporary objects can be cleaned without deleting retained artifacts",async()=>{
 const base=await mkdtemp(path.join(tmpdir(),"dashboard-cleanup-"));
 const old=process.env.DASHBOARD_STORAGE_ROOT;
 process.env.DASHBOARD_STORAGE_ROOT=base;
 try{
  const {deleteDashboardTemporaryObject}=await import('../src/server/storage');
  const temporary=dashboardWorkspaceArtifactKey('temporary','workspace','fixture');
  await writeDashboardObject(temporary,Buffer.from('temporary'));
  await deleteDashboardTemporaryObject(temporary);
  await assert.rejects(()=>readDashboardObject(temporary));
  const retained=dashboardWorkspaceArtifactKey('reports','workspace','retained');
  await writeDashboardObject(retained,Buffer.from('retain'));
  await assert.rejects(()=>deleteDashboardTemporaryObject(retained),/Only temporary/);
  assert.equal((await readDashboardObject(retained)).toString(),'retain');
 }finally{
  if(old===undefined)delete process.env.DASHBOARD_STORAGE_ROOT;else process.env.DASHBOARD_STORAGE_ROOT=old;
  await rm(base,{recursive:true,force:true});
 }
});

test('storage rejects symlink redirection into a different workspace inside its own root',async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'dashboard-tenant-link-'));
 const old=process.env.DASHBOARD_STORAGE_ROOT;process.env.DASHBOARD_STORAGE_ROOT=base;
 try{
  await writeDashboardObject(dashboardWorkspaceArtifactKey('reports','victim','report'),Buffer.from('private'));
  await symlink(path.join(base,'reports','victim'),path.join(base,'reports','attacker'));
  await assert.rejects(()=>readDashboardObject('reports/attacker/report.bin'));
  await assert.rejects(()=>writeDashboardObject('reports/attacker/another.bin',Buffer.from('bad')));
 }finally{
  if(old===undefined)delete process.env.DASHBOARD_STORAGE_ROOT;else process.env.DASHBOARD_STORAGE_ROOT=old;
  await rm(base,{recursive:true,force:true});
 }
});
