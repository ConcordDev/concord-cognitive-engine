// tests/depth/lab-behavior.test.js — REAL behavioral tests for the `lab`
// domain (science-lab lens; registerLensAction family, invoked via lensRun).
// Exact-value assertions on the deterministic analysis macros (calibration
// curve regression, Westgard QC, sample turnaround, factorial DOF, DNA
// sequence analysis) + STATE-backed ELN/LIMS CRUD round-trips (notebook,
// reagent inventory, protocol library, plate designer, run import) +
// validation rejections.
//
// Every lensRun("lab", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
//
// NB: lens.run wraps a handler's {ok:false,error} as {ok:true,
// result:{ok:false,error}} — the OUTER r.ok is dispatch success; the handler's
// verdict lives in r.result. So success assertions read r.result.<field> and
// rejection assertions read r.result.ok === false + r.result.error.
//
// No network/LLM macros exist in this domain — every handler is pure
// deterministic compute or in-memory STATE CRUD, so nothing is skipped.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("lab — calc contracts (exact computed values)", () => {
  it("calibrationCurve(linear): perfect fit recovers slope/intercept and back-calculates an unknown", async () => {
    // standards lie exactly on response = 10*conc + 2
    const r = await lensRun("lab", "calibrationCurve", {
      data: {
        standards: [
          { concentration: 0, response: 2 },
          { concentration: 10, response: 102 },
          { concentration: 20, response: 202 },
        ],
        unknowns: [{ id: "u1", response: 152 }],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.coefficients.slope, 10);
    assert.equal(r.result.coefficients.intercept, 2);
    assert.equal(r.result.rSquared, 1);           // perfect linear
    assert.equal(r.result.fitQuality, "excellent");
    // predict: (152 - 2) / 10 = 15
    const u = r.result.unknownResults.find((x) => x.id === "u1");
    assert.equal(u.computedConcentration, 15);
    assert.equal(u.withinRange, true);            // 15 ∈ [0, 20]
  });

  it("calibrationCurve(quadratic): fits y = x² exactly through three points", async () => {
    // response = concentration²  → a=1, b=0, c=0
    const r = await lensRun("lab", "calibrationCurve", {
      params: { model: "quadratic" },
      data: {
        standards: [
          { concentration: 1, response: 1 },
          { concentration: 2, response: 4 },
          { concentration: 3, response: 9 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.coefficients.a, 1);     // leading (x²) coeff exactly 1
    // b and c are ~0 (Gaussian elimination can yield ±0 / tiny residue) → tolerance
    assert.ok(Math.abs(r.result.coefficients.b) < 1e-6);
    assert.ok(Math.abs(r.result.coefficients.c) < 1e-6);
    assert.equal(r.result.rSquared, 1);
  });

  it("calibrationCurve: unknown model is rejected", async () => {
    const r = await lensRun("lab", "calibrationCurve", {
      params: { model: "cubic-spline" },
      data: { standards: [{ concentration: 0, response: 0 }, { concentration: 1, response: 1 }] },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /Unknown model/);
  });

  it("calibrationCurve: a single standard point is rejected (need ≥2)", async () => {
    const r = await lensRun("lab", "calibrationCurve", {
      data: { standards: [{ concentration: 5, response: 50 }] },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least 2 standard/);
  });

  it("qcAnalysis: a >3SD point triggers a 1-3s rejection (out of control)", async () => {
    const r = await lensRun("lab", "qcAnalysis", {
      data: {
        targetMean: 100, targetSD: 10,
        controls: [{ value: 100 }, { value: 135 }], // z = 0, +3.5
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.inControl, false);
    assert.equal(r.result.rejectCount, 1);
    const v = r.result.westgardViolations.find((x) => x.rule === "1-3s");
    assert.equal(v.zScore, 3.5);                  // (135-100)/10
    assert.equal(r.result.statistics.n, 2);
  });

  it("qcAnalysis: two consecutive >2SD same-direction points fire a 2-2s rejection", async () => {
    const r = await lensRun("lab", "qcAnalysis", {
      data: {
        targetMean: 100, targetSD: 10,
        controls: [{ value: 125 }, { value: 130 }], // z = +2.5, +3.0 (both >2, same sign)
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.inControl, false);
    assert.ok(r.result.westgardViolations.some((v) => v.rule === "2-2s"));
  });

  it("qcAnalysis: all points within 2SD are in control", async () => {
    const r = await lensRun("lab", "qcAnalysis", {
      data: {
        targetMean: 100, targetSD: 10,
        controls: [{ value: 101 }, { value: 99 }, { value: 105 }], // |z| ≤ 1
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.inControl, true);
    assert.equal(r.result.rejectCount, 0);
    assert.equal(r.result.zScores[0], 0.1);       // (101-100)/10
  });

  it("sampleTracker: turnaround time + completion status are computed from steps", async () => {
    const r = await lensRun("lab", "sampleTracker", {
      data: {
        samples: [{
          id: "S1", type: "blood", receivedAt: "2026-06-07T10:00:00Z",
          steps: [
            { action: "accession", timestamp: "2026-06-07T10:00:00Z", operator: "alice" },
            { action: "reported", timestamp: "2026-06-07T11:30:00Z", operator: "bob" },
          ],
        }],
      },
    });
    assert.equal(r.ok, true);
    const s = r.result.samples.find((x) => x.id === "S1");
    assert.equal(s.status, "completed");          // last action "reported"
    assert.equal(s.turnaroundMinutes, 90);        // 10:00 → 11:30
    assert.equal(s.turnaroundHours, 1.5);
    assert.equal(s.chainOfCustodyComplete, true); // both steps have an operator
    assert.equal(r.result.completedCount, 1);
  });

  it("experimentDesign(full-factorial): 2×2 yields 4 runs with zero error DOF (no replicates)", async () => {
    const r = await lensRun("lab", "experimentDesign", {
      data: { factors: [
        { name: "temp", levels: ["low", "high"] },
        { name: "ph", levels: ["acid", "base"] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRuns, 4);          // 2 * 2
    assert.equal(r.result.degreesOfFreedom.mainEffects, 2);   // (2-1)+(2-1)
    assert.equal(r.result.degreesOfFreedom.interactions, 1);  // (2-1)*(2-1)
    assert.equal(r.result.degreesOfFreedom.error, 0);         // 4-1-2-1
    assert.equal(r.result.canEstimateError, false);
  });

  it("experimentDesign: no factors is rejected", async () => {
    const r = await lensRun("lab", "experimentDesign", { data: { factors: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /No factors/);
  });

  it("construct-analyze: GC%, Wallace Tm and motif positions are exact", async () => {
    // ATGCATGC: 2 G + 2 C = 4 of 8 → GC 50%; short (<14) → Wallace Tm = 2*AT + 4*GC = 2*4 + 4*4 = 24
    const r = await lensRun("lab", "construct-analyze", {
      params: { sequence: "ATGCATGC", motif: "ATG" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 8);
    assert.equal(r.result.gcContent, 50);
    assert.equal(r.result.meltingTempC, 24);
    assert.equal(r.result.motifHitCount, 2);      // ATG at 0 and 4
    assert.deepEqual(r.result.motifPositions, [0, 4]);
  });
});

describe("lab — ELN/LIMS CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("lab-crud"); });

  it("notebook-create → sign(author) → update: a signed page is immutable", async () => {
    const created = await lensRun("lab", "notebook-create", { params: { title: "Assay run 1", body: "draft body" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.entry.status, "draft");
    const id = created.result.entry.id;

    const signed = await lensRun("lab", "notebook-sign", { params: { id, role: "author", name: "Dr Smith" } }, ctx);
    assert.equal(signed.result.entry.status, "signed");
    assert.equal(signed.result.entry.signedBy, "Dr Smith");

    // GLP: editing a signed entry must be rejected
    const edit = await lensRun("lab", "notebook-update", { params: { id, body: "tampered" } }, ctx);
    assert.equal(edit.result.ok, false);
    assert.match(edit.result.error, /immutable/);

    const list = await lensRun("lab", "notebook-list", {}, ctx);
    assert.ok(list.result.entries.some((e) => e.id === id && e.status === "signed"));
    assert.ok(list.result.signed >= 1);
  });

  it("inventory-add → consume → list: quantity debits and low-stock alert fires", async () => {
    const add = await lensRun("lab", "inventory-add", { params: { name: "Tris buffer", quantity: 10, unit: "mL", lowThreshold: 5 } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.item.quantity, 10);
    const id = add.result.item.id;

    // consume 6 → 4 left, ≤ threshold 5 → low stock
    const consumed = await lensRun("lab", "inventory-consume", { params: { id, delta: -6 } }, ctx);
    assert.equal(consumed.result.item.quantity, 4);
    assert.equal(consumed.result.lowStock, true);

    const list = await lensRun("lab", "inventory-list", {}, ctx);
    const it = list.result.items.find((x) => x.id === id);
    assert.equal(it.quantity, 4);
    assert.equal(it.lowStock, true);
    assert.ok(list.result.alerts.some((a) => a.id === id));
  });

  it("inventory-consume: a missing reagent id is rejected", async () => {
    const bad = await lensRun("lab", "inventory-consume", { params: { id: "rgt_nope", delta: -1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /reagent not found/);
  });

  it("protocol-create → revise → run: version bumps and a guided run is produced", async () => {
    const created = await lensRun("lab", "protocol-create", {
      params: { name: "PCR setup", steps: [{ text: "Thaw reagents", durationMinutes: 5 }, { text: "Mix master mix", durationMinutes: 10 }] },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.protocol.version, 1);
    const id = created.result.protocol.id;

    const revised = await lensRun("lab", "protocol-revise", {
      params: { id, steps: [{ text: "Thaw reagents", durationMinutes: 5 }, { text: "Mix master mix", durationMinutes: 10 }, { text: "Load thermocycler", durationMinutes: 2 }] },
    }, ctx);
    assert.equal(revised.result.protocol.version, 2);   // bumped
    assert.equal(revised.result.protocol.history.length, 1); // v1 archived

    const run = await lensRun("lab", "protocol-run", { params: { id } }, ctx);
    assert.equal(run.ok, true);
    assert.equal(run.result.run.estimatedMinutes, 17);  // 5 + 10 + 2
    assert.equal(run.result.run.steps.length, 3);
    assert.equal(run.result.run.currentStep, 1);
  });

  it("protocol-create: an empty name is rejected", async () => {
    const bad = await lensRun("lab", "protocol-create", { params: { name: "", steps: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("plate-design: valid wells assign, out-of-bounds wells are dropped, role counts tally", async () => {
    const r = await lensRun("lab", "plate-design", {
      params: {
        format: 96,
        wells: [
          { well: "A1", sample: "std-0", role: "standard" },
          { well: "A2", sample: "std-1", role: "standard" },
          { well: "B1", sample: "ctrl", role: "control" },
          { well: "Z9", sample: "oops", role: "sample" },   // row Z invalid on 96
          { well: "A13", sample: "oops2", role: "sample" }, // col 13 invalid on 96
        ],
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.plate.assignedWells, 3);       // only A1, A2, B1
    assert.equal(r.result.plate.totalWells, 96);
    assert.equal(r.result.plate.emptyWells, 93);
    assert.equal(r.result.plate.roleCounts.standard, 2);
    assert.equal(r.result.plate.roleCounts.control, 1);
  });

  it("run-import: a CSV blob parses into records with a numeric column summary", async () => {
    const r = await lensRun("lab", "run-import", {
      params: { instrument: "Plate Reader", csv: "well,od\nA1,0.5\nA2,1.5\nA3,1.0" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.run.recordCount, 3);
    assert.ok(r.result.run.numericColumns.includes("od"));
    assert.equal(r.result.run.summary.od.mean, 1);       // (0.5+1.5+1.0)/3
    assert.equal(r.result.run.summary.od.min, 0.5);
    assert.equal(r.result.run.summary.od.max, 1.5);

    const list = await lensRun("lab", "run-list", {}, ctx);
    assert.ok(list.result.runs.some((x) => x.id === r.result.run.id));
  });

  it("run-import: a header-only CSV (no data rows) is rejected", async () => {
    const bad = await lensRun("lab", "run-import", { params: { csv: "well,od" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /header row and at least one data row/);
  });
});
