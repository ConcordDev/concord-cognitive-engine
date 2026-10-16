// Blend D brief item 5: viscoelastic + impact screening.
//
//  [P15] Pacheco, Bavastri, Pereira. "Viscoelastic Relaxation Modulus Characterization Using Prony Series",
//        Lat. Am. J. Solids Struct. 2015, 12, 420–445. eqs. 11–14 (Prony + WLF, constant-rate stress);
//        Table 4 (1.0 /s; −35/23/80 °C): τ 0.517896 / 193.062086 / 10000 s → E 2524.9 / 2301.1 / 1021.0 MPa,
//        E∞ 2217.5 MPa, C1 10.0, C2 103.8183 °C, Ts −55.4621 °C, "Minimum error 0.3051 MPa²";
//        appendix Tables 7 (p.441, −35 °C), 9 (p.443, 23 °C), 11 (p.445, 80 °C), "Strain rate 1.0" columns.
//        Material: SABIC Stamax 30YM240 (30 % long-glass-fibre PP) — used here to verify the Prony/WLF code
//        against raw published data, not as an HDPE property.
//  [S25] Segura-Méndez et al., Polymers 2025, 17(4), 453, Table 6 (HDPE parallel Maxwell at 0.5/1/5/10 %).
//        Its relaxation curves are in figures only: the HDPE curve itself is not reproduced numerically here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relaxationModulus, constantRateStress, dynamicModuli, cycleEnergy, wlfShift, arrheniusShift, HDPE_PRONY_SEGURA_2025, HDPE_YIELD_STRAIN } from "../lib/conkay/knowledge/viscoelastic.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText, MATERIAL_IR_SCHEMA } from "../lib/conkay/knowledge/material-ir.js";

const P15 = { Einf: 2217.5, terms: [{ E: 2524.9, tau: 0.517896 }, { E: 2301.1, tau: 193.062086 }, { E: 1021.0, tau: 10000 }] };
const WLF = { C1: 10.0, C2: 103.8183, Ts: -55.4621 };
const DATA = {
  "-35": [[0.0, 0.0], [0.00025, 1.987724], [0.0005, 3.966243], [0.00075, 5.935549], [0.001, 7.895636], [0.001249, 9.846495], [0.001499, 11.788118], [0.001748, 13.720499], [0.001998, 15.643628], [0.002247, 17.5575], [0.002497, 19.462106], [0.005236, 39.79903], [0.007968, 59.003677], [0.010693, 77.065871], [0.01341, 92.784735], [0.015184, 87.351327], [0.016365, 92.131624]],
  23: [[0.0, 0.0], [0.00025, 1.287022], [0.0005, 2.568083], [0.00075, 3.84318], [0.001, 5.112307], [0.001249, 6.375459], [0.001499, 7.632632], [0.001748, 8.883819], [0.001998, 10.129018], [0.002247, 11.368221], [0.002497, 12.601425], [0.005236, 25.769282], [0.007968, 38.204006], [0.010693, 49.899009], [0.01341, 60.847702], [0.016119, 71.043497], [0.016857, 73.692634], [0.018822, 80.479805], [0.021517, 89.150038], [0.022739, 92.836022], [0.024205, 97.047607], [0.024693, 98.4]],
  80: [[0.0, 0.0], [0.00025, 0.833062], [0.0005, 1.663745], [0.00075, 2.492049], [0.001, 3.31797], [0.001249, 4.141507], [0.001499, 4.962658], [0.001748, 5.78142], [0.001998, 6.597791], [0.002247, 7.41177], [0.002497, 8.223354], [0.006479, 20.881299], [0.010445, 32.917063], [0.014396, 44.322065], [0.018331, 55.087725], [0.022251, 65.205464], [0.024693, 71.196215], [0.026155, 74.6667], [0.027615, 78.043658], [0.028587, 80.242781], [0.030044, 83.462854]],
};
const model = (T, eps) => constantRateStress(P15, { rate: 1.0, t: eps / 1.0, aT: wlfShift(WLF, Number(T)) });

describe("[P15] the Prony + WLF code against published raw tensile data (1.0 /s)", () => {
  it("23 °C and 80 °C: every point within 1.4 MPa (RMS 0.67 / 0.61 MPa against peaks of 98 / 83 MPa)", () => {
    for (const T of ["23", "80"]) {
      const res = DATA[T].map(([e, s]) => model(T, e) - s);
      const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
      assert.ok(Math.max(...res.map(Math.abs)) <= 1.4, `${T} °C max ${Math.max(...res.map(Math.abs))}`);
      assert.ok(rms <= 0.7, `${T} °C rms ${rms}`);
    }
  });
  it("−35 °C: within 0.3 MPa up to 1.07 % strain; the last three points follow a measured stress drop (damage) that no linear model follows — reported", () => {
    const pre = DATA["-35"].filter(([e]) => e <= 0.0107);
    for (const [e, s] of pre) assert.ok(Math.abs(model("-35", e) - s) <= 0.3, `ε ${e}`);
    const post = DATA["-35"].filter(([e]) => e > 0.0107);
    assert.ok(post[1][1] < post[0][1], "the published data drop after 1.34 %");
    assert.ok(model("-35", post[2][0]) - post[2][1] > 15, "the model keeps rising: outside linear viscoelasticity");
  });
  it("the paper's aggregate 'Minimum error 0.3051 MPa²' is NOT reproduced (mean squared error over all 60 points is larger) — recorded, not tuned", () => {
    const all = Object.entries(DATA).flatMap(([T, rows]) => rows.map(([e, s]) => (model(T, e) - s) ** 2));
    const mse = all.reduce((a, b) => a + b, 0) / all.length;
    assert.ok(mse > 0.3051 * 10, `${mse}`);
  });
});

describe("Prony identities and refusals", () => {
  it("E(0) = E∞ + ΣE_q, E(∞) = E∞; σ under a constant rate tends to ε̇(E∞ t + Σ E_q τ_q)", () => {
    assert.equal(relaxationModulus(P15, 0), 2217.5 + 2524.9 + 2301.1 + 1021.0);
    assert.ok(Math.abs(relaxationModulus(P15, 1e9) - 2217.5) < 1e-6);
    const big = 1e9;
    assert.ok(Math.abs(constantRateStress(P15, { rate: 1e-12, t: big }) - 1e-12 * (2217.5 * big + 2524.9 * 0.517896 + 2301.1 * 193.062086 + 1021.0 * 10000)) < 1e-9);
  });
  it("one Maxwell element: E″ peaks at ωτ = 1 with tan δ = 1/2·E/(E∞ + E/2); dissipated per cycle = π ε0² E″", () => {
    const p = { Einf: 100, terms: [{ E: 200, tau: 2 }] };
    const m = dynamicModuli(p, 0.5);
    assert.ok(Math.abs(m.loss - 100) < 1e-12 && Math.abs(m.storage - 200) < 1e-12);
    const c = cycleEnergy(p, { strainAmplitude: 0.01, omega: 0.5 });
    assert.ok(Math.abs(c.dissipatedPerCycle - Math.PI * 1e-4 * 100) < 1e-12);
    assert.ok(Math.abs(c.lossRatio - m.tanDelta) < 1e-12);
  });
  it("shift factors: WLF is 1 at Ts and Arrhenius is 1 at Tref; both refuse nonsense", () => {
    assert.equal(wlfShift(WLF, -55.4621), 1);
    assert.equal(arrheniusShift({ Ea: 1e5, Tref: 300 }, 300), 1);
    assert.throws(() => wlfShift({ C1: 10, C2: 50, Ts: 0 }, -60), /singular/);
    assert.throws(() => relaxationModulus({ Einf: 0, terms: [{ E: 1, tau: 0 }] }, 1), /τ_q > 0/);
    assert.throws(() => cycleEnergy(P15, { strainAmplitude: 0, omega: 1 }), /amplitude/);
  });
});

describe("[S25] the cited HDPE series", () => {
  it("is Table 6, and the modulus falls with strain: linearity is not shown even at 0.5 %", () => {
    const E0 = HDPE_PRONY_SEGURA_2025.sets.map((s) => s.terms.reduce((a, q) => a + q.E, 0));
    assert.deepEqual(E0.map((e) => Math.round(e / 1e5) / 10), [613.9, 519.7, 299.5, 208.1]);
    for (let i = 1; i < E0.length; i++) assert.ok(E0[i] < E0[i - 1]);
    assert.equal(HDPE_PRONY_SEGURA_2025.stepDurationS, 1000);
  });
});

describe("viscoelastic solvers", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const blend = materialIrFromText(text, meta);
  const hdpe = {
    schema: MATERIAL_IR_SCHEMA, id: "test:hdpe", name: "HDPE (unfilled)", basis: "mass", basisNote: null, statedTotal: 100,
    nominal: { rule: { name: "stated" }, recordId: "t", fractions: [{ id: "hdpe", pct: 100 }] },
    constituents: [{ id: "hdpe", name: "HDPE", classId: "hdpe", fraction: { min: 100, max: 100 }, properties: { density: { lo: 941, hi: 970 } } }],
  };
  const run = (formulation, props = {}) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation, ...props } }] }).session;

  it("are registered with their declared regime, units, tolerance and screening", () => {
    for (const id of ["material.viscoelastic-prony", "material.impact-recovery-screen"]) {
      const s = listSolvers().find((x) => x.id === id);
      for (const k of ["regime", "units", "tolerance"]) assert.ok(s?.[k], `${id}.${k}`);
      assert.equal(s.screening, true);
    }
  });
  it("Blend D: the compound's series is unknown (NOT_COMPUTED) — the HDPE matrix reference is attached and labelled as not the compound", () => {
    const r = run(blend).result("material.viscoelastic-prony@M");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /unknown until a DMA \/ stress-relaxation test of the compound/);
    assert.match(r.outputs.hdpeMatrixReference.note, /NOT the compound's/);
    const i = run(blend, { impact: { strainAmplitude: 0.002, frequencyHz: 1 } }).result("material.impact-recovery-screen@M");
    assert.equal(i.status, "NOT_COMPUTED");
    assert.match(i.reason, /Charpy \(ISO 179\) \/ Izod \(ASTM D256\).*not predicted/);
  });
  it("unfilled HDPE: E(t) from the cited series, with the extrapolation and linearity warnings", () => {
    const r = run(hdpe, { viscoelastic: { timesS: [0, 100, 1000, 5000] } }).result("material.viscoelastic-prony@M");
    assert.equal(r.status, "WARN");
    const E = r.outputs.relaxationModulus.value;
    assert.ok(Math.abs(E[0].E - 613.9e6) < 1e3);
    assert.ok(E[3].E < E[2].E && E[2].E < E[1].E);
    assert.ok(r.warnings.some((w) => /beyond the measured relaxation steps: extrapolated/.test(w)));
    assert.ok(r.warnings.some((w) => /linearity is not demonstrated/.test(w)));
    const hot = run(hdpe, { viscoelastic: { temperatureK: 353.15 } }).result("material.viscoelastic-prony@M");
    assert.equal(hot.status, "NOT_COMPUTED");
    assert.match(hot.reason, /no HDPE α-relaxation activation energy/);
    const wlf = run(hdpe, { viscoelastic: { temperatureK: 300, shift: { kind: "wlf", C1: 10, C2: 100, Ts: 290, source: "test" } } }).result("material.viscoelastic-prony@M");
    assert.ok(wlf.warnings.some((w) => /semicrystalline/.test(w)));
  });
  it("impact screen: 0.3 % returns; 5 % is strain-dependent (WARN); 15 % is past yield (permanent set); Charpy never predicted", () => {
    const at = (a) => run(hdpe, { impact: { strainAmplitude: a, frequencyHz: 10 } }).result("material.impact-recovery-screen@M");
    const small = at(0.003);
    assert.match(small.outputs.verdict.value, /deforms and returns/);
    assert.equal(small.outputs.charpyIzod.value, "not predicted (lab test)");
    assert.ok(small.outputs.dynamic.value.tanDelta > 0);
    assert.match(at(0.05).outputs.verdict.value, /strain-dependent/);
    assert.ok(HDPE_YIELD_STRAIN < 0.15);
    const big = at(0.15);
    assert.match(big.outputs.verdict.value, /permanent set/);
    assert.notEqual(big.status, "PASS");
  });
});
