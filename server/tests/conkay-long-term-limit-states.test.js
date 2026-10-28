// server/tests/conkay-long-term-limit-states.test.js
// Q42/K1/K2/A#15 — the long-term limit states: galvanic corrosion
// (Joint), uniform corrosion (Bolt/Plate), fatigue (AISC Appendix 3
// at joints per the bolt-joint input contract; Basquin screening for
// actuators). Before this, coverage reported "no solver yet" for all
// three domains.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

function design({ boltMat = "astm-a325", plateMat = "steel-a36", jointProps = {}, boltProps = {}, plateProps = {}, extraNodes = [], extraEdges = [] } = {}) {
  return {
    design: { id: "lt", name: "Long-term limit states" },
    nodes: [
      { id: "A1", kind: "Assembly", name: "Asm" },
      { id: "P1", kind: "Plate", material: plateMat, geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" }, props: plateProps },
      { id: "B1", kind: "Bolt", material: boltMat, geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" }, props: boltProps },
      { id: "J1", kind: "Joint", name: "Splice", props: jointProps },
      ...extraNodes,
    ],
    edges: [
      ...["P1", "B1", "J1"].map((to) => ({ type: "CONTAINS", from: "A1", to })),
      ...["P1", "B1"].map((to) => ({ type: "CONTAINS", from: "J1", to })),
      ...extraEdges,
    ],
    loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "10 kN" }] }],
  };
}
function open(ir) {
  const o = openDesign(ir);
  assert.equal(o.ok, true, JSON.stringify(o.errors));
  return o.session;
}

describe("long-term limit states (Q42)", () => {
  it("registers solvers for corrosion.galvanic, corrosion and fatigue", () => {
    const byDomain = new Map();
    for (const s of listSolvers()) for (const d of s.domains) if (!byDomain.has(d)) byDomain.set(d, s.id);
    assert.equal(byDomain.get("corrosion.galvanic"), "joint.galvanic-corrosion");
    assert.equal(byDomain.get("corrosion"), "part.uniform-corrosion");
    assert.equal(byDomain.get("fatigue"), "joint.fatigue");
    assert.ok(listSolvers().some((s) => s.id === "actuator.fatigue-screening"));
  });

  it("galvanic: same-family steel joint passes; stainless-in-aluminum submerged fails on ΔV", () => {
    const okS = open(design({ jointProps: { environment: "outdoor-urban" } }));
    const okE = okS.result("joint.galvanic-corrosion@J1");
    assert.equal(okE.status, "PASS", JSON.stringify(okE));
    assert.equal(okE.outputs.pairs.value[0].deltaV, 0);

    const badS = open(design({ boltMat: "iso-3506-a2-70", plateMat: "aluminum-6061-t6", jointProps: { environment: "marine-submerged" } }));
    const badE = badS.result("joint.galvanic-corrosion@J1");
    assert.equal(badE.status, "FAIL");
    assert.ok(badE.failures[0].includes("0.66 V"), badE.failures[0]);
    assert.ok(badE.failures[0].includes("P1 is the anode"), badE.failures[0]);
  });

  it("galvanic: no declared environment is NOT_COMPUTED, never a pass", () => {
    const s = open(design({}));
    const e = s.result("joint.galvanic-corrosion@J1");
    assert.equal(e.status, "NOT_COMPUTED");
    assert.match(e.reason, /props\.environment/);
  });

  it("uniform corrosion: plate section loss = rate × life / thickness, judged vs the declared allowable", () => {
    const props = { environment: "outdoor-urban", designLifeYears: 50, allowableSectionLoss: 0.2 };
    const s = open(design({ plateProps: props }));
    const e = s.result("part.uniform-corrosion@P1");
    assert.equal(e.status, "FAIL", JSON.stringify(e)); // 0.05 mm/yr × 50 / 10 mm = 0.25 > 0.2
    assert.equal(e.outputs.sectionLossFraction.value, 0.25);
    assert.equal(e.outputs.penetration.value, 2.5);

    const s2 = open(design({ plateProps: { ...props, allowableSectionLoss: 0.5 } }));
    assert.equal(s2.result("part.uniform-corrosion@P1").status, "PASS");
  });

  it("uniform corrosion: bolt area loss from radial penetration; missing life is NOT_COMPUTED", () => {
    const s = open(design({ boltProps: { environment: "outdoor-rural", designLifeYears: 25, allowableSectionLoss: 0.25 } }));
    const e = s.result("part.uniform-corrosion@B1");
    assert.equal(e.status, "PASS", JSON.stringify(e));
    // p = 0.03 × 25 = 0.75 mm; loss = 1 − (18.5/20)² = 0.144375 → 0.1444
    assert.equal(e.outputs.sectionLossFraction.value, 0.1444);

    const s2 = open(design({ boltProps: { environment: "outdoor-rural" } }));
    assert.equal(s2.result("part.uniform-corrosion@B1").status, "NOT_COMPUTED");
  });

  it("fatigue at the joint: AISC Appendix 3 category curve and threshold floor", () => {
    // Category D: Cf = 22e8, Fth = 7 ksi. At N = 2e6, F_SR = (1100)^(1/3) = 10.32 ksi = 71.2 MPa.
    const s = open(design({ jointProps: { fatigueCategory: "D", fatigueCycles: 2_000_000, fatigueStressRange: "10 MPa" } }));
    const e = s.result("joint.fatigue@J1");
    assert.equal(e.status, "PASS", JSON.stringify(e));
    const expectedPa = Math.cbrt(22e8 / 2e6) * 6.894757e6;
    assert.ok(Math.abs(e.outputs.allowableStressRange.value - expectedPa) / expectedPa < 0.01);
    assert.equal(e.outputs.infiniteLife.value, true); // 10 MPa < Fth 48.3 MPa

    const failing = open(design({ jointProps: { fatigueCategory: "D", fatigueCycles: 2_000_000, fatigueStressRange: "80 MPa" } }));
    assert.equal(failing.result("joint.fatigue@J1").status, "FAIL");

    // Below threshold at huge N: F_SR(N=1e8) = 2.8 ksi < Fth, so the floor governs and 40 MPa passes.
    const floored = open(design({ jointProps: { fatigueCategory: "D", fatigueCycles: 100_000_000, fatigueStressRange: "40 MPa" } }));
    const fe = floored.result("joint.fatigue@J1");
    assert.equal(fe.status, "PASS", JSON.stringify(fe));
    assert.equal(fe.outputs.allowableStressRange.value, Math.round(7 * 6.894757e6));

    const undeclared = open(design({}));
    assert.equal(undeclared.result("joint.fatigue@J1").status, "NOT_COMPUTED");
  });

  it("fatigue screening for actuators: Basquin life vs declared cycles", () => {
    const s = open(design({
      extraNodes: [{ id: "AC1", kind: "Actuator", material: "steel-a36", props: { fatigue: { stressRangePa: 50e6, cycles: 1e6 } } }],
      extraEdges: [{ type: "CONTAINS", from: "A1", to: "AC1" }],
    }));
    const e = s.result("actuator.fatigue-screening@AC1");
    assert.equal(e.status, "WARN", JSON.stringify(e)); // passes its margin, carries the screening warning
    assert.ok(e.margins[0].utilization < 1);
    const failing = open(design({
      extraNodes: [{ id: "AC1", kind: "Actuator", material: "steel-a36", props: { fatigue: { stressRangePa: 300e6, cycles: 1e7 } } }],
      extraEdges: [{ type: "CONTAINS", from: "A1", to: "AC1" }],
    }));
    assert.equal(failing.result("actuator.fatigue-screening@AC1").status, "FAIL");
  });

  it("coverage no longer reports the three domains as missing solvers", () => {
    const s = open(design({
      jointProps: { environment: "outdoor-urban", fatigueCategory: "D", fatigueCycles: 1e6, fatigueStressRange: "10 MPa" },
    }));
    const cov = s.coverage();
    const j1 = cov.find((c) => c.node === "J1");
    assert.ok(!j1.domains.some((d) => /no (corrosion\.galvanic|fatigue) solver/.test(d.reason || "")), JSON.stringify(j1.domains));
    const b1 = cov.find((c) => c.node === "B1");
    assert.ok(!b1.domains.some((d) => /no (fatigue|corrosion) solver/.test(d.reason || "")), JSON.stringify(b1.domains));
    // The joint fatigue envelope covers the bolt, so the Bolt row sees it too.
    assert.ok(b1.domains.some((d) => d.domain === "fatigue" && d.solver === "joint.fatigue"), JSON.stringify(b1.domains));
  });
});
