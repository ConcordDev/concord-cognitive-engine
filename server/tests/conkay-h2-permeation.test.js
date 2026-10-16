// Blend D brief item 6: hydrogen permeation and the barrier verdict.
//
//  [D23] Dong, Liu, Li, Bin, Zhou, Han, Li. "Hydrogen Permeability of Polyamide 6 Used as Liner Material for Type IV
//        On-Board Hydrogen Storage Cylinders", Polymers 2023, 15(18), 3715, doi:10.3390/polym15183715 (PMC10534423).
//        eq. 2 D = l²/(6θ). Table 1 (PA6 P_e, cm³·cm/(cm²·s·Pa), 15 MPa): 308 K 4.31e-14 (ln −30.78); 328 K 9.75e-14
//        (ln −29.96); 358 K 3.34e-13 (ln −28.73). Table 4 (288 K, 70 MPa): PA6 P 1.72e-14, D 2.19e-7, S 7.85e-8;
//        PA11 1.87e-14, 2.43e-7, 7.71e-8; HDPE 5.88e-14, 9.73e-7, 6.05e-8. Table A1 (PA6, d 0.35 cm): lag
//        93,294.93 / 91,585.05 / 95,506.73 / 100,770.25 / 91,578.86 s → D 2.188 / 2.229 / 2.138 / 2.026 / 2.229 e-7,
//        P_e 1.714 / 1.701 / 1.725 / 1.757 / 1.708 e-14, S 7.832 / 7.634 / 8.068 / 8.670 / 7.663 e-8.
//  [L23] Li, Huang, Liu, Zhao, Li. Materials 2023, 16(15), 5366, doi:10.3390/ma16155366 (PMC10420304). §1 ¶2:
//        ISO 19881 "less than 46 NmL/(h·L) at 1.15 times the nominal working pressure (NWP) and 55 °C, and less
//        than 6 NmL/(h·L) at the NWP and 15 °C". Table 5 (T/CATSI 02 007): "At 15 °C, P_e ≤ 1 × 10−13 … At 55 °C,
//        P_e ≤ 1 × 10−12" cm³·cm/(cm²·s·Pa).
//  [M25] Merlonghi et al., Membranes 2025, 15(3), 76, eq. 12: Nielsen tortuosity τ = 1 + (α/2)φ.
//  [G17] Gaska et al., Polymers 2017, 9(7), 294 (aligned LDPE / xGnP M5): CO2 permeation "decreased by 34.7% for
//        sample filled with 1 wt % of GnP" and "65.5% reduction" at the highest (7.5 wt %).
//  Not read: Sandia's Technical Reference for Hydrogen Compatibility of Materials (polymers) — no HDPE activation
//  energy is taken from it or from anywhere: HDPE above 288 K stays NOT computed unless a measured Ep is supplied.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timeLagDiffusivity, activationEnergy, arrheniusPermeability, nielsenRatio, wallLeakRate, DONG_2023_TABLE4, H2_LIMITS, TYPE_IV_NOTE } from "../lib/conkay/knowledge/h2-permeation.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText, PE_FAMILY_SPAN } from "../lib/conkay/knowledge/material-ir.js";

describe("[D23] Dong et al. 2023 reproduced", () => {
  it("Table A1: D = l²/(6θ) for all five periods (to the table's 4 figures)", () => {
    const rows = [[93294.93, 2.188e-7], [91585.05, 2.229e-7], [95506.73, 2.138e-7], [100770.25, 2.026e-7], [91578.86, 2.229e-7]];
    const Ds = rows.map(([lag, D]) => { const d = timeLagDiffusivity({ thicknessCm: 0.35, lagS: lag }); assert.ok(Math.abs(d / D - 1) < 5e-4, `${lag}: ${d}`); return d; });
    // Reported, not hidden: the mean of the five reproduced D is 2.162e-7, while the paper's "Average value" (and
    // Table 4) prints 2.19e-7 — 1.3 % apart in the paper itself (the mean of the five printed D is 2.162e-7 too).
    const mean = Ds.reduce((a, b) => a + b, 0) / 5;
    assert.ok(Math.abs(mean - 2.162e-7) < 5e-10);
    assert.ok(Math.abs(mean / DONG_2023_TABLE4.PA6.D - 1) < 0.015);
  });
  it("S = P/D for every Table A1 period and for HDPE, PA6 and PA11 in Table 4", () => {
    for (const [P, D, S] of [[1.714e-14, 2.188e-7, 7.832e-8], [1.701e-14, 2.229e-7, 7.634e-8], [1.725e-14, 2.138e-7, 8.068e-8], [1.757e-14, 2.026e-7, 8.670e-8], [1.708e-14, 2.229e-7, 7.663e-8]]) {
      assert.ok(Math.abs(P / D / S - 1) < 1e-3, `${P}/${D}`);
    }
    for (const m of ["HDPE", "PA6", "PA11"]) {
      const r = DONG_2023_TABLE4[m];
      assert.ok(Math.abs(r.P / r.D / r.S - 1) < 3e-3, m);
    }
  });
  it("Table 1: ln P matches P; an Arrhenius fit through 308 K and 358 K gives Ep ≈ 37.5 kJ/mol and predicts 328 K within 9 % — reported", () => {
    for (const [P, lnP] of [[4.31e-14, -30.78], [9.75e-14, -29.96], [3.34e-13, -28.73]]) assert.ok(Math.abs(Math.log(P) - lnP) < 0.006);
    const Ep = activationEnergy([308, 4.31e-14], [358, 3.34e-13]);
    assert.ok(Math.abs(Ep - 37545) < 50, `${Ep}`);
    const p328 = arrheniusPermeability({ P: 4.31e-14, Tref: 308, Ep }, 328);
    assert.ok(Math.abs(p328 / 9.75e-14 - 1) < 0.09, `${p328}`);
    assert.ok(p328 > 9.75e-14, "the fit over-predicts the middle point: a single Ep is an approximation");
  });
});

describe("[L23] limits and the comparison they allow", () => {
  it("are the quoted values", () => {
    assert.deepEqual(H2_LIMITS.iso19881.map((l) => l.limitNmLPerHPerL), [6, 46]);
    assert.deepEqual(H2_LIMITS.tcatsi.map((l) => l.limitP), [1e-13, 1e-12]);
  });
  it("measured HDPE (5.88e-14) is under the 15 °C material limit; a leak rate needs the chamber, shown on a stated example", () => {
    assert.ok(DONG_2023_TABLE4.HDPE.P < 1e-13);
    // example chamber, not a design: 5 mm liner, 0.9 m² inner wall, 60 L, 70 MPa
    const q = wallLeakRate({ P: 5.88e-14, areaCm2: 9000, deltaPPa: 70e6, thicknessCm: 0.5 }) / 60;
    assert.ok(Math.abs(q - (5.88e-14 * 9000 * 70e6 / 0.5) * 3600 / 60) < 1e-12);
  });
});

describe("[M25]/[G17] Nielsen tortuosity is an upper bound on the barrier", () => {
  it("reduces to (1 − φ) at α → 0 and predicts more barrier than measured in aligned LDPE/xGnP", () => {
    assert.ok(Math.abs(nielsenRatio({ phi: 0.1, aspect: 1e-12 }) - 0.9) < 1e-9);
    const phiAt = (w) => [PE_FAMILY_SPAN.lo, PE_FAMILY_SPAN.hi].map((rho) => (w / 2200) / (w / 2200 + (100 - w) / rho));
    const alpha = 5000 / 7; // xGnP M5: 5 µm, 6–8 nm
    for (const [w, measuredRatio] of [[1, 1 - 0.347], [7.5, 1 - 0.655]]) {
      for (const phi of phiAt(w)) assert.ok(nielsenRatio({ phi, aspect: alpha }) < measuredRatio, `${w} wt %`);
    }
  });
  it("refuses invalid input", () => {
    assert.throws(() => nielsenRatio({ phi: 1, aspect: 10 }), /φ < 1/);
    assert.throws(() => timeLagDiffusivity({ thicknessCm: 0, lagS: 1 }), /> 0/);
    assert.throws(() => activationEnergy([300, 1e-14], [300, 2e-14]), /distinct/);
  });
});

describe("vessel.h2-permeation", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const blend = materialIrFromText(text, meta);
  const run = (props) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: blend, ...props } }] }).session.result("vessel.h2-permeation@M");
  it("is registered with its declared regime, units, tolerance and screening", () => {
    const s = listSolvers().find((x) => x.id === "vessel.h2-permeation");
    for (const k of ["regime", "units", "tolerance"]) assert.ok(s?.[k], k);
    assert.equal(s.screening, true);
  });
  it("Blend D: the HDPE matrix value stands in (labelled); 15 °C material level passes; 55 °C, the vessel and the platelet barrier are not computed; the Type IV verdict is stated", () => {
    const r = run({});
    assert.equal(r.status, "WARN");
    assert.match(r.inputs.permeability.source, /NOT the compound's/);
    const [m15, m55] = r.outputs.materialLevel.value;
    assert.equal(m15.pass, true);
    assert.equal(m55.pass, null);
    assert.match(m55.basis, /no activation energy/);
    assert.match(r.outputs.vesselLevel.value.reason, /geometry and working pressure are not given/);
    assert.match(r.outputs.plateletBarrier.value.reason, /no platelet aspect ratio/);
    assert.equal(r.outputs.verdict.value, TYPE_IV_NOTE);
    assert.match(TYPE_IV_NOTE, /liner .* carbon-fibre composite overwrap/);
    assert.ok(r.warnings.some((w) => /may lower it \(tortuosity\) or raise it \(voids/.test(w)));
  });
  it("with a stated chamber and a supplied Ep it computes both ISO 19881 points; a permeability without a source is refused", () => {
    const r = run({ h2Vessel: { linerThicknessM: 0.005, innerAreaM2: 0.9, waterVolumeL: 60, nwpPa: 70e6, activationEnergyJmol: { value: 37545, source: "test: PA6 Ep from Dong 2023 Table 1, NOT HDPE" } } });
    const [v15, v55] = r.outputs.vesselLevel.value;
    assert.ok(Math.abs(v15.rate - wallLeakRate({ P: 5.88e-14, areaCm2: 9000, deltaPPa: 70e6, thicknessCm: 0.5 }) / 60) < 1e-9);
    assert.ok(v55.rate > v15.rate);
    assert.equal(typeof v55.pass, "boolean");
    const bad = run({ h2Vessel: { permeability: { P: 1e-14, T: 288 } } });
    assert.equal(bad.status, "NOT_COMPUTED");
    assert.match(bad.reason, /needs its source/);
  });
});
