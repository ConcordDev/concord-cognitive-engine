// material.crystal-aggregate: isotropic properties of a random mineral powder from single-crystal data.
//  [QNT]  Quantas 2.0.0-beta Elasticity tutorial (quantas.readthedocs.io): calcite (B3LYP) stiffness, upper triangle
//         162.859 63.582 60.233 0 20.670 0 / 162.859 60.233 0 −20.670 0 / 89.647 0 0 0 / 36.640 0 −20.670 /
//         36.640 0 / 49.638 GPa → "Voigt | 87.0512 | 104.0720 | 40.0047 | 0.300746; Reuss | 79.1474 | 81.0336 |
//         30.4784 | 0.329361; Hill | 83.0993 | 92.6302 | 35.2416 | 0.314218" (K, E, G GPa; ν).
//  [KOR]  Korth calcite: C11 144, C12 53.9, C13 51.1, C14 20.5, C33 84, C44 33.5 GPa; "Shear Modulus 32 GPa";
//         "Bulk Modulus 129.6 GPa"; "Poisson Ratio 0.31".
//  [CRY]  Crystran fused silica: E 73.1, G 31.2, K 36.7 GPa, ν 0.17 (an isotropic glass: E = 2G(1+ν) = 3K(1−2ν)).
// Passing these tests is not a measurement of any powder.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { symmetric6, trigonalStiffness, voigtReussHill, uniaxialConductivityBounds, uniaxialCteAverage, CALCITE_KORTH } from "../lib/conkay/knowledge/crystal-elasticity.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const QNT = symmetric6([[162.859, 63.582, 60.233, 0, 20.670, 0], [162.859, 60.233, 0, -20.670, 0], [89.647, 0, 0, 0], [36.640, 0, -20.670], [36.640, 0], [49.638]]);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

describe("[QNT] Voigt–Reuss–Hill reproduces the published calcite example", () => {
  it("the input and the table are the quoted ones", () => {
    const ex = DOCUMENTS["quantas-calcite-vrh"].excerpt;
    assert.ok(ex.includes("Voigt | 87.0512 | 104.0720 | 40.0047 | 0.300746"));
    assert.ok(ex.includes("Hill | 83.0993 | 92.6302 | 35.2416 | 0.314218"));
  });
  it("all twelve values to the table's last printed digit", () => {
    const v = voigtReussHill(QNT);
    const table = { voigt: [87.0512, 104.0720, 40.0047, 0.300746], reuss: [79.1474, 81.0336, 30.4784, 0.329361], hill: [83.0993, 92.6302, 35.2416, 0.314218] };
    for (const [k, [K, E, G, nu]] of Object.entries(table)) {
      near(v[k].K, K, 5e-5); near(v[k].E, E, 5e-5); near(v[k].G, G, 5e-5); near(v[k].nu, nu, 5e-7);
    }
  });
  it("an isotropic stiffness returns itself under all three averages", () => {
    const E = 70, nu = 0.25, l = (E * nu) / ((1 + nu) * (1 - 2 * nu)), m = E / (2 * (1 + nu));
    const v = voigtReussHill(symmetric6([[l + 2 * m, l, l, 0, 0, 0], [l + 2 * m, l, 0, 0, 0], [l + 2 * m, 0, 0, 0], [m, 0, 0], [m, 0], [m]]));
    for (const k of ["voigt", "reuss", "hill"]) { near(v[k].E, E, 1e-9); near(v[k].nu, nu, 1e-12); }
  });
  it("rejects an unstable, asymmetric or malformed matrix", () => {
    const bad = symmetric6([[1, 2, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0], [1, 0], [1]]);
    assert.equal(voigtReussHill(bad).stable, false);
    const asym = QNT.map((r) => [...r]); asym[0][1] += 1;
    assert.throws(() => voigtReussHill(asym), /not symmetric/);
    assert.throws(() => voigtReussHill([[1]]), /6×6/);
    assert.throws(() => trigonalStiffness({ C11: 1 }), /missing/);
    assert.throws(() => uniaxialConductivityBounds({ kPara: 0, kPerp: 1 }));
    assert.throws(() => uniaxialCteAverage({ alphaPara: NaN, alphaPerp: 0 }));
  });
});

describe("[KOR][CRY] the sourced filler data, checked against themselves", () => {
  it("Korth calcite: Hill G matches the stated 32 GPa; the stated bulk modulus does not match the constants", () => {
    const v = voigtReussHill(trigonalStiffness(CALCITE_KORTH));
    near(v.hill.G, 32, 0.05);
    assert.ok(v.voigt.K < 80 && 129.6 / v.voigt.K > 1.6, "129.6 GPa is not the constants' bulk modulus");
    assert.ok(DOCUMENTS["korth-calcite"].excerpt.includes("Bulk Modulus 129.6 GPa"));
    assert.ok(v.voigt.nu < 0.31 && v.reuss.nu > 0.31, "Korth's 0.31 lies inside the Voigt–Reuss band");
  });
  it("Crystran fused silica is a consistent isotropic set: E = 2G(1+ν) and E = 3K(1−2ν) within rounding", () => {
    near(2 * 31.2 * 1.17, 73.1, 0.2);
    near(3 * 36.7 * (1 - 0.34), 73.1, 0.6);
  });
  it("uniaxial conductivity bounds and expansion average (hand)", () => {
    const b = uniaxialConductivityBounds({ kPara: 5.526, kPerp: 4.646 });
    near(b.upper, (2 * 4.646 + 5.526) / 3, 1e-12);
    near(b.lower, 3 / (2 / 4.646 + 1 / 5.526), 1e-12);
    near(uniaxialCteAverage({ alphaPara: 25e-6, alphaPerp: -5.8e-6 }), (25 - 11.6) / 3 * 1e-6, 1e-18);
  });
});

describe("material.crystal-aggregate solver", () => {
  it("is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "material.crystal-aggregate");
    for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });
  it("computes on a crystal node, and refuses without a source or with an unstable matrix", () => {
    const run = (crystal) => openDesign({ nodes: [{ id: "X", kind: "Material", props: { crystal } }] }).session.result("material.crystal-aggregate@X");
    const ok = run({ stiffnessGPa: QNT, conductivity: { kPara: 5.526, kPerp: 4.646 }, expansion: { alphaPara: 25e-6, alphaPerp: -5.8e-6 }, source: "Quantas tutorial" });
    assert.equal(ok.status, "WARN");
    near(ok.outputs.elastic.value.hill.E, 92.6302, 5e-5);
    assert.equal(run({ stiffnessGPa: QNT }).status, "NOT_COMPUTED");
    assert.equal(run({ trigonal: { C11: 1, C12: 2, C13: 0, C14: 0, C33: 1, C44: 1 }, source: "x" }).status, "NOT_COMPUTED");
  });
});
