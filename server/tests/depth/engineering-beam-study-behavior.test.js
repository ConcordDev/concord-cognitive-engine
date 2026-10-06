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
