// Blend D brief item 3: stiffness and strength screening models.
//
// Published values (quoted with locators; the models compute, the tables check):
//
//  [J22] Jeon, Yun, Kang, Strek. "Analysis of Elastic Properties of Al/PET Isotropic Composite Materials Using
//        Finite Element Method", Materials 2022, 15(22), 8007, doi:10.3390/ma15228007 (PMC9697667).
//        Table 1: PET E 3.700 GPa, ν 0.440; Al powder E 68.950 GPa, ν 0.330 (spheres, 1 µm).
//        Table 4 (E, GPa) at AP VF 5/10/20/30/40/50/60/70 %:
//          FEM          4.113 4.583 5.773 7.400 8.141 8.197 8.216 8.282
//          Reuss        3.884 4.087 4.564 5.167 5.954 7.023 8.561 10.961
//          Halpin-Tsai  4.195 4.737 5.988 7.527 9.465 11.982 15.382 20.228
//        These are the Halpin–Tsai worked cases (Halpin & Kardos 1976, Polym. Eng. Sci. 16:344, was not read:
//        paywalled; no number here is taken from it).
//
//  [S21] Serra-Parareda, Vilaseca, Espinach, Mutjé, Delgado-Aguilar. "Stiffening Potential of Lignocellulosic
//        Fibers in Fully Biobased Composites: The Case of Abaca Strands, Spruce TMP Fibers, Recycled Fibers from
//        ONP, and Barley TMP Fibers", Polymers 2021, 13(4), 619, doi:10.3390/polym13040619 (PMC7921958).
//        Eqs. 6–10 (Tsai–Pagano with Halpin–Tsai); Table 2: BioPE E 1.06 GPa and composite E (GPa) at V_f;
//        Table 3: fibre l, d and E_tf—TP/HT back-calculated by the authors. Forward closure: the model with their
//        E_tf must return their measured composite modulus.
//
//  [P20] "Effect of Adhesion on Mechanical and Tribological Properties of Glass Fiber Composites, Based on
//        Ultra-High Molecular Weight Polyethylene Powders with Various Initial Particle Sizes", Materials 2020,
//        13(7), 1602, doi:10.3390/ma13071602 (PMC7178297). Table 2: milled glass fibre 200 µm, AR 20; chopped
//        3 mm, AR 300. Tables 3–5: neat and 10 % glass composites' elastic modulus (MPa), densities.
//        A UHMWPE matrix (no HDPE/glass-fibre dataset with stated fibre geometry was found open access).
//        E-glass modulus 70–72 GPa, density 2.54–2.58 g/cm3: Materials 2026, 19(14), 3006, Table 1 (E 70 GPa,
//        ρ 2.54); Materials 2026, 19(18), 3822, Table 1 (E 70 GPa, ρ 2.55); Polymers 2026, 18(13), 1628,
//        Table 3 (E 72 GPa, ρ 2.58).
//
//  [T20] Tarani, Chrysafi, Kállay-Menyhárd, Pavlidou, Kehagias, Bikiaris. "Influence of Graphene Platelet Aspect
//        Ratio on the Mechanical Properties of HDPE Nanocomposites", Polymers 2020, 12(8), 1719,
//        doi:10.3390/polym12081719 (PMC7463753). §2 Materials: HDPE 0.955 g/cm3; xGnP M5/M15/M25, 8 nm thick,
//        5/15/25 µm, 2.2 g/cm3. §3: Young's moduli of HDPE/M5, M15, M25 "show a substantial increase by about
//        100%, 55%, and 65%, respectively, with increasing the GNP content at 5 wt.%"; "Voigt model, Reuss model,
//        and Halpin–Tsai model ... cannot predict the HDPE/GNP nanocomposites well".
//
//  [D17] Del Rey, Serrat, Alba, Perez, Mutjé. "Effect of Sodium Hydroxide Treatments on the Tensile Strength and
//        the Interphase Quality of Hemp Core Fiber-Reinforced Polypropylene Composites", Polymers 2017, 9(8), 377,
//        doi:10.3390/polym9080377 (PMC6418906). §3.2 eqs. 2–5 (modified Kelly–Tyson), eq. 9 (critical length).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { voigt, reuss, halpinTsai, halpinTsaiOriented, moriTanakaSpheres, criticalLength, kellyTyson, bulkShear } from "../lib/conkay/knowledge/micromechanics.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText, MATERIAL_IR_SCHEMA } from "../lib/conkay/knowledge/material-ir.js";
import { MORI_TANAKA_MAX_PHI } from "../lib/conkay/physics/solvers/material-stiffness.js";

describe("[J22] Halpin–Tsai and Reuss worked cases, Mori–Tanaka against random-sphere FEM", () => {
  const VF = [5, 10, 20, 30, 40, 50, 60, 70];
  const FEM = [4.113, 4.583, 5.773, 7.400, 8.141, 8.197, 8.216, 8.282];
  const REUSS = [3.884, 4.087, 4.564, 5.167, 5.954, 7.023, 8.561, 10.961];
  const HT = [4.195, 4.737, 5.988, 7.527, 9.465, 11.982, 15.382, 20.228];
  it("Reuss and Halpin–Tsai (spheres, ξ = 2) reproduce Table 4 to its printed 0.001 GPa at all eight fractions", () => {
    VF.forEach((v, i) => {
      const p = v / 100;
      assert.ok(Math.abs(reuss([{ phi: 1 - p, E: 3.7 }, { phi: p, E: 68.95 }]) - REUSS[i]) <= 0.0005, `Reuss ${v} %`);
      assert.ok(Math.abs(halpinTsai({ Em: 3.7, Ef: 68.95, phi: p, xi: 2 }) - HT[i]) <= 0.0005, `HT ${v} %`);
    });
  });
  it(`Mori–Tanaka is within 9 % of the FEM up to ${MORI_TANAKA_MAX_PHI * 100} vol % (its declared range) and leaves it past the packing limit`, () => {
    VF.forEach((v, i) => {
      const E = moriTanakaSpheres({ Em: 3.7, num: 0.44, Ef: 68.95, nuf: 0.33, phi: v / 100 }).E;
      const dev = E / FEM[i] - 1;
      if (v / 100 <= MORI_TANAKA_MAX_PHI) assert.ok(Math.abs(dev) <= 0.09, `${v} %: ${(dev * 100).toFixed(1)} %`);
      if (v >= 50) assert.ok(dev > 0.25, `${v} %: the FEM saturates (random packing), the model does not`);
    });
  });
  it("Mori–Tanaka equals the Hashin–Shtrikman lower bound for a stiffer filler (bulk modulus identity)", () => {
    const m = bulkShear(3.7, 0.44), f = bulkShear(68.95, 0.33), p = 0.2;
    const hsK = m.K + p / (1 / (f.K - m.K) + (3 * (1 - p)) / (3 * m.K + 4 * m.G));
    assert.ok(Math.abs(moriTanakaSpheres({ Em: 3.7, num: 0.44, Ef: 68.95, nuf: 0.33, phi: p }).K - hsK) < 1e-9);
  });
});

describe("[S21] Tsai–Pagano / Halpin–Tsai forward closure on 12 natural-fibre / BioPE composites", () => {
  const rows = [
    ["abaca", 0.104, 1062, 22.3, 43.8, 2.49], ["abaca", 0.220, 966, 22.6, 39.5, 3.96], ["abaca", 0.350, 917, 22.4, 38.0, 5.81],
    ["spruce", 0.116, 861, 25.2, 26.9, 2.15], ["spruce", 0.242, 792, 25.7, 25.4, 3.26], ["spruce", 0.379, 743, 25.4, 24.2, 4.65],
    ["recycled", 0.114, 805, 21.4, 23.6, 2.05], ["recycled", 0.237, 746, 21.3, 21.7, 3.09], ["recycled", 0.373, 684, 21.4, 20.7, 4.32],
    ["barley", 0.111, 596, 18.3, 18.1, 1.85], ["barley", 0.233, 503, 18.5, 15.8, 2.59], ["barley", 0.367, 387, 18.7, 15.4, 3.55],
  ];
  it("returns the measured composite modulus within 2.5 % (the tables' rounding of E_tf, l and d)", () => {
    for (const [n, vf, l, d, Ef, Ec] of rows) {
      const E = halpinTsaiOriented({ Em: 1.06, Ef, phi: vf, aspect: l / d }).randomInPlane;
      assert.ok(Math.abs(E / Ec - 1) <= 0.025, `${n} V_f ${vf}: ${E.toFixed(3)} vs ${Ec}`);
    }
  });
});

describe("[P20] glass fibre in polyethylene: the transverse–aligned band brackets every measured modulus", () => {
  const tables = [
    ["GUR 2122 (Table 3)", 0.928, 711, [["MGF", 20, 1125], ["MGF+KH550", 20, 1154], ["LGF", 300, 1038], ["LGF+KH550", 300, 1463]]],
    ["GUR 4120 (Table 4)", 0.924, 624, [["MGF", 20, 907], ["MGF+KH550", 20, 857], ["LGF", 300, 1077], ["LGF+KH550", 300, 1094]]],
    ["GUR 4022-6 (Table 5)", 0.938, 826, [["MGF", 20, 989], ["MGF+KH550", 20, 1003], ["LGF", 300, 1041], ["LGF+KH550", 300, 1149]]],
  ];
  it("all 12 composites (10 % glass) fall inside [E22, E11]; the random-in-plane value is reported, not tuned", () => {
    const report = [];
    for (const [g, rho, Em, cs] of tables) {
      for (const [n, ar, meas] of cs) {
        const phiLo = (10 / 2.58) / (10 / 2.58 + 90 / rho), phiHi = (10 / 2.54) / (10 / 2.54 + 90 / rho);
        const lo = halpinTsaiOriented({ Em, Ef: 70000, phi: phiLo, aspect: ar });
        const hi = halpinTsaiOriented({ Em, Ef: 72000, phi: phiHi, aspect: ar });
        assert.ok(meas >= lo.E22 && meas <= hi.E11, `${g} ${n}: ${meas} outside [${lo.E22.toFixed(0)}, ${hi.E11.toFixed(0)}]`);
        report.push({ g, n, err: lo.randomInPlane / meas - 1 });
      }
    }
    // milled fibres (AR 20): random in plane within ~25 %; chopped (nominal AR 300 before compounding) over-predicts by
    // 40–75 %: the stated length is the fibre as supplied, and attrition in processing is not in the model
    for (const r of report.filter((x) => x.n.startsWith("MGF"))) assert.ok(Math.abs(r.err) < 0.25, `${r.g} ${r.n} ${(r.err * 100).toFixed(0)} %`);
    for (const r of report.filter((x) => x.n.startsWith("LGF"))) assert.ok(r.err > 0.1, `${r.g} ${r.n} over-predicts: ${(r.err * 100).toFixed(0)} %`);
  });
});

describe("[T20] HDPE / graphene nanoplatelets at 5 wt %", () => {
  const phi = (5 / 2.2) / (5 / 2.2 + 95 / 0.955);
  const measured = [["M5", 5000, 2.00], ["M15", 15000, 1.55], ["M25", 25000, 1.65]];
  it("the band (effective modulus, transverse … supplier in-plane, aligned) brackets the measured ratios — and it is wide", () => {
    for (const [n, D, meas] of measured) {
      const a = D / 8;
      const lo = halpinTsaiOriented({ Em: 1410, Ef: 25000, phi, aspect: a }).E22 / 1410;
      const hi = halpinTsaiOriented({ Em: 970, Ef: 1e6, phi, aspect: a }).E11 / 970;
      assert.ok(meas >= lo && meas <= hi, `${n}: ${meas} outside [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
      assert.ok(hi / meas > 6, `${n}: the supplier-modulus aligned bound over-predicts by more than 6×, as the paper says Halpin–Tsai cannot predict these well`);
    }
  });
  it("no single nominal fits: the effective-modulus random-in-plane estimate under-predicts every point", () => {
    for (const [n, D, meas] of measured) {
      const r = halpinTsaiOriented({ Em: 1190, Ef: 32500, phi, aspect: D / 8 }).randomInPlane / 1190;
      assert.ok(r < meas, `${n}: ${r.toFixed(3)} vs ${meas}`);
    }
  });
});

describe("[D17] modified Kelly–Tyson", () => {
  const base = { d: 15e-6, sigmaF: 3000e6, tau: 10e6, sigmaMStar: 20e6, chi1: 1 };
  it("critical length l_c = d·σ_f/(2τ)", () => {
    assert.ok(Math.abs(criticalLength(base) - (15e-6 * 3000e6) / (2 * 10e6)) < 1e-15);
  });
  it("long fibres approach the rule of mixtures; a fibre at l = l_c carries half its strength; short fibres carry τ·l/d", () => {
    const lc = criticalLength(base);
    const long = kellyTyson({ ...base, fibres: [{ l: 1e4 * lc, V: 0.1 }] });
    assert.ok(Math.abs(long.sigmaC - (0.1 * 3000e6 + 0.9 * 20e6)) / long.sigmaC < 1e-4);
    const atLc = kellyTyson({ ...base, fibres: [{ l: lc, V: 0.1 }] });
    assert.ok(Math.abs(atLc.Y - 0.1 * 3000e6 * 0.5) < 1e-3);
    const short = kellyTyson({ ...base, fibres: [{ l: lc / 2, V: 0.1 }] });
    assert.ok(Math.abs(short.X - (10e6 * (lc / 2) * 0.1) / 15e-6) < 1e-3);
    assert.ok(Math.abs(short.X - 0.1 * 3000e6 * 0.25) < 1e-3, "τ·l/d at l = l_c/2 is a quarter of the fibre strength");
  });
  it("refuses invalid inputs", () => {
    assert.throws(() => criticalLength({ d: 15e-6, sigmaF: 3000e6, tau: 0 }), /must be > 0/);
    assert.throws(() => kellyTyson({ ...base, chi1: 1.2, fibres: [{ l: 1e-3, V: 0.1 }] }), /χ1/);
    assert.throws(() => kellyTyson({ ...base, fibres: [{ l: -1, V: 0.1 }] }), /length > 0/);
    assert.throws(() => halpinTsai({ Em: 1, Ef: 10, phi: 1.5, xi: 2 }), /φ in \[0, 1\]/);
    assert.throws(() => voigt([{ phi: 0.6, E: 1 }, { phi: 0.6, E: 2 }]), /sum to 1/);
    assert.throws(() => moriTanakaSpheres({ Em: 1, num: 0.5, Ef: 10, nuf: 0.3, phi: 0.1 }), /ν < 0.5/);
  });
  it("Voigt ≥ Halpin–Tsai ≥ Reuss, and Halpin–Tsai tends to each bound as ξ → ∞ and ξ → 0", () => {
    const ph = [{ phi: 0.8, E: 1 }, { phi: 0.2, E: 70 }];
    const v = voigt(ph), r = reuss(ph);
    for (const xi of [0, 2, 40, 1e9]) {
      const h = halpinTsai({ Em: 1, Ef: 70, phi: 0.2, xi });
      assert.ok(h <= v + 1e-9 && h >= r - 1e-9);
    }
    assert.ok(Math.abs(halpinTsai({ Em: 1, Ef: 70, phi: 0.2, xi: 1e12 }) - v) < 1e-6);
    assert.ok(Math.abs(halpinTsai({ Em: 1, Ef: 70, phi: 0.2, xi: 0 }) - r) < 1e-9);
  });
});

describe("material.* stiffness and strength solvers", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const blend = materialIrFromText(text, meta);
  it("are registered with their declared regime, units, tolerance and screening", () => {
    for (const id of ["material.modulus-bounds", "material.modulus-halpin-tsai", "material.modulus-mori-tanaka", "material.tensile-bounds"]) {
      const s = listSolvers().find((x) => x.id === id);
      assert.ok(s, id);
      for (const k of ["regime", "units", "tolerance"]) assert.ok(s[k], `${id}.${k}`);
      assert.equal(s.screening, true);
    }
  });
  it("Blend D: every one is NOT_COMPUTED, listing every missing input at once", () => {
    const s = openDesign({ nodes: [{ id: "B", kind: "Material", props: { formulation: blend, micromechanics: { filler: "basalt-fiber", shape: "fibre" } } }] }).session;
    const b = s.result("material.modulus-bounds@B");
    assert.equal(b.status, "NOT_COMPUTED");
    assert.match(b.reason, /no cited density for hdpe-hc-co-polymer/);
    assert.match(b.reason, /no cited Young's modulus for: hdpe-hc-co-polymer$/);
    const ht = s.result("material.modulus-halpin-tsai@B");
    assert.match(ht.reason, /two-phase/);
    assert.match(ht.reason, /no aspect ratio for basalt-fiber/);
    const kt = s.result("material.tensile-bounds@B");
    assert.match(kt.reason, /interfacial shear strength τ .* measured, never assumed/);
    assert.match(kt.reason, /fibre length after compounding/);
  });

  // a two-phase HDPE / E-glass material (volume basis) to run the solvers through
  const twoPhase = (fillerFrac, extra = {}) => ({
    schema: MATERIAL_IR_SCHEMA, id: "test:hdpe-glass", name: "HDPE + E-glass (test)", basis: "volume", basisNote: null, statedTotal: 100,
    nominal: { rule: { name: "stated" }, recordId: "t", fractions: [{ id: "hdpe", pct: 100 - fillerFrac }, { id: "glass", pct: fillerFrac }] },
    constituents: [
      { id: "hdpe", name: "HDPE", classId: "hdpe", fraction: { min: 100 - fillerFrac, max: 100 - fillerFrac }, properties: { density: { lo: 950, hi: 950 }, youngsModulus: { lo: 1.09e9, hi: 1.09e9 }, poisson: { lo: 0.41, hi: 0.41 }, ...extra.hdpe } },
      { id: "glass", name: "E-glass", classId: null, fraction: { min: fillerFrac, max: fillerFrac }, properties: { density: { lo: 2550, hi: 2550 }, youngsModulus: { lo: 70e9, hi: 72e9 }, poisson: { lo: 0.22, hi: 0.22 }, tensileStrength: { lo: 2000e6, hi: 2600e6 }, diameter: { lo: 13e-6, hi: 13e-6 }, ...extra.glass } },
    ],
  });
  const run = (ir, micro) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir, micromechanics: micro } }] }).session;

  it("bounds and Halpin–Tsai compute on a two-phase material; the measured HDPE/glass moduli of [S21] Table 2 sit inside the band", () => {
    // [S21] Table 2: HDPE 1.09 GPa; 10/20/30 wt % glass at V_f 0.041/0.089/0.143 → 2.25/3.67/5.21 GPa. The paper does
    // not state the glass fibres' length after compounding, so the aspect ratio is a band here, labelled as an input.
    for (const [vf, meas] of [[4.1, 2.25e9], [8.9, 3.67e9], [14.3, 5.21e9]]) {
      const s = run(twoPhase(vf), { filler: "glass", shape: "fibre", aspectRatio: { lo: 10, hi: 50 } });
      const r = s.result("material.modulus-halpin-tsai@M");
      assert.equal(r.status, "WARN");
      const m = r.outputs.modulus.value;
      assert.ok(meas >= m.transverseLow && meas <= m.alignedHigh, `V_f ${vf} %: ${meas} outside [${m.transverseLow}, ${m.alignedHigh}]`);
      const b = s.result("material.modulus-bounds@M").outputs;
      assert.ok(b.reuss.value.low <= m.transverseLow && m.alignedHigh <= b.voigt.value.high);
    }
  });
  it("Mori–Tanaka: spheres only, Poisson ratios required, and out of its φ range it WARNs, never PASSes", () => {
    const fibre = run(twoPhase(10), { filler: "glass", shape: "fibre", aspectRatio: 20 }).result("material.modulus-mori-tanaka@M");
    assert.equal(fibre.status, "NOT_COMPUTED");
    assert.match(fibre.reason, /spherical fillers only/);
    const noNu = run(twoPhase(10, { glass: { poisson: null } }), { filler: "glass", shape: "sphere" }).result("material.modulus-mori-tanaka@M");
    assert.match(noNu.reason, /no cited Poisson's ratio for: glass/);
    const ok = run(twoPhase(10), { filler: "glass", shape: "sphere" }).result("material.modulus-mori-tanaka@M");
    assert.equal(ok.status, "WARN");
    assert.ok(ok.outputs.modulus.value.nominal > 1.09e9);
    const over = run(twoPhase(40), { filler: "glass", shape: "sphere" }).result("material.modulus-mori-tanaka@M");
    assert.notEqual(over.status, "PASS");
    assert.ok(over.warnings.some((w) => /out of range, never PASS/.test(w)));
  });
  it("Kelly–Tyson needs τ, the fibre length, σ_m* and χ1; with them it returns a band and the critical length", () => {
    const none = run(twoPhase(10), { filler: "glass", shape: "fibre" }).result("material.tensile-bounds@M");
    assert.equal(none.status, "NOT_COMPUTED");
    for (const re of [/interfacial shear strength/, /fibre length after compounding/, /σ_m\*/, /χ1/]) assert.match(none.reason, re);
    const r = run(twoPhase(10), { filler: "glass", shape: "fibre", fibreLengthM: { lo: 0.3e-3, hi: 0.6e-3 }, interfacialShearStrengthPa: 12e6, matrixStressAtFailurePa: 18e6, orientationFactor: 0.3 }).result("material.tensile-bounds@M");
    assert.equal(r.status, "WARN");
    const s = r.outputs.strength.value;
    assert.ok(s.low <= s.nominal && s.nominal <= s.high);
    assert.ok(r.outputs.criticalLength.value.nominal > 0);
  });
});
