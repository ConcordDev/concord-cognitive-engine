// Blend D brief item 4: thermal screening (conductivity, CTE, transitions) and the "heat dissipation" verdict.
//
// Published values (quoted with locators; models compute, tables check):
//
//  [Y23] Yun, Jeon, Kang, Li, Zhang. "Effective Properties for the Design of Basalt Particulate–Polymer
//        Composites", Polymers 2023, 15(20), 4125, doi:10.3390/polym15204125 (PMC10610629).
//        Table 1 (inputs): density / CTE (1/K) / E (MPa) / ν / k (W/mK):
//          PP 0.90 / 104e-6 / 1660 / 0.35 / 0.17;  PA 1.10 / 8e-6 / 4000 / 0.34 / 0.39;
//          PA6 1.13 / 1.01e-4 / 2400 / 0.34 / 0.26;  PA66 1.140 / 85e-6 / 2690 / 0.30 / 0.26;
//          Basalt 2.75 / 8e-6 / 89,000 / 0.20 / 0.035.
//        Table 2 (FEA, 35 vol % basalt): CTE / k: PP 62.91e-6 / 0.115; PA6 60.86e-6 / 0.164;
//          PA66 50.02e-6 / 0.166; PA 8.00e-6 / 0.239.
//  [B24] Bleija, Platnieks, Starkova, Macutkevič, et al. "Evaluation of thermal conductivity models and dielectric
//        properties in metal oxide-filled poly(butylene succinate-co-adipate) composites", Sci. Rep. 2024, 14, 13629,
//        doi:10.1038/s41598-024-64426-5 (PMC11176320). Table 3 (model equations); §3: matrix 0.209 W/mK, fillers
//        6 (Fe2O3), 5 (Fe3O4), 10 (NiFe2O4) W/mK; Lewis–Nielsen spheres A = 1.5, V_fmax = 0.6. Table 2 ("This
//        work"): Fe2O3 28 vol % 0.524, 46 vol % 0.903; Fe3O4 25 vol % 0.471, 40 vol % 0.59; NiFe2O4 19 vol % 0.339.
//        (Lewis & Nielsen 1970 itself was not read: paywalled.)
//  [E20] Evgin, Turgut, Hamaoui, et al. Beilstein J. Nanotechnol. 2020, 11, 167, doi:10.3762/bjnano.11.14
//        (PMC7006480): pure HDPE 0.386 W/mK; at 13.92 vol % GnP 0.521 / 0.625 / 0.729 W/mK (G1 / G3 / G2);
//        "increased linearly"; "No thermal percolation threshold was observed"; electrical percolation
//        5.52 vol % (G2) and 7.38 vol % (G3).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maxwellK, lewisNielsenK, cteTurner, cteSchapery, hsBulkBounds } from "../lib/conkay/knowledge/thermal-models.js";
import { bulkShear } from "../lib/conkay/knowledge/micromechanics.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText, MATERIAL_IR_SCHEMA } from "../lib/conkay/knowledge/material-ir.js";
import { EVGIN_2020, LN_SPHERES } from "../lib/conkay/physics/solvers/material-thermal.js";

const BASALT = { alpha: 8e-6, E: 89000, nu: 0.2, k: 0.035 };
const Y23 = {
  PP: { alpha: 104e-6, E: 1660, nu: 0.35, k: 0.17, fea: { cte: 62.91e-6, k: 0.115 } },
  PA6: { alpha: 1.01e-4, E: 2400, nu: 0.34, k: 0.26, fea: { cte: 60.86e-6, k: 0.164 } },
  PA66: { alpha: 85e-6, E: 2690, nu: 0.30, k: 0.26, fea: { cte: 50.02e-6, k: 0.166 } },
  PA: { alpha: 8e-6, E: 4000, nu: 0.34, k: 0.39, fea: { cte: 8.00e-6, k: 0.239 } },
};

describe("[Y23] Maxwell and the CTE models against FEA (35 vol % basalt)", () => {
  it("Maxwell k is within 2 % of the FEA for all four matrices", () => {
    for (const [n, m] of Object.entries(Y23)) {
      const k = maxwellK({ km: m.k, kf: BASALT.k, phi: 0.35 });
      assert.ok(Math.abs(k / m.fea.k - 1) <= 0.02, `${n}: ${k.toFixed(4)} vs ${m.fea.k}`);
    }
  });
  it("the FEA CTE sits within 1 % of the Schapery upper bound; Turner is far below it (a soft matrix with stiff particles)", () => {
    for (const [n, m] of Object.entries(Y23)) {
      if (m.alpha === BASALT.alpha) continue; // PA: equal CTEs, every model returns 8e-6 — no test
      const a = bulkShear(m.E, m.nu), b = bulkShear(BASALT.E, BASALT.nu);
      const s = cteSchapery({ alphaM: m.alpha, alphaF: BASALT.alpha, Km: a.K, Gm: a.G, Kf: b.K, Gf: b.G, phi: 0.35 });
      assert.ok(Math.abs(m.fea.cte / s.high - 1) <= 0.01, `${n}: FEA ${m.fea.cte} vs upper ${s.high}`);
      assert.ok(m.fea.cte >= s.low);
      const t = cteTurner([{ phi: 0.65, alpha: m.alpha, K: a.K }, { phi: 0.35, alpha: BASALT.alpha, K: b.K }]);
      assert.ok(t < m.fea.cte / 3, `${n}: Turner ${t} vs FEA ${m.fea.cte}`);
    }
  });
});

describe("[B24] Maxwell and Lewis–Nielsen against measured oxide/PBSA conductivity (errors reported, not tuned)", () => {
  const rows = [["Fe2O3", 6, 0.28, 0.524], ["Fe2O3", 6, 0.46, 0.903], ["Fe3O4", 5, 0.25, 0.471], ["Fe3O4", 5, 0.40, 0.59], ["NiFe2O4", 10, 0.19, 0.339]];
  it("Lewis–Nielsen (A 1.5, φ_max 0.6) is within −17 … +14 %; Maxwell within −27 … +2 %", () => {
    assert.equal(LN_SPHERES.A, 1.5);
    assert.equal(LN_SPHERES.phiMax, 0.6);
    for (const [n, kf, phi, meas] of rows) {
      const ln = lewisNielsenK({ km: 0.209, kf, phi, A: 1.5, phiMax: 0.6 }) / meas - 1;
      const mx = maxwellK({ km: 0.209, kf, phi }) / meas - 1;
      assert.ok(ln >= -0.17 && ln <= 0.14, `${n} ${phi}: LN ${(ln * 100).toFixed(1)} %`);
      assert.ok(mx >= -0.28 && mx <= 0.02, `${n} ${phi}: Maxwell ${(mx * 100).toFixed(1)} %`);
    }
  });
});

describe("identities and refusals", () => {
  it("Lewis–Nielsen with A = 2 and φ_max = 1 is Maxwell; Maxwell is the Hashin–Shtrikman lower bound for a more conductive filler", () => {
    for (const phi of [0.05, 0.2, 0.4]) {
      assert.ok(Math.abs(lewisNielsenK({ km: 0.4, kf: 30, phi, A: 2, phiMax: 1 }) - maxwellK({ km: 0.4, kf: 30, phi })) < 1e-12);
      const hs = 0.4 + phi / (1 / (30 - 0.4) + (1 - phi) / (3 * 0.4));
      assert.ok(Math.abs(maxwellK({ km: 0.4, kf: 30, phi }) - hs) < 1e-12);
    }
  });
  it("Turner and the Schapery bounds coincide for equal CTEs; HS bulk bounds bracket each other", () => {
    const a = bulkShear(1000, 0.4), b = bulkShear(70000, 0.22);
    const s = cteSchapery({ alphaM: 50e-6, alphaF: 50e-6, Km: a.K, Gm: a.G, Kf: b.K, Gf: b.G, phi: 0.2 });
    assert.ok(Math.abs(s.low - 50e-6) < 1e-18 && Math.abs(s.high - 50e-6) < 1e-18);
    const h = hsBulkBounds({ Km: a.K, Gm: a.G, Kf: b.K, Gf: b.G, phi: 0.2 });
    assert.ok(h.lower < h.upper);
  });
  it("refuses invalid input", () => {
    assert.throws(() => maxwellK({ km: 0, kf: 1, phi: 0.1 }), /> 0/);
    assert.throws(() => lewisNielsenK({ km: 0.2, kf: 6, phi: 0.6, A: 1.5, phiMax: 0.6 }), /below φ_max/);
    assert.throws(() => cteTurner([{ phi: 0.5, alpha: 1e-4, K: 1 }, { phi: 0.6, alpha: 1e-5, K: 2 }]), /sum to 1/);
  });
});

describe("thermal solvers", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const blend = materialIrFromText(text, meta);
  const run = (formulation, micromechanics) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation, ...(micromechanics ? { micromechanics } : {}) } }] }).session;
  it("are registered with their declared regime, units, tolerance and screening", () => {
    for (const id of ["material.k-maxwell-garnett", "material.k-lewis-nielsen", "material.cte-turner", "material.cte-schapery", "material.thermal-transitions", "material.heat-dissipation-screen"]) {
      const s = listSolvers().find((x) => x.id === id);
      assert.ok(s, id);
      for (const k of ["regime", "units", "tolerance"]) assert.ok(s[k], `${id}.${k}`);
      assert.equal(s.screening, true);
    }
  });

  it("Blend D: the two-phase models are NOT_COMPUTED with every reason; transitions are the HDPE matrix's own", () => {
    const s = run(blend, { filler: "caco3", shape: "sphere" });
    const mx = s.result("material.k-maxwell-garnett@M");
    assert.equal(mx.status, "NOT_COMPUTED");
    assert.match(mx.reason, /no cited density for hdpe-hc-co-polymer/);
    assert.match(mx.reason, /two-phase/);
    const tt = s.result("material.thermal-transitions@M");
    assert.equal(tt.status, "WARN");
    assert.deepEqual(tt.outputs.meltTemperature.value, { low: 403.15, high: 407.88 });
    assert.ok(tt.warnings.some((w) => /not the compound's/.test(w)));
    assert.ok(tt.warnings.some((w) => /co-polymer is unidentified/.test(w)));
  });

  it("Blend D 'heat dissipation': graphene below percolation, a single-digit percent gain, the claim not supported", () => {
    const r = run(blend).result("material.heat-dissipation-screen@M");
    assert.equal(r.status, "WARN");
    const phi = r.inputs.grapheneVolumeFraction.value;
    assert.match(r.inputs.grapheneVolumeFraction.basis, /conditional/);
    assert.ok(phi.lo > 0.012 && phi.hi < 0.016, JSON.stringify(phi));
    assert.equal(r.outputs.percolation.value.belowElectrical, true);
    const g = r.outputs.conductivityGain.value;
    // hand check: the lowest measured gain (G1, 0.521/0.386 − 1) and the highest (G2) scaled from 13.92 vol %
    assert.ok(Math.abs(g.low - ((0.521 / 0.386 - 1) * phi.lo) / 0.1392) < 1e-12);
    assert.ok(Math.abs(g.high - ((0.729 / 0.386 - 1) * phi.hi) / 0.1392) < 1e-12);
    assert.ok(g.high < 0.1, `${g.high}`);
    assert.match(r.outputs.verdict.value, /not supported by this evidence; measure k \(ASTM E1530\)/);
    assert.ok(r.warnings.some((w) => /A1: hdpe-hc-co-polymer assumed polyethylene-family/.test(w)));
    assert.equal(EVGIN_2020.kHdpe, 0.386);
  });

  it("on a two-phase material with cited inputs they compute (Y23 PP + basalt reproduced through the solvers)", () => {
    const ir = {
      schema: MATERIAL_IR_SCHEMA, id: "test:pp-basalt", name: "PP + basalt particles", basis: "volume", basisNote: null, statedTotal: 100,
      nominal: { rule: { name: "stated" }, recordId: "t", fractions: [{ id: "pp", pct: 65 }, { id: "basalt", pct: 35 }] },
      constituents: [
        { id: "pp", name: "PP", classId: null, fraction: { min: 65, max: 65 }, properties: { density: { lo: 900, hi: 900 }, youngsModulus: { lo: 1.66e9, hi: 1.66e9 }, poisson: { lo: 0.35, hi: 0.35 }, conductivity: { lo: 0.17, hi: 0.17 }, cte: { lo: 104e-6, hi: 104e-6 } } },
        { id: "basalt", name: "basalt", classId: null, fraction: { min: 35, max: 35 }, properties: { density: { lo: 2750, hi: 2750 }, youngsModulus: { lo: 89e9, hi: 89e9 }, poisson: { lo: 0.2, hi: 0.2 }, conductivity: { lo: 0.035, hi: 0.035 }, cte: { lo: 8e-6, hi: 8e-6 } } },
      ],
    };
    const s = run(ir, { filler: "basalt", shape: "sphere" });
    const k = s.result("material.k-maxwell-garnett@M");
    assert.equal(k.status, "WARN");
    assert.ok(Math.abs(k.outputs.conductivity.value.nominal / 0.115 - 1) <= 0.02);
    assert.ok(k.warnings.some((w) => /Kapitza/.test(w)));
    assert.equal(s.result("material.k-lewis-nielsen@M").inputs.A.value, 1.5);
    const cs = s.result("material.cte-schapery@M").outputs.cte.value;
    assert.ok(Math.abs(62.91e-6 / cs.high - 1) <= 0.01);
    const platelet = run(ir, { filler: "basalt", shape: "platelet" }).result("material.k-lewis-nielsen@M");
    assert.match(platelet.reason, /only the sphere values are cited/);
  });
});
