// Weight or volume? USB Blend D's text gives percentages without a basis. material.basis-discriminator predicts
// what each reading implies for a moulded batch so one measurement decides.
//  [CIAAW] Abridged standard atomic weights (ciaaw.org): C 12.011 ± 0.002, O 15.999 ± 0.001, Ca 40.078 ± 0.004
//          → M(CaCO3) = 100.086, M(CaO) = 56.077, ratio 0.56029 (computed).
// The density half is cross-checked against material.density-rom (a different algorithm: greedy fill).
// Hand check of the mass-basis residue minimum: HDPE 70 + co-polymer 15 + graphene 3 (burnt) = 88, so 12 % is
// basalt + CaCO3 + silica; the least residue puts CaCO3 at its 5 % max (it keeps only 0.56029): 5 + 5·0.56029 + 2.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compositionVertices, densityBand, residueBand, discriminateBasis, CAO_FROM_CACO3, M_CACO3, M_CAO } from "../lib/conkay/knowledge/basis-discrimination.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { withCopolymerCandidate } from "../lib/conkay/knowledge/copolymer-candidates.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const { text, meta } = loadFixture("usb-blend-d");
const base = materialIrFromText(text, meta);
const open = (ir) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir } }] }).session;

describe("exact machinery", () => {
  it("vertices of the composition polytope sum to 100 and respect the ranges", () => {
    const r = [{ min: 60, max: 80 }, { min: 10, max: 30 }, { min: 5, max: 15 }];
    const V = compositionVertices(r);
    assert.ok(V.length > 0);
    for (const x of V) { close(x.reduce((a, b) => a + b, 0), 100); x.forEach((v, i) => assert.ok(v >= r[i].min - 1e-9 && v <= r[i].max + 1e-9)); }
    assert.deepEqual(compositionVertices([{ min: 10, max: 20 }, { min: 10, max: 20 }]), []);
    assert.throws(() => compositionVertices([{ min: 5, max: 1 }]));
  });
  it("two-component hand cases: mass and volume density, mass residue", () => {
    const r = [{ min: 90, max: 90 }, { min: 10, max: 10 }], d = [{ lo: 1000, hi: 1000 }, { lo: 2000, hi: 2000 }];
    close(densityBand(r, d, "mass").low, 100 / (90 / 1000 + 10 / 2000));
    close(densityBand(r, d, "volume").low, 0.9 * 1000 + 0.1 * 2000);
    close(residueBand(r, d, "mass", [[0, 0], [1, 1]]).high, 10);
    close(residueBand(r, d, "volume", [[0, 0], [1, 1]]).high, (100 * 0.1 * 2000) / 1100);
    assert.equal(densityBand(r, [d[0], null], "mass").computed, false);
  });
  it("[CIAAW] CaCO3 → CaO mass factor", () => {
    assert.ok(DOCUMENTS["ciaaw-abridged-atomic-weights"].excerpt.includes("20 | Ca | calcium | 40.078 ± 0.004"));
    close(M_CACO3, 40.078 + 12.011 + 3 * 15.999);
    close(M_CAO, 40.078 + 15.999);
    assert.ok(Math.abs(CAO_FROM_CACO3 - 0.56029) < 1e-5);
  });
});

function close(a, b, rel = 1e-12) { assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} vs ${b}`); }

describe("USB Blend D: weight or volume", () => {
  it("is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "material.basis-discriminator");
    for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });
  it("unidentified co-polymer: the mass-basis residue needs no density (9.80–18 %); everything else names the co-polymer", () => {
    const r = open(base).result("material.basis-discriminator@M");
    assert.equal(r.status, "WARN");
    close(r.outputs.mass.value.residue.low, 5 + 5 * CAO_FROM_CACO3 + 2, 1e-9);
    close(r.outputs.mass.value.residue.high, 18, 1e-9);
    assert.match(r.outputs.volume.value.residue.notComputed, /hdpe-hc-co-polymer/);
    assert.match(r.outputs.mass.value.density.notComputed, /hdpe-hc-co-polymer/);
    assert.equal(r.outputs.decidingTests.value, null);
  });
  for (const cand of ["recycled-impact-pp", "eva"]) {
    it(`${cand}: density bands match material.density-rom under each basis, and ash separates the readings`, () => {
      const ir = withCopolymerCandidate(base, cand);
      const r = open(ir).result("material.basis-discriminator@M");
      for (const b of ["mass", "volume"]) {
        const rom = open({ ...ir, basis: b }).result("material.density-rom@M").outputs.density.value;
        close(r.outputs[b].value.density.low, rom.low, 1e-9);
        close(r.outputs[b].value.density.high, rom.high, 1e-9);
      }
      const m = r.outputs.mass.value, v = r.outputs.volume.value;
      assert.ok(m.residue.high < v.residue.low, `${m.residue.high} < ${v.residue.low}`);
      assert.ok(m.density.high < v.density.low);
      const sep = r.outputs.separation.value;
      assert.equal(sep.residue.decides, true);
      assert.equal(sep.density.decides, true);
      close(sep.density.voidFractionToBlur, 1 - m.density.high / v.density.low);
      assert.ok(sep.density.voidFractionToBlur > 0.04 && sep.density.voidFractionToBlur < 0.05);
      assert.equal(r.outputs.decidingTests.value.length, 2);
    });
  }
  it("infeasible ranges are NOT_COMPUTED", () => {
    const bad = { ...base, constituents: base.constituents.map((c) => ({ ...c, fraction: { min: 1, max: 2 } })) };
    assert.equal(open(bad).result("material.basis-discriminator@M").status, "NOT_COMPUTED");
  });
  it("discriminateBasis records the retention assumptions", () => {
    const d = discriminateBasis(withCopolymerCandidate(base, "eva").constituents);
    assert.match(d.retention.find((x) => x.id === "graphene").basis, /unknown whether graphene burns/);
    assert.match(d.retention.find((x) => x.id === "basalt-fiber").basis, /assumed retained/);
  });
});
