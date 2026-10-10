// server/tests/conkay-sentinel-masses.test.js
//
// Sentinel M1's mass budget closed (brief 3 item 2): the nine placeholder
// masses replaced by sourced (data sheet, hash recorded), computed (geometry ×
// cited density) or estimated (method + range) values; the armor cage stated
// as not fitted on Milestone 1. Then the budget against the stance leg's
// limit (structure.frame load-to-limit, buckling governs).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "../lib/conkay/index.js";
import { buildSentinelM1IR, runSentinelM1, COMPUTE_SYSTEM, CAMERA, IMU, FAN } from "../lib/conkay/demos/sentinel-m1.js";
import { SOURCES } from "../lib/conkay/northstar/sources.js";
import { batteryEnclosure } from "../lib/conkay/physics/solvers/mass-budget.js";
import { openDesign } from "../lib/conkay/index.js";

const at = (l, id) => l.find((c) => c.runId === id);
const near = (a, b, rel, m) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${m}: ${a} vs ${b}`);
const R = runSentinelM1();
const mb = at(R.report.checks, "mass.budget@sentinel").outputs;

describe("Sentinel M1 masses, sourced", () => {
  it("bought parts carry the data-sheet mass, URL, exact variant and the document hash", () => {
    for (const [rec, id] of [[COMPUTE_SYSTEM, "advantech-mic-733-ao"], [CAMERA, "realsense-d400-datasheet"], [IMU, "xsens-mti-630"], [FAN, "sanyo-san-ace-80-9ga"]]) {
      const src = SOURCES[id];
      assert.equal(rec.source, id);
      assert.match(src.url, /^https:\/\//);
      assert.match(src.sha256, /^[0-9a-f]{64}$/);
      assert.ok(src.excerpt.includes(String(rec.massKg >= 1 ? rec.massKg : Math.round(rec.massKg * 1000 * 10) / 10)), `${id}: excerpt states the mass`);
    }
    const ir = buildSentinelM1IR();
    const cam = ir.nodes.find((n) => n.id === "camera");
    assert.deepEqual(cam.props.massState.uncertainty, { pct: 10 }, "the D455 data sheet's ±10 %");
    assert.ok(!ir.nodes.some((n) => n.id === "compute-carrier"), "the MIC-733's sourced mass covers module, carrier and thermal solution");
    assert.deepEqual(ir.nodes.find((n) => n.id === "compute").props.covers, ["Jetson AGX Orin 64GB module", "carrier board", "thermal solution (fanless)"]);
  });
  it("the battery enclosure is computed from the cell grid, so it follows the battery repair", () => {
    const bat = buildSentinelM1IR({ batteryParallel: 5 }).nodes.find((n) => n.id === "battery").props.battery;
    const e = batteryEnclosure(bat);
    const pitch = bat.cell.diameterM + 0.001;
    const L = 13 * pitch + 0.003, W = 5 * pitch + 0.003, H = bat.cell.heightM + 0.01 + 0.003;
    near(e.massKg, 2 * (L * W + L * H + W * H) * 0.0015 * 2700, 1e-12, "shell area × 1.5 mm × 6061 density");
    const e8 = batteryEnclosure({ ...bat, parallel: 8 });
    assert.ok(e8.massKg > e.massKg);
    near(at(R.report.checks, "mass.budget@sentinel").outputs.items.value.find((i) => i.id === "battery").mass, 65 * 0.07 + e.massKg, 1e-12, "13S5P cells + enclosure");
  });
  it("the harness copper is computed from the run lengths; the estimate's range brackets it", () => {
    const w = buildSentinelM1IR().nodes.find((n) => n.id === "wiring").props;
    const cu = parseFloat(w.mass) / 1.8;
    near(w.massState.uncertainty.lowKg, cu * 1.4, 1e-3, "low");
    near(w.massState.uncertainty.highKg, cu * 3.0, 1e-3, "high");
    assert.ok(w.distributed);
  });
});

describe("Sentinel M1 budget closed, against the leg's 323 kg ceiling", () => {
  it("no unknown mass; the armor cage is a stated not-fitted line", () => {
    assert.equal(mb.unknownCount.value, 0);
    assert.deepEqual(mb.notFitted.value.map((x) => x.id), ["armor"]);
    // pinned: 60.68 kg (band 60.11-61.89), CG z 1.761 m at the time of writing
    near(mb.knownMass.value, 60.682, 1e-3, "total");
    near(mb.massLow.value, 60.108, 1e-3, "low");
    near(mb.massHigh.value, 61.890, 1e-3, "high");
  });
  it("the stance leg passes at the closed mass, and its mass-at-limit is ~323 kg (buckling)", () => {
    const fr = at(R.report.checks, "structure.frame@sentinel");
    assert.equal(fr.status, "PASS");
    const lim = fr.outputs["single-support.loadToLimit"].value;
    assert.equal(lim.governs, "buckling");
    near(lim.totalMassKg, 322.78, 1e-3, "mass at the limit");
    assert.ok(mb.massHigh.value < lim.totalMassKg, "even the high band is far below the limit");
    assert.ok(R.gate.accepted && /software screening only/.test(R.gate.scope));
  });
  it("the CG check passes with the budget closed; repairs are unchanged (13S5P, 1\" × 0.065\" bracket)", () => {
    const st = at(R.report.checks, "stability.static@sentinel");
    assert.equal(st.status, "PASS");
    assert.ok(st.outputs.stabilityMargin.value >= 0.05);
    const acc = R.report.repairs.filter((x) => x.result === "accepted").map((x) => x.after);
    assert.deepEqual(acc, ["13S3P", "13S5P", "1\" × 0.065\" 6061-T6"]);
    assert.equal(at(R.report.checks, "geometry.clearance@sentinel").status, "PASS");
  });
  it("the frame's mass-at-limit answers how much a later armor cage could weigh (spec's 600 lb would not fit)", () => {
    const lim = at(R.report.checks, "structure.frame@sentinel").outputs["single-support.loadToLimit"].value;
    const room = lim.totalMassKg - mb.massHigh.value;
    assert.ok(room > 250 && room < 0.45359237 * 600, `${room} kg of headroom at the leg (buckling, factor 2) is below the March 272 kg cage`);
    // and opened directly, the repaired design gives the same budget
    const s = openDesign(buildSentinelM1IR({ batteryParallel: 5, bracket: "sq-1x0.065" })).session;
    near(s.result("mass.budget@sentinel").outputs.knownMass.value, mb.knownMass.value, 1e-12, "same model");
  });
});
