// N-phase CTE: Turner and thermoelastic Mori–Tanaka (random spheroids).
//  [YUN] Yun et al., Polymers 2023 (PMC10610629) Table 1: PP E 1660 MPa, ν 0.35, α 104e-6; basalt E 89,000 MPa,
//        ν 0.20, α 8e-6; Table 2 FEA "PP(35)Basalt | 3600.0 | 1379.5 | 62.91 × 10−6 | 0.115".
// Levin's exact two-phase relation (α* = ᾱ + (α1 − α2)/(1/K1 − 1/K2)·(1/K* − ⟨1/K⟩)) is the identity check: the
// Mori–Tanaka CTE must satisfy it with the Mori–Tanaka bulk modulus. Passing tests is not a measurement.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kgFromENu, moriTanakaRandom, moriTanakaRandomCte, turnerCte, hashinShtrikman } from "../lib/conkay/knowledge/multiphase-elasticity.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { withCopolymerCandidate } from "../lib/conkay/knowledge/copolymer-candidates.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const pp = { ...kgFromENu(1660e6, 0.35), alpha: 104e-6 }, bs = { ...kgFromENu(89000e6, 0.2), alpha: 8e-6 };
const levin = (f, K) => (1 - f) * pp.alpha + f * bs.alpha + ((pp.alpha - bs.alpha) / (1 / pp.K - 1 / bs.K)) * (1 / K - ((1 - f) / pp.K + f / bs.K));
const rel = (a, b) => Math.abs(a / b - 1);

describe("thermoelastic Mori–Tanaka", () => {
  for (const aspect of [1, 0.01, 30]) {
    it(`two phases (aspect ${aspect}): satisfies Levin's exact relation with the Mori–Tanaka bulk modulus`, () => {
      for (const f of [0.05, 0.2, 0.35]) {
        const K = moriTanakaRandom(pp, [{ phi: f, ...bs, aspect }]).K;
        assert.ok(rel(moriTanakaRandomCte(pp, [{ phi: f, ...bs, aspect }]), levin(f, K)) < 1e-10, `f=${f}`);
      }
    });
  }
  it("an inclusion identical to the matrix gives Turner (every a = 1) and the matrix α", () => {
    const same = moriTanakaRandomCte(pp, [{ phi: 0.3, ...pp, aspect: 5 }]);
    assert.ok(rel(same, pp.alpha) < 1e-12);
    assert.ok(rel(turnerCte([{ phi: 1, ...pp }]), pp.alpha) < 1e-15);
  });
  it("rises with every phase α", () => {
    const a = moriTanakaRandomCte(pp, [{ phi: 0.1, ...bs, aspect: 3 }]), b = moriTanakaRandomCte(pp, [{ phi: 0.1, ...bs, alpha: 9e-6, aspect: 3 }]);
    assert.ok(b > a);
  });
});

describe("[YUN] PP + 35 vol % basalt powder, published FEA α = 62.91e-6", () => {
  it("Mori–Tanaka (spheres) is within 0.8 %; Turner is 4.4× low; the FEA is 0.8 % above Levin's bound at the HS lower K (reported)", () => {
    const mt = moriTanakaRandomCte(pp, [{ phi: 0.35, ...bs, aspect: 1 }]);
    assert.ok(rel(mt, 62.91e-6) < 0.009, `${mt}`);
    const t = turnerCte([{ phi: 0.65, ...pp }, { phi: 0.35, ...bs }]);
    assert.ok(62.91e-6 / t > 4.4 && 62.91e-6 / t < 4.5, `${t}`);
    const pt = (x) => ({ lo: x, hi: x });
    const hs = hashinShtrikman([{ phi: 0.65, K: pt(pp.K), G: pt(pp.G) }, { phi: 0.35, K: pt(bs.K), G: pt(bs.G) }]);
    const upperAlpha = levin(0.35, hs.lower.K);
    assert.ok(upperAlpha < 62.91e-6 && rel(62.91e-6, upperAlpha) < 0.009, "the FEA sits slightly outside the rigorous two-phase CTE bound");
  });
});

describe("material.cte-multiphase", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const base = materialIrFromText(text, meta);
  const run = (ir, micro) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir, ...(micro ? { micromechanics: micro } : {}) } }] }).session.result("material.cte-multiphase@M");
  it("is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "material.cte-multiphase");
    for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });
  it("rPP: Turner computes (flagged), Mori–Tanaka lists the missing shapes; EVA: its CTE is missing", () => {
    const r = run(withCopolymerCandidate(base, "recycled-impact-pp"));
    assert.equal(r.status, "WARN");
    assert.ok(r.outputs.turner.value.low > 0 && r.outputs.turner.value.high > r.outputs.turner.value.low);
    assert.match(r.outputs.moriTanaka.basis, /no shape .* for hdpe-hc-co-polymer, basalt-fiber, caco3, silica/);
    assert.ok(r.warnings.some((w) => /graphene expand anisotropically/.test(w)));
    assert.ok(r.warnings.some((w) => /generic PP's CTE/.test(w)));
    assert.match(run(withCopolymerCandidate(base, "eva")).reason, /hdpe-hc-co-polymer \(CTE\)/);
  });
  it("with shapes given, Mori–Tanaka computes and its band lies above Turner's low end", () => {
    const r = run(withCopolymerCandidate(base, "recycled-impact-pp"), { phases: { "hdpe-hc-co-polymer": { aspectRatio: 1 }, "basalt-fiber": { aspectRatio: { lo: 5, hi: 20 } }, caco3: { aspectRatio: 1 }, silica: { aspectRatio: 1 } } });
    assert.ok(r.outputs.moriTanaka.value.low >= r.outputs.turner.value.low);
  });
});
