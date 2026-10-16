// Filled viscoelastic compound by the correspondence principle (complex multi-phase Mori–Tanaka).
// Checks are identities: the elastic limit equals the real Mori–Tanaka; spheres equal the closed-form complex
// Mori–Tanaka bulk/shear expressions evaluated independently here; stiff elastic fillers lower tan δ.
// The HDPE spectrum is Segura-Méndez et al. 2025 Table 6 (already on record, viscoelastic.js).
// Passing tests is not a DMA measurement of any compound.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moriTanakaComplex, compoundDynamicModuli } from "../lib/conkay/knowledge/viscoelastic-composite.js";
import { moriTanakaRandom, kgFromENu } from "../lib/conkay/knowledge/multiphase-elasticity.js";
import { HDPE_PRONY_SEGURA_2025, dynamicModuli } from "../lib/conkay/knowledge/viscoelastic.js";
import { loadFixture } from "../lib/conkay/knowledge/index.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { withCopolymerCandidate } from "../lib/conkay/knowledge/copolymer-candidates.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const rel = (a, b) => Math.abs(a / b - 1);
const hdpe = HDPE_PRONY_SEGURA_2025.sets[0];

describe("complex Mori–Tanaka", () => {
  it("elastic limit (real moduli) equals the real multi-phase Mori–Tanaka", () => {
    const m = kgFromENu(1e9, 0.41), f = kgFromENu(90e9, 0.2);
    for (const aspect of [1, 0.01, 20]) {
      const cx = moriTanakaComplex({ K: { re: m.K, im: 0 }, G: { re: m.G, im: 0 } }, 0.41, [{ phi: 0.15, ...f, aspect }]);
      const re = moriTanakaRandom(m, [{ phi: 0.15, ...f, aspect }]);
      assert.ok(rel(cx.E.re, re.E) < 1e-12 && Math.abs(cx.E.im) < 1e-6, `aspect ${aspect}`);
    }
  });
  it("spheres: equals the closed-form complex Mori–Tanaka (independent complex arithmetic)", () => {
    const nu = 0.41, Em = dynamicModuli(hdpe, 2 * Math.PI * 0.01), E = [Em.storage, Em.loss];
    const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], div = (a, b) => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], sc = (a, s) => [a[0] * s, a[1] * s];
    const K0 = sc(E, 1 / (3 * (1 - 2 * nu))), G0 = sc(E, 1 / (2 * (1 + nu))), f = kgFromENu(90e9, 0.2), phi = 0.1;
    const K1 = [f.K, 0], G1 = [f.G, 0];
    // K = K0 + φ(K1−K0)/(1 + (1−φ)(K1−K0)/(K0 + 4G0/3)); G = G0 + φ(G1−G0)/(1 + (1−φ)(G1−G0)/(G0 + ζ0)), ζ0 = G0(9K0+8G0)/(6(K0+2G0))
    const Kx = add(K0, div(sc(sub(K1, K0), phi), add([1, 0], div(sc(sub(K1, K0), 1 - phi), add(K0, sc(G0, 4 / 3))))));
    const z0 = div(mul(G0, add(sc(K0, 9), sc(G0, 8))), sc(add(K0, sc(G0, 2)), 6));
    const Gx = add(G0, div(sc(sub(G1, G0), phi), add([1, 0], div(sc(sub(G1, G0), 1 - phi), add(G0, z0)))));
    const Ex = div(sc(mul(Kx, Gx), 9), add(sc(Kx, 3), Gx));
    const r = compoundDynamicModuli({ prony: hdpe, nuMatrix: nu, omega: 2 * Math.PI * 0.01, inclusions: [{ phi, E: 90e9, nu: 0.2, aspect: 1 }] });
    assert.ok(rel(r.storage, Ex[0]) < 1e-10 && rel(r.loss, Ex[1]) < 1e-10, `${r.storage} ${Ex[0]}`);
  });
  it("stiff elastic fillers raise E′ and lower tan δ; zero filler returns the matrix", () => {
    const w = 2 * Math.PI * 0.01;
    const r = compoundDynamicModuli({ prony: hdpe, nuMatrix: 0.41, omega: w, inclusions: [{ phi: 0.15, E: 90e9, nu: 0.2, aspect: 10 }] });
    assert.ok(r.storage > r.matrix.storage && r.tanDelta < r.matrix.tanDelta);
    const z = compoundDynamicModuli({ prony: hdpe, nuMatrix: 0.41, omega: w, inclusions: [{ phi: 0, E: 90e9, nu: 0.2, aspect: 10 }] });
    assert.ok(rel(z.storage, z.matrix.storage) < 1e-12 && rel(z.loss, z.matrix.loss) < 1e-12);
    assert.throws(() => compoundDynamicModuli({ prony: hdpe, nuMatrix: 0.5, omega: w, inclusions: [] }));
  });
});

describe("material.viscoelastic-composite", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const base = materialIrFromText(text, meta);
  const run = (ir, props) => openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir, ...props } }] }).session.result("material.viscoelastic-composite@M");
  it("is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "material.viscoelastic-composite");
    for (const k of ["version", "domain", "method", "reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });
  it("Blend D: lists every missing input — the frequency, the co-polymer's relaxation spectrum, the shapes", () => {
    const r = run(withCopolymerCandidate(base, "recycled-impact-pp"), {});
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /frequencyHz/);
    assert.match(r.reason, /no relaxation spectrum for the polymer phase hdpe-hc-co-polymer/);
    assert.match(r.reason, /no shape .* basalt-fiber, caco3, silica/);
  });
  it("an HDPE + elastic-filler recipe computes, uses the sourced HDPE spectrum, and flags extrapolation at impact frequencies", () => {
    const ir = withCopolymerCandidate(base, "recycled-impact-pp");
    const noCo = { ...ir, constituents: ir.constituents.filter((c) => c.classId !== "recycled_impact_pp").map((c) => (c.id === "hdpe-base" ? { ...c, fraction: { min: 75, max: 85 } } : c)), nominal: null };
    // a two-filler test recipe on a volume basis (fractions as given)
    const recipe = { ...noCo, basis: "volume", nominal: { rule: "test", fractions: [{ id: "hdpe-base", pct: 84 }, { id: "basalt-fiber", pct: 6 }, { id: "caco3", pct: 4 }, { id: "graphene", pct: 3 }, { id: "silica", pct: 3 }] }, constituents: noCo.constituents.map((c) => ({ ...c, fraction: { min: 0, max: 100 } })) };
    const props = { viscoelastic: { frequencyHz: 0.001 }, micromechanics: { phases: { "basalt-fiber": { aspectRatio: 20 }, caco3: { aspectRatio: 1 }, silica: { aspectRatio: 1 } } } };
    const r = run(recipe, props);
    assert.equal(r.status, "WARN", r.reason);
    assert.ok(r.outputs.compound.value.storage.low > r.outputs.matrix.value.storage);
    assert.match(r.inputs.matrix.spectrum, /Segura-Méndez.*0\.5 % strain set/);
    const fast = run(recipe, { ...props, viscoelastic: { frequencyHz: 50 } });
    assert.ok(fast.warnings.some((w) => /EXTRAPOLATED/.test(w)));
  });
});
