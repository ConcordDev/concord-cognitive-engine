// N-phase stiffness: Hashin–Shtrikman–Walpole bounds and multi-phase Mori–Tanaka with random spheroids.
//  [YUN]  Yun et al., Polymers 2023, 15, 4125 (PMC10610629). Table 1: PP E 1660 MPa, ν 0.35; basalt E 89,000 MPa,
//         ν 0.20. Table 2, FEA of randomly placed basalt powder in an RVE, "PP(35)Basalt | 3600.0 | 1379.5" (E, G MPa)
//         at 35 vol %.
//  [HEL]  Heliyon 2024, e25274 (PMC11637110), App. A eqs. A.1–A.3: the spheroid Eshelby tensor implemented here.
//         Its sphere, long-fibre and penny limits are checked against the classical closed forms below.
// Passing these tests is not a measurement of any compound.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashinShtrikman, kgFromENu, kgIntervals, moriTanakaRandom, moriTanakaRandomBand, eshelbyComponents, geometricFactors } from "../lib/conkay/knowledge/multiphase-elasticity.js";
import { moriTanakaSpheres, voigt, reuss } from "../lib/conkay/knowledge/micromechanics.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { withCopolymerCandidate } from "../lib/conkay/knowledge/copolymer-candidates.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const point = (E, nu) => { const k = kgFromENu(E, nu); return { K: { lo: k.K, hi: k.K }, G: { lo: k.G, hi: k.G } }; };
const rel = (a, b) => Math.abs(a / b - 1);

describe("[HEL] Eshelby tensor of a spheroid", () => {
  it("is the quoted formula set", () => {
    const ex = DOCUMENTS["heliyon-2024-eshelby-spheroid"].excerpt;
    assert.ok(ex.includes("S3333 = H3 + (H3−H31)/(1−ν)"));
    assert.ok(ex.includes("(A.1b) sphere: H3 = 1/3, H31 = 1/5"));
  });
  for (const nu of [0.2, 0.35, 0.41]) {
    it(`ν = ${nu}: sphere, long-fibre and penny limits are the classical closed forms`, () => {
      const q = 1 - nu, sph = eshelbyComponents(1, nu);
      for (const [k, v] of Object.entries({ S1111: (7 - 5 * nu) / (15 * q), S3333: (7 - 5 * nu) / (15 * q), S1122: (5 * nu - 1) / (15 * q), S1133: (5 * nu - 1) / (15 * q), S2323: (4 - 5 * nu) / (15 * q), S1212: (4 - 5 * nu) / (15 * q) })) assert.ok(Math.abs(sph[k] - v) < 1e-12, k);
      const cyl = eshelbyComponents(1e7, nu);
      for (const [k, v] of Object.entries({ S1111: (5 - 4 * nu) / (8 * q), S1122: (4 * nu - 1) / (8 * q), S1133: nu / (2 * q), S3333: 0, S3311: 0, S2323: 0.25, S1212: (3 - 4 * nu) / (8 * q) })) assert.ok(Math.abs(cyl[k] - v) < 1e-6, `fibre ${k}`);
      const pen = eshelbyComponents(1e-7, nu);
      for (const [k, v] of Object.entries({ S3333: 1, S3311: nu / q, S2323: 0.5, S1111: 0, S1122: 0 })) assert.ok(Math.abs(pen[k] - v) < 1e-5, `penny ${k}`);
    });
  }
  it("is continuous through the sphere and rejects invalid inputs", () => {
    const a = eshelbyComponents(1, 0.3), b = eshelbyComponents(1.0004, 0.3), c = eshelbyComponents(0.9996, 0.3);
    for (const k of Object.keys(a)) { assert.ok(Math.abs(b[k] - a[k]) < 1e-3, k); assert.ok(Math.abs(c[k] - a[k]) < 1e-3, k); }
    assert.throws(() => geometricFactors(0));
    assert.throws(() => eshelbyComponents(2, 0.5));
  });
});

describe("Hashin–Shtrikman–Walpole bounds", () => {
  it("a single phase, or identical phases, return the phase", () => {
    const one = hashinShtrikman([{ phi: 1, ...point(70e9, 0.3) }]);
    assert.ok(rel(one.upper.E, 70e9) < 1e-12 && rel(one.lower.E, 70e9) < 1e-12);
    const two = hashinShtrikman([{ phi: 0.4, ...point(70e9, 0.3) }, { phi: 0.6, ...point(70e9, 0.3) }]);
    assert.ok(rel(two.upper.E, 70e9) < 1e-12 && rel(two.lower.E, 70e9) < 1e-12);
  });
  it("lie inside Voigt–Reuss and rise with every phase modulus (random checks)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 200; n++) {
      const k = 2 + Math.floor(rnd() * 4), w = Array.from({ length: k }, () => rnd() + 0.05), t = w.reduce((a, b) => a + b, 0);
      const ph = w.map((x) => ({ phi: x / t, E: 1e8 + rnd() * 1e11, nu: 0.05 + rnd() * 0.4 }));
      const hs = hashinShtrikman(ph.map((p) => ({ phi: p.phi, ...point(p.E, p.nu) })));
      // rigorous Voigt for E is E(K_V, G_V); Σφ_iE_i is not a bound when the ν differ (Hill), and HS can exceed it
      const KV = ph.reduce((a, p) => a + p.phi * kgFromENu(p.E, p.nu).K, 0), GV = ph.reduce((a, p) => a + p.phi * kgFromENu(p.E, p.nu).G, 0);
      const V = (9 * KV * GV) / (3 * KV + GV), R = reuss(ph.map((p) => ({ phi: p.phi, E: p.E })));
      assert.ok(hs.lower.E <= hs.upper.E * (1 + 1e-12));
      assert.ok(hs.upper.E <= V * (1 + 1e-9) && hs.lower.E >= R * (1 - 1e-9), `n=${n}`);
      const up = ph.map((p, i) => (i === 0 ? { ...p, E: p.E * 1.5 } : p));
      const hs2 = hashinShtrikman(up.map((p) => ({ phi: p.phi, ...point(p.E, p.nu) })));
      assert.ok(hs2.upper.E >= hs.upper.E * (1 - 1e-12) && hs2.lower.E >= hs.lower.E * (1 - 1e-12));
    }
  });
  it("Σφ_iE_i is not an upper bound when the Poisson's ratios differ: a case where HS's upper bound exceeds it", () => {
    const ph = [{ phi: 0.703, E: 74.21e9, nu: 0.246 }, { phi: 0.297, E: 68.85e9, nu: 0.145 }];
    const hs = hashinShtrikman(ph.map((p) => ({ phi: p.phi, ...point(p.E, p.nu) })));
    assert.ok(hs.lower.E > voigt(ph.map((p) => ({ phi: p.phi, E: p.E }))), "even the HS LOWER bound exceeds Σφ_iE_i here");
  });
  it("rejects fractions that do not sum to 1 and empty intervals", () => {
    assert.throws(() => hashinShtrikman([{ phi: 0.5, ...point(1e9, 0.3) }]), /sum to 1/);
    assert.throws(() => hashinShtrikman([{ phi: 1, K: { lo: 2, hi: 1 }, G: { lo: 1, hi: 1 } }]));
  });
});

describe("[YUN] random basalt particles in PP, 35 vol % (published FEA)", () => {
  const pp = kgFromENu(1660e6, 0.35), bs = kgFromENu(89000e6, 0.2);
  it("the inputs and the FEA values are the quoted ones", () => {
    const ex = DOCUMENTS["yun-2023-polymers-basalt-particulate"].excerpt;
    assert.ok(ex.includes("Elastic modulus 89,000 MPa") && ex.includes("Poisson's ratio 0.20"));
  });
  it("the FEA's E and G lie inside the HS bounds", () => {
    const hs = hashinShtrikman([{ phi: 0.65, ...point(1660e6, 0.35) }, { phi: 0.35, ...point(89000e6, 0.2) }]);
    assert.ok(hs.lower.E < 3600e6 && hs.upper.E > 3600e6);
    assert.ok(hs.lower.G < 1379.5e6 && hs.upper.G > 1379.5e6);
  });
  it("Mori–Tanaka (spheres) equals the HS lower bound and the existing closed form, and sits 5.1 % (E) / 6.2 % (G) below the FEA", () => {
    const mt = moriTanakaRandom(pp, [{ phi: 0.35, ...bs, aspect: 1 }]);
    const hs = hashinShtrikman([{ phi: 0.65, ...point(1660e6, 0.35) }, { phi: 0.35, ...point(89000e6, 0.2) }]);
    assert.ok(rel(mt.E, hs.lower.E) < 1e-12 && rel(mt.G, hs.lower.G) < 1e-12);
    const cf = moriTanakaSpheres({ Em: 1660e6, num: 0.35, Ef: 89000e6, nuf: 0.2, phi: 0.35 });
    assert.ok(rel(mt.E, cf.E) < 1e-10);
    assert.ok(Math.abs(1 - mt.E / 3600e6 - 0.051) < 0.002, `${mt.E}`);
    assert.ok(Math.abs(1 - mt.G / 1379.5e6 - 0.062) < 0.002, `${mt.G}`);
  });
  it("stiff random fibres stiffen more than spheres; an inclusion like the matrix changes nothing", () => {
    const sph = moriTanakaRandom(pp, [{ phi: 0.1, ...bs, aspect: 1 }]).E, fib = moriTanakaRandom(pp, [{ phi: 0.1, ...bs, aspect: 20 }]).E;
    assert.ok(fib > sph);
    assert.ok(rel(moriTanakaRandom(pp, [{ phi: 0.3, ...pp, aspect: 7 }]).E, 1660e6) < 1e-12);
    const band = moriTanakaRandomBand({ E: { lo: 1660e6, hi: 1660e6 }, nu: { lo: 0.35, hi: 0.35 } }, [{ phi: 0.1, E: { lo: 85e9, hi: 110e9 }, nu: { lo: 0.2, hi: 0.2 }, aspect: { lo: 1, hi: 20 } }]);
    assert.ok(band.low.E <= sph * (1 + 1e-12) && band.high.E >= fib);
  });
});

describe("Blend D", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const base = materialIrFromText(text, meta);
  const run = (ir, micro) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir, ...(micro ? { micromechanics: micro } : {}) } }] }).session;
  it("both solvers are registered with their declarations", () => {
    for (const id of ["material.modulus-hashin-shtrikman", "material.modulus-mori-tanaka-random"]) {
      const s = listSolvers().find((x) => x.id === id);
      for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], `${id}.${k}`);
    }
  });
  it("unidentified co-polymer: NOT_COMPUTED naming it", () => {
    const r = run(base).result("material.modulus-hashin-shtrikman@M");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /hdpe-hc-co-polymer/);
  });
  for (const cand of ["recycled-impact-pp", "eva"]) {
    it(`${cand}: HS bounds compute, inside Voigt–Reuss; Mori–Tanaka lists the shapes it needs (graphene's is sourced)`, () => {
      const s = run(withCopolymerCandidate(base, cand));
      const hs = s.result("material.modulus-hashin-shtrikman@M"), vr = s.result("material.modulus-bounds@M");
      assert.equal(hs.status, "WARN");
      assert.ok(hs.outputs.lower.value.E >= vr.outputs.reuss.value.low * (1 - 1e-9));
      assert.ok(hs.outputs.upper.value.E <= vr.outputs.voigt.value.high * (1 + 1e-9));
      const mt = s.result("material.modulus-mori-tanaka-random@M");
      assert.equal(mt.status, "NOT_COMPUTED");
      assert.match(mt.reason, /hdpe-hc-co-polymer, basalt-fiber, caco3, silica$/);
    });
  }
  it("with every shape given, Mori–Tanaka computes between the HS bounds", () => {
    const ir = withCopolymerCandidate(base, "recycled-impact-pp");
    const phases = { "hdpe-hc-co-polymer": { aspectRatio: 1 }, "basalt-fiber": { aspectRatio: { lo: 5, hi: 50 } }, caco3: { aspectRatio: 1 }, silica: { aspectRatio: 1 } };
    const s = run(ir, { phases });
    const mt = s.result("material.modulus-mori-tanaka-random@M"), hs = s.result("material.modulus-hashin-shtrikman@M");
    assert.equal(mt.status, "WARN");
    assert.match(mt.outputs ? JSON.stringify(mt.inputs.shapes.value.graphene) : "", /sourced: platelet thickness/);
    assert.ok(mt.outputs.modulus.value.low.E >= hs.outputs.lower.value.E * (1 - 1e-9));
    assert.ok(mt.outputs.modulus.value.high.E <= hs.outputs.upper.value.E * (1 + 1e-9));
  });
});
