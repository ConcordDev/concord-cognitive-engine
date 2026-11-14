// FIX-organ-004 — comp-rollup must not average in blank comp.
//
// A person added with no base comp is stored with compensation 0
// (normEmployee), and the rollup averaged them in as a $0 salary:
// one blank-comp person produced "Total $0, headcount 1, avg $0"
// with no missing-data note, and any mixed roster's average was
// dragged toward zero. Averages are now computed over the people
// WITH comp recorded, the missing count is reported overall and per
// department, and an average with nobody behind it is null (the
// panel renders '—') — the tenure-attrition treatment of a missing
// start date, applied to comp. Totals and headcount are unchanged.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("organ comp-rollup missing comp (FIX-organ-004)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("organ-comp-missing"); });

  it("averages exclude blank comp and the missing count is reported", async () => {
    await lensRun("organ", "roster-set", {
      params: { employees: [
        { id: "a", name: "A", department: "Eng", compensation: 100000 },
        { id: "b", name: "B", department: "Eng" },
        { id: "c", name: "C", department: "Sales", compensation: 60000 },
        { id: "d", name: "D", department: "Sales" },
      ] },
    }, ctx);
    const r = await lensRun("organ", "comp-rollup", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.headcount, 4);
    assert.equal(r.result.totalComp, 160000);
    assert.equal(r.result.compHeadcount, 2);
    assert.equal(r.result.missingComp, 2);
    assert.equal(r.result.avgComp, 80000);
    const eng = r.result.departments.find((d) => d.department === "Eng");
    assert.equal(eng.avgComp, 100000);
    assert.equal(eng.missingComp, 1);
    assert.equal(eng.compHeadcount, 1);
    const sales = r.result.departments.find((d) => d.department === "Sales");
    assert.equal(sales.avgComp, 60000);
  });

  it("the walker's case: one blank-comp person — avg is null, missing is named", async () => {
    await lensRun("organ", "roster-set", {
      params: { employees: [{ id: "solo", name: "Solo", department: "Ops" }] },
    }, ctx);
    const r = await lensRun("organ", "comp-rollup", {}, ctx);
    assert.equal(r.result.headcount, 1);
    assert.equal(r.result.totalComp, 0);
    assert.equal(r.result.avgComp, null);
    assert.equal(r.result.missingComp, 1);
    assert.equal(r.result.departments[0].avgComp, null);
  });
});
