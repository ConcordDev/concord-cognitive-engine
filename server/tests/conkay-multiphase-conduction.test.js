// N-phase thermal conductivity: Wiener and Hashin–Shtrikman bounds, random-spheroid mean-field estimate.
//  [CHA] Chaudhry et al., STAM 2020 (PMC7605320) eqs. 7–9: parallel, series and Maxwell's sphere formula.
//  [AKH] Akhtar et al., Polymers 2021 (PMC7962025) eqs. 2, 8–11: Nan's depolarization factors, enhancement
//        factor β, interface (Kapitza) treatment, and the dilute random-orientation form.
//  [YUN] Yun et al., Polymers 2023 (PMC10610629) Table 1: PP k 0.17, basalt k 0.035 W/mK (their inputs); Table 2
//        FEA of randomly placed basalt powder at 35 vol %: "PP(35)Basalt | … | 0.115".
// Passing these tests is not a measurement of any compound.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wiener, hashinShtrikmanK, depolarization, randomSpheroidsK, randomSpheroidsKBand } from "../lib/conkay/knowledge/multiphase-conduction.js";
import { geometricFactors } from "../lib/conkay/knowledge/multiphase-elasticity.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { withCopolymerCandidate } from "../lib/conkay/knowledge/copolymer-candidates.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const pt = (k) => ({ lo: k, hi: k });
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

describe("[CHA][AKH] formulas", () => {
  it("are the quoted ones", () => {
    assert.ok(DOCUMENTS["chaudhry-2020-stam-polyolefin-thermal"].excerpt.includes("(9) κ eff = κ m [1 + 3Φ f / ((κ f + 2κ m)/(κ f − κ m) − Φ f)]"));
    assert.ok(DOCUMENTS["akhtar-2021-polymers-tim-nan"].excerpt.includes("(8) β kk i = (λ e,kk i − λ m)/(λ m + L kk i (λ e,kk i − λ m))"));
  });
  it("Akhtar's depolarization factors equal Heliyon's Eshelby geometric factors (two sources): L33 = H3, L11 = (1 − H3)/2", () => {
    for (const x of [1e-3, 0.05, 0.2, 0.7, 1.5, 2, 10, 50, 1e3]) {
      const d = depolarization(x), g = geometricFactors(x);
      close(d.L33, g.H3, 1e-9); close(d.L11, (1 - g.H3) / 2, 1e-9);
    }
    assert.deepEqual(depolarization(1), { L11: 1 / 3, L33: 1 / 3 });
    assert.throws(() => depolarization(-1));
  });
  it("spheres: the estimate is Maxwell's formula; two phases with a less-conductive filler: it equals the HS upper bound", () => {
    for (const [km, kp, f] of [[0.17, 0.035, 0.35], [0.4, 4.9, 0.1], [0.2, 300, 0.02]]) {
      const maxwell = km * (1 + (3 * f) / ((kp + 2 * km) / (kp - km) - f));
      close(randomSpheroidsK(km, [{ phi: f, k11: kp, k33: kp, aspect: 1 }]), maxwell, 1e-12);
      const hs = hashinShtrikmanK([{ phi: 1 - f, k: pt(km) }, { phi: f, k: pt(kp) }]);
      close(kp < km ? hs.upper : hs.lower, maxwell, 1e-12);
    }
  });
  it("dilute limit equals Akhtar eq. 2 with ⟨cos²θ⟩ = 1/3", () => {
    const km = 0.4, f = 1e-6, k11 = 300, k33 = 6, xi = 1 / 1000;
    const { L11, L33 } = depolarization(xi), b = (k, L) => (k - km) / (km + L * (k - km));
    const eq2 = km * (1 + (f / 2) * (b(k11, L11) * (1 + 1 / 3) + b(k33, L33) * (1 - 1 / 3)));
    close(randomSpheroidsK(km, [{ phi: f, k11, k33, aspect: xi }]), eq2, 1e-9);
  });
  it("an interface resistance lowers the estimate; R = 0 changes nothing", () => {
    const base = { phi: 0.02, k11: 300, k33: 6, aspect: 1 / 1000 };
    const k0 = randomSpheroidsK(0.4, [base]), kR = randomSpheroidsK(0.4, [{ ...base, R: 1e-8, a11: 10e-6, a33: 7e-9 }]);
    assert.ok(kR < k0);
    close(randomSpheroidsK(0.4, [{ ...base, R: 0, a11: 1, a33: 1 }]), k0, 1e-15);
  });
  it("HS lies inside Wiener and rises with every phase (random checks); a phase at 0 sends the lower bound to 0", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 200; n++) {
      const m = 2 + Math.floor(rnd() * 4), w = Array.from({ length: m }, () => rnd() + 0.05), t = w.reduce((a, b) => a + b, 0);
      const ph = w.map((x) => ({ phi: x / t, k: pt(0.05 + rnd() * 50) }));
      const W = wiener(ph), H = hashinShtrikmanK(ph);
      assert.ok(H.upper <= W.upper * (1 + 1e-12) && H.lower >= W.lower * (1 - 1e-12) && H.lower <= H.upper * (1 + 1e-12));
      const up = hashinShtrikmanK(ph.map((p, i) => (i ? p : { ...p, k: pt(p.k.lo * 2) })));
      assert.ok(up.upper >= H.upper * (1 - 1e-12) && up.lower >= H.lower * (1 - 1e-12));
    }
    assert.equal(hashinShtrikmanK([{ phi: 0.5, k: pt(1) }, { phi: 0.5, k: pt(0) }]).lower, 0);
    assert.throws(() => wiener([{ phi: 0.4, k: pt(1) }]), /sum to 1/);
  });
});

describe("[YUN] published FEA, PP + 35 vol % basalt powder", () => {
  it("k_FEA = 0.115 W/mK lies inside Wiener but 1.8 % ABOVE the rigorous HS upper bound (= Maxwell here): reported", () => {
    assert.ok(DOCUMENTS["yun-2023-polymers-basalt-particulate"].excerpt.includes("PP(35)Basalt | 3600.0 | 1379.5 | 62.91 × 10−6 | 0.115"));
    const ph = [{ phi: 0.65, k: pt(0.17) }, { phi: 0.35, k: pt(0.035) }];
    const W = wiener(ph), H = hashinShtrikmanK(ph);
    assert.ok(W.lower < 0.115 && W.upper > 0.115);
    assert.ok(H.upper < 0.115, "an isotropic random mixture cannot exceed HS; the FEA cell is not statistically isotropic, or discretisation error");
    assert.ok(Math.abs(0.115 / H.upper - 1 - 0.018) < 0.001);
  });
});

describe("material.k-multiphase", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const base = materialIrFromText(text, meta);
  const run = (ir, micro) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir, ...(micro ? { micromechanics: micro } : {}) } }] }).session.result("material.k-multiphase@M");
  it("is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "material.k-multiphase");
    for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });
  it("Blend D: blocked by basalt fibre's conductivity (rPP) and also the co-polymer's (EVA)", () => {
    assert.match(run(withCopolymerCandidate(base, "recycled-impact-pp")).reason, /no cited thermal conductivity for: basalt-fiber \(/);
    assert.match(run(withCopolymerCandidate(base, "eva")).reason, /hdpe-hc-co-polymer, basalt-fiber/);
  });
  it("with basalt's k supplied (a test value) the bounds compute and the estimate lists the missing shapes; with shapes it lies inside HS", () => {
    const ir = withCopolymerCandidate(base, "recycled-impact-pp");
    const withK = { ...ir, constituents: ir.constituents.map((c) => (c.id === "basalt-fiber" ? { ...c, properties: { ...c.properties, conductivity: { lo: 1, hi: 2, unit: "W/(m·K)", claimRef: "test-input" } } } : c)) };
    const r = run(withK);
    assert.equal(r.status, "WARN");
    assert.ok(r.outputs.hashinShtrikman.value.lower > r.outputs.wiener.value.lower);
    assert.match(r.outputs.estimate.basis, /no shape .* for hdpe-hc-co-polymer, basalt-fiber, caco3, silica/);
    const r2 = run(withK, { phases: { "hdpe-hc-co-polymer": { aspectRatio: 1 }, "basalt-fiber": { aspectRatio: { lo: 5, hi: 50 } }, caco3: { aspectRatio: 1 }, silica: { aspectRatio: 1 } } });
    const e = r2.outputs.estimate.value, h = r2.outputs.hashinShtrikman.value;
    assert.ok(e.low >= h.lower * (1 - 1e-9) && e.high <= h.upper * (1 + 1e-9), JSON.stringify([e, h]));
    assert.ok(r2.warnings.some((w) => /perfect thermal contact assumed for .*graphene/.test(w)));
  });
  it("band helper matches point evaluation at a degenerate interval", () => {
    const b = randomSpheroidsKBand(pt(0.4), [{ phi: 0.05, k11: pt(5), k33: pt(5), aspect: pt(1) }]);
    close(b.low, randomSpheroidsK(0.4, [{ phi: 0.05, k11: 5, k33: 5, aspect: 1 }]));
  });
});
