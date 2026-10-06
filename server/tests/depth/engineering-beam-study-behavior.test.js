// engineering.beamStudy — the ConKay workspace's I-beam study through the
// real lens.run path: solves, records a sim job, keeps the current study.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };

describe("engineering — beamStudy", () => {
  let ctx, other;
  before(async () => {
    ctx = await depthCtx("engineering-beam-a");
    other = await depthCtx("engineering-beam-b");
  });

  it("beamStudy-get is null before any study (no sample beam)", async () => {
    const r = await lensRun("engineering", "beamStudy-get", { params: {} }, other);
    assert.equal(r.ok, true);
    assert.equal(r.result.study, null);
  });

  it("solves a simply-supported A992 beam and agrees with PL/4 · c/I", async () => {
    const r = await lensRun("engineering", "beamStudy", {
      params: { dims: DIMS, material: "steel-a992", support: "simply-supported", loadN: 200000, name: "Frame beam" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.maxStressMPa - 84.73) < 0.01);
    assert.equal(r.result.handCheck.agrees, true);
    assert.equal(r.result.material.yield, 345);
    assert.equal(r.result.pass, true);
    assert.ok(r.result.jobId);
    const jobs = await lensRun("engineering", "listSimJobs", { params: {} }, ctx);
    assert.ok(jobs.result.jobs.some((j) => j.id === r.result.jobId && j.type === "fea-beam-study"));
  });

  it("the study is kept per user and reopens", async () => {
    const mine = await lensRun("engineering", "beamStudy-get", { params: {} }, ctx);
    assert.equal(mine.result.study.name, "Frame beam");
    assert.equal(mine.result.study.dims.webThickness, 9);
    assert.equal(mine.result.study.materialInfo.label, "ASTM A992 Steel (50 ksi)");
    const theirs = await lensRun("engineering", "beamStudy-get", { params: {} }, other);
    assert.equal(theirs.result.study, null);
  });

  it("reopens with the solver's per-member utilization and keeps a DTU only for the current run", async () => {
    const run = await lensRun("engineering", "beamStudy", {
      params: { dims: DIMS, material: "steel-a992", support: "simply-supported", loadN: 200000, name: "Kept beam" },
    }, ctx);
    const got = await lensRun("engineering", "beamStudy-get", { params: {} }, ctx);
    assert.equal(got.result.study.utilizationByMember.length, run.result.utilizationByMember.length);
    assert.equal(got.result.study.loadNode, run.result.loadNode);
    assert.equal(got.result.study.dtuId, null);
    const stale = await lensRun("engineering", "beamStudy-keep", { params: { jobId: "sim_old", dtuId: "dtu_x" } }, ctx);
    assert.equal(stale.ok === false || stale.result?.ok === false, true);
    const kept = await lensRun("engineering", "beamStudy-keep", { params: { jobId: run.result.jobId, dtuId: "dtu_kept_1" } }, ctx);
    assert.equal(kept.ok, true);
    const after = await lensRun("engineering", "beamStudy-get", { params: {} }, ctx);
    assert.equal(after.result.study.dtuId, "dtu_kept_1");
  });

  it("each ConKay workspace keeps its own study", async () => {
    await lensRun("engineering", "beamStudy", {
      params: { dims: { ...DIMS, length: 3000 }, support: "cantilever", loadN: 5000, name: "Arm", workspaceId: "ws_arm" },
    }, ctx);
    const arm = await lensRun("engineering", "beamStudy-get", { params: { workspaceId: "ws_arm" } }, ctx);
    assert.equal(arm.result.study.name, "Arm");
    assert.equal(arm.result.study.workspaceId, "ws_arm");
    const frame = await lensRun("engineering", "beamStudy-get", { params: { workspaceId: "ws_frame" } }, ctx);
    assert.equal(frame.result.study, null);
    const theirs = await lensRun("engineering", "beamStudy-get", { params: { workspaceId: "ws_arm" } }, other);
    assert.equal(theirs.result.study, null);
    const def = await lensRun("engineering", "beamStudy-get", { params: {} }, ctx);
    assert.notEqual(def.result.study.name, "Arm");
  });

  it("beamSweep solves each web thickness and names the lightest passing one", async () => {
    const before = await lensRun("engineering", "beamStudy-get", { params: {} }, ctx);
    const r = await lensRun("engineering", "beamSweep", {
      params: { dims: DIMS, material: "steel-a36", support: "cantilever", loadN: 150000, param: "webThickness", values: [6, 8, 10, 12] },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.rows.length, 4);
    // Thicker web → larger I → lower stress, strictly.
    const stresses = r.result.rows.map((row) => row.maxStressMPa);
    for (let i = 1; i < stresses.length; i++) assert.ok(stresses[i] < stresses[i - 1]);
    assert.ok(r.result.rows.every((row) => row.handCheckAgrees));
    const passing = r.result.rows.filter((row) => row.pass).map((row) => row.value);
    assert.equal(r.result.lightestPassing, passing.length ? Math.min(...passing) : null);
    const after = await lensRun("engineering", "beamStudy-get", { params: {} }, ctx);
    assert.equal(after.result.study.jobId, before.result.study.jobId);
    const bad = await lensRun("engineering", "beamSweep", { params: { dims: DIMS, param: "colour", values: [1, 2] } }, ctx);
    assert.equal(bad.ok === false || bad.result?.ok === false, true);
  });

  it("the workspace conversation is append-only, deduplicated, per user and per workspace", async () => {
    const msgs = [
      { id: "m1", role: "user", text: "t_w = 8", at: "2026-10-06T10:00:00.000Z" },
      { id: "m2", role: "assistant", text: "FEA complete.", chips: [{ kind: "review", label: "Review stress" }] },
      { id: "m3", role: "system", text: "ignored role" },
    ];
    const a = await lensRun("engineering", "workspaceLog-append", { params: { workspaceId: "ws_log", messages: msgs } }, ctx);
    assert.equal(a.result.count, 2);
    await lensRun("engineering", "workspaceLog-append", { params: { workspaceId: "ws_log", messages: [msgs[0]] } }, ctx);
    const got = await lensRun("engineering", "workspaceLog-get", { params: { workspaceId: "ws_log" } }, ctx);
    assert.deepEqual(got.result.messages.map((m) => m.id), ["m1", "m2"]);
    assert.equal(got.result.messages[1].chips[0].label, "Review stress");
    const elsewhere = await lensRun("engineering", "workspaceLog-get", { params: { workspaceId: "ws_other" } }, ctx);
    assert.deepEqual(elsewhere.result.messages, []);
    const theirs = await lensRun("engineering", "workspaceLog-get", { params: { workspaceId: "ws_log" } }, other);
    assert.deepEqual(theirs.result.messages, []);
    const cleared = await lensRun("engineering", "workspaceLog-clear", { params: { workspaceId: "ws_log" } }, ctx);
    assert.equal(cleared.result.cleared, 2);
  });

  it("an overloaded cantilever fails the check instead of reporting a pass", async () => {
    const r = await lensRun("engineering", "beamStudy", {
      params: { dims: DIMS, material: "steel-a36", support: "cantilever", loadN: 300000 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.utilization > 1);
    assert.equal(r.result.pass, false);
  });

  it("rejects an unknown material and impossible geometry", async () => {
    const bad = await lensRun("engineering", "beamStudy", { params: { dims: DIMS, material: "unobtainium", loadN: 1000 } }, ctx);
    assert.equal(bad.ok === false || bad.result?.ok === false, true);
    assert.match(String(bad.error ?? bad.result?.error), /unknown material/);
    const geo = await lensRun("engineering", "beamStudy", { params: { dims: { ...DIMS, flangeThickness: 200 }, loadN: 1000 } }, ctx);
    assert.equal(geo.ok === false || geo.result?.ok === false, true);
    assert.match(String(geo.error ?? geo.result?.error), /flanges are thicker/);
  });
});
