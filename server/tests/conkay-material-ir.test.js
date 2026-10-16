// Blend D brief item 1: material IR + registry bridge.
//
// The formulation becomes a typed material IR on a design-graph Material node;
// material.composition-check / material.density-rom / material.mass-to-volume
// run through the physics registry and reproduce the knowledge layer's own
// receipts byte for byte. mass.part on a Blend D part says why it has no mass.
//
// Published benchmarks for the mass→volume conversion (values quoted here with
// their locators; the conversion is computed, the table is the check):
//
//  [N25] Ngugi J., Rading G.O., Mbuya T.O. "The Feasibility of Developing a
//        Construction Material From Basaltic Quarry Waste and Recycled
//        High-Density Polyethylene", The Scientific World Journal 2025,
//        Article 5519409, doi:10.1155/tswj/5519409 (PMC11876525). Table 2
//        "Formulations used to prepare recycled HDPE/BQW composites", with its
//        note: "The densities of HDPE and BQW used in calculating the volume
//        fractions were 930.1 kg/m3 and 2387 kg/m3 respectively."
//        Rows (HDPE wt%, vol% | BQW wt%, vol%): 99 99.61 | 1 0.39; 98 99.21 | 2 0.79;
//        97 98.81 | 3 1.19; 95 98.00 | 5 2.00; 93 97.15 | 7 2.85; 90 95.85 | 10 4.15;
//        80 91.12 | 20 8.88; 70 85.69 | 30 14.31.
//
//  [D26] Das B., Ip G., Porwal H., Evans J., Newton M., Liu Y., Papageorgiou D.G.,
//        Zhang H. "Tunable Pyroresistive Behavior in Conductive Polymer Composites
//        with a Secondary Elastomer Phase", ACS Applied Engineering Materials 2026,
//        4(7), 3644, doi:10.1021/acsaenm.6c00343 (PMC13411071). Table 1 datasheet
//        densities: Arnitel EM630-H TPE 1240 kg·m–3, INEOS Rigidex HD5218EA HDPE
//        952 kg·m–3, XG Science M-25 GNP 2200 kg·m–3. Table 2 "Formulations Created
//        with Respective wt % and vol % of Each Component" (HDPE | TPE | GNP, wt % / vol %):
//        MB 75.0/87.4 | 0.0/0.0 | 25.0/12.6; MB/2.5 73.1/85.4 | 2.5/2.2 | 24.4/12.3;
//        MB/7.5 69.4/81.5 | 7.5/6.8 | 23.1/11.8; MB/10 67.5/79.5 | 10.0/9.0 | 22.5/11.5;
//        MB/20 60.0/71.4 | 20.0/18.3 | 20.0/10.3; MB/35 48.8/59.0 | 35.0/32.5 | 16.3/8.5;
//        MB/50 37.5/46.1 | 50.0/47.2 | 12.5/6.7.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadFixture, buildFormulationReport } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText, validateMaterialIr, massToVolumeFractions, compositionCheck, strictDensity, MATERIAL_IR_SCHEMA } from "../lib/conkay/knowledge/material-ir.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { getMaterial } from "../lib/conkay/materials/index.js";

const { text, meta } = loadFixture("usb-blend-d");
const ir = materialIrFromText(text, meta);
const report = buildFormulationReport(text, meta);

describe("material IR of USB Blend D", () => {
  it("is valid, keeps the unstated basis unknown, and leaves the copolymer's density null", () => {
    assert.equal(ir.schema, MATERIAL_IR_SCHEMA);
    assert.deepEqual(validateMaterialIr(ir), []);
    assert.equal(ir.basis, "unknown");
    const co = ir.constituents.find((c) => c.id === "hdpe-hc-co-polymer");
    assert.equal(co.properties.density, null);
    assert.match(co.unknown.density, /no cited density/);
    for (const c of ir.constituents.filter((x) => x.id !== "hdpe-hc-co-polymer")) assert.ok(c.properties.density.claimRef, c.id);
    assert.equal(ir.nominal.fractions.reduce((a, f) => a + f.pct, 0).toFixed(4), "100.0000");
  });

  it("rejects invalid input: negative, inverted, over 100 %, missing basis, a nominal that does not sum to 100 %", () => {
    const bad = (mut) => { const x = structuredClone(ir); mut(x); return validateMaterialIr(x).join(" | "); };
    assert.match(bad((x) => { x.constituents[0].fraction.min = -1; }), /negative/);
    assert.match(bad((x) => { x.constituents[0].fraction = { min: 70, max: 65 }; }), /min 70 > max 65/);
    assert.match(bad((x) => { x.constituents[0].fraction.max = 120; }), /exceed 100/);
    assert.match(bad((x) => { delete x.basis; }), /basis must be one of/);
    assert.match(bad((x) => { x.nominal.fractions[0].pct += 1; }), /sum to 101/);
    assert.match(bad((x) => { x.constituents[1].id = x.constituents[0].id; }), /duplicated/);
    assert.match(bad((x) => { x.constituents[2].properties.density = { lo: 0, hi: 1 }; }), /density interval/);
    assert.deepEqual(validateMaterialIr(null), ["the material IR is not an object"]);
  });

  it("massToVolumeFractions refuses a sum other than 100 % and negative fractions, and returns the unknown constituent", () => {
    assert.throws(() => massToVolumeFractions([50, 40], [{ lo: 950, hi: 950 }, { lo: 2000, hi: 2000 }]), /sum to 100/);
    assert.throws(() => massToVolumeFractions([110, -10], [{ lo: 950, hi: 950 }, { lo: 2000, hi: 2000 }]), /non-negative/);
    assert.deepEqual(massToVolumeFractions([60, 40], [{ lo: 950, hi: 950 }, null]), { ok: false, missing: [1] });
  });
});

describe("mass → volume fractions against published tables", () => {
  it("[N25] Table 2: recycled HDPE (930.1) / basaltic quarry waste (2387), every row to the table's 0.01 % but one", () => {
    const rows = [[99, 99.61, 1, 0.39], [98, 99.21, 2, 0.79], [97, 98.81, 3, 1.19], [93, 97.15, 7, 2.85], [90, 95.85, 10, 4.15], [80, 91.12, 20, 8.88], [70, 85.69, 30, 14.31]];
    for (const [wH, vH, wB, vB] of rows) {
      const r = massToVolumeFractions([wH, wB], [{ lo: 930.1, hi: 930.1 }, { lo: 2387, hi: 2387 }]);
      assert.ok(Math.abs(r.phi[0].pct - vH) <= 0.005 + 1e-9, `HDPE ${wH} wt%: ${r.phi[0].pct} vs ${vH}`);
      assert.ok(Math.abs(r.phi[1].pct - vB) <= 0.005 + 1e-9, `BQW ${wB} wt%: ${r.phi[1].pct} vs ${vB}`);
    }
    // Reported, not hidden: the 95/5 wt% row prints 98.00 / 2.00 vol%, but the stated densities give 97.990 / 2.0096
    // (2.01 to the table's precision). The other rows round, not truncate (7 wt% → 2.8494, printed 2.85), so this row
    // is read as a slip in the published table; the conversion is off it by under 0.01 vol%.
    const r5 = massToVolumeFractions([95, 5], [{ lo: 930.1, hi: 930.1 }, { lo: 2387, hi: 2387 }]);
    assert.equal(r5.phi[1].pct.toFixed(2), "2.01");
    assert.ok(Math.abs(r5.phi[1].pct - 2.00) < 0.01);
  });

  it("[D26] Table 2: HDPE (952) / TPE (1240) / GNP (2200), three phases, every row to the table's 0.1 %", () => {
    const rows = [
      [75.0, 87.4, 0.0, 0.0, 25.0, 12.6], [73.1, 85.4, 2.5, 2.2, 24.4, 12.3], [69.4, 81.5, 7.5, 6.8, 23.1, 11.8], [67.5, 79.5, 10.0, 9.0, 22.5, 11.5],
      [60.0, 71.4, 20.0, 18.3, 20.0, 10.3], [48.8, 59.0, 35.0, 32.5, 16.3, 8.5], [37.5, 46.1, 50.0, 47.2, 12.5, 6.7],
    ];
    const rho = [952, 1240, 2200].map((d) => ({ lo: d, hi: d }));
    for (const [wH, vH, wT, vT, wG, vG] of rows) {
      // the table's wt% are rounded to 0.1 and some rows sum to 99.9 %: renormalise the stated values, as the authors' own sums do
      const s = wH + wT + wG;
      const r = massToVolumeFractions([wH, wT, wG].map((x) => (100 * x) / s), rho);
      // tolerance: the table's 0.05 % rounding plus the effect of its own 0.1 wt% rounding of the inputs
      for (const [k, v] of [[0, vH], [1, vT], [2, vG]]) assert.ok(Math.abs(r.phi[k].pct - v) <= 0.15, `row ${wH}/${wT}/${wG} phase ${k}: ${r.phi[k].pct.toFixed(3)} vs ${v}`);
    }
  });

  it("interval bounds are exact: they equal the extremes over every corner of the density box", () => {
    const w = [70, 20, 10];
    const d = [{ lo: 941, hi: 970 }, { lo: 2400, hi: 3050 }, { lo: 2000, hi: 2250 }];
    const r = massToVolumeFractions(w, d);
    for (let i = 0; i < 3; i++) {
      let lo = Infinity, hi = -Infinity;
      for (let m = 0; m < 8; m++) {
        const rho = d.map((x, j) => ((m >> j) & 1 ? x.hi : x.lo));
        const p = massToVolumeFractions(w, rho.map((v) => ({ lo: v, hi: v }))).phi[i].pct;
        lo = Math.min(lo, p); hi = Math.max(hi, p);
      }
      assert.ok(Math.abs(r.phi[i].min - lo) < 1e-9 && Math.abs(r.phi[i].max - hi) < 1e-9, `phase ${i}`);
      assert.ok(r.phi[i].min <= r.phi[i].pct && r.phi[i].pct <= r.phi[i].max);
    }
  });
});

describe("the knowledge layer's receipts, byte for byte", () => {
  it("composition check and strict density reproduce the formulation report's receipts", () => {
    assert.equal(compositionCheck(ir).receipt.id, report.receipts[0].id);
    assert.equal(strictDensity(ir).result.receipt.id, "receipt:rule-of-mixtures-density:b3c223e0a37e6126");
    assert.deepEqual(report.receipts.map((r) => r.id).slice(1), [
      "receipt:rule-of-mixtures-density:b3c223e0a37e6126",
      "receipt:rule-of-mixtures-density:30b3280c410d16b8",
      "receipt:rule-of-mixtures-density:14b7ce62a2c10077",
    ]);
  });
});

describe("material.* solvers through the physics registry", () => {
  const opened = openDesign({
    nodes: [
      { id: "BLEND_D", kind: "Material", name: "USB Blend D", props: { formulation: ir } },
      { id: "COUPON", kind: "Part", name: "Blend D coupon", material: "usb-blend-d", geometry: { shape: "box", length: "100 mm", width: "100 mm", height: "10 mm" } },
    ],
  });
  const s = opened.session;

  it("are registered with their declared regime, units, tolerance and screening flag", () => {
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    for (const id of ["material.composition-check", "material.density-rom", "material.mass-to-volume"]) {
      const sv = listSolvers().find((x) => x.id === id);
      assert.ok(sv, id);
      for (const k of ["regime", "units", "tolerance", "screening"]) assert.ok(sv[k] != null, `${id}.${k}`);
    }
  });

  it("composition-check WARNs (100 % reachable, not fixed; basis unknown) with the report's receipt", () => {
    const r = s.result("material.composition-check@BLEND_D");
    assert.equal(r.status, "WARN");
    assert.equal(r.engineReceipt.id, report.receipts[0].id);
    assert.equal(r.outputs.check.value.minSumPct, 86);
    assert.equal(r.outputs.check.value.maxSumPct, 103);
    assert.ok(r.warnings.some((w) => /basis unknown/.test(w)));
  });

  it("density-rom is NOT_COMPUTED naming the copolymer, keeps the receipts and the labelled screening band", () => {
    const r = s.result("material.density-rom@BLEND_D");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /hdpe-hc-co-polymer/);
    assert.equal(r.engineReceipt.strict.id, "receipt:rule-of-mixtures-density:b3c223e0a37e6126");
    assert.equal(r.engineReceipt.conditional.id, "receipt:rule-of-mixtures-density:30b3280c410d16b8");
    assert.equal(r.engineReceipt.conditionalVolumeBasis.id, "receipt:rule-of-mixtures-density:14b7ce62a2c10077");
    assert.match(r.outputs.screening.note, /screening only, not a property of record/);
    assert.equal(r.outputs.density, undefined, "no density output while the strict one is unknown");
  });

  it("mass-to-volume is NOT_COMPUTED naming the copolymer; with its density supplied it converts", () => {
    assert.match(s.result("material.mass-to-volume@BLEND_D").reason, /no cited density for: hdpe-hc-co-polymer/);
    const known = structuredClone(ir);
    known.constituents.find((c) => c.id === "hdpe-hc-co-polymer").properties.density = { lo: 940, hi: 960, unit: "kg/m3", claimRef: "test" };
    const o = openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: known } }] }).session.result("material.mass-to-volume@M");
    assert.equal(o.status, "WARN", o.reason);
    const v = o.outputs.volumeFractions.value;
    const total = Object.values(v).reduce((a, x) => a + x.pct, 0);
    assert.ok(Math.abs(total - 100) < 1e-9);
    assert.ok(v.graphene.pct < 2.8235, "a dense filler takes a smaller volume share than its mass share");
  });

  it("an invalid IR is NOT_COMPUTED with the validation errors", () => {
    const bad = structuredClone(ir);
    bad.basis = "weight";
    const r = openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: bad } }] }).session.result("material.composition-check@M");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /invalid material IR: basis must be one of/);
  });

  it("mass.part on a Blend D part says why it has no mass instead of 'no material assigned'", () => {
    assert.equal(getMaterial("usb-blend-d").densityKgM3, null);
    const r = s.result("mass.part@COUPON");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /USB Blend D.*HDPE\/HC co-polymer has no cited density/);
  });
});
