// server/lib/conkay/physics/solvers/material-viscoelastic-composite.js
//
// material.viscoelastic-composite on a formulated Material node (any recipe): the compound's E′, E″, tan δ at
// props.viscoelastic.frequencyHz by the correspondence principle (complex multi-phase Mori–Tanaka, random
// spheroids). The matrix (largest fraction) needs a relaxation spectrum: HDPE's sourced Prony series (Segura 2025,
// lowest tested strain) or props.viscoelastic.phases.<id>.prony { Einf, terms, source }. Every other POLYMER phase
// needs its own spectrum too (it is viscoelastic, not elastic) — not substituted. Mineral and fibre fillers are
// elastic (E, ν). Shapes as in material.modulus-mori-tanaka-random.

import { registerSolver } from "../registry.js";
import { setup, blocked, formulated, span, modulusOf } from "./material-stiffness.js";
import { compoundDynamicModuli } from "../../knowledge/viscoelastic-composite.js";
import { HDPE_PRONY_SEGURA_2025 } from "../../knowledge/viscoelastic.js";

const POLYMER = new Set(["hdpe", "hdpe_hc_copolymer", "recycled_impact_pp", "eva"]);

export const viscoelasticComposite = registerSolver({
  id: "material.viscoelastic-composite",
  version: "1.0.0",
  domain: "material.viscoelastic",
  fidelity: 1,
  method: "Elastic–viscoelastic correspondence: complex multi-phase Mori–Tanaka (random spheroids) at one frequency, matrix E*(ω) from its Prony series, constant matrix Poisson's ratio",
  reference: "server/lib/conkay/knowledge/viscoelastic-composite.js",
  regime: "linear viscoelasticity (small strain), one continuous viscoelastic matrix, elastic fillers, perfect bond; the matrix Poisson's ratio is held constant (assumption); frequencies outside the relaxation data's window are extrapolation",
  units: { inputs: "Hz, Pa, 1", outputs: "Pa, 1" },
  tolerance: "a mean-field estimate; the HDPE spectrum's own fit (R² 0.9925) and strain dependence (E(0) falls 3× from 0.5 to 10 %) dominate",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const ve = ctx.get(id, "props.viscoelastic") || {};
    if (!(ve.frequencyHz > 0)) s.blockers.push("props.viscoelastic.frequencyHz (the load frequency)");
    if (!s.phi) return blocked(s.blockers);
    const rows = s.ir.constituents.map((c, i) => ({ id: c.id, c, phi: s.phi[i] }));
    const mi = rows.reduce((b, r, i) => (r.phi > rows[b].phi ? i : b), 0);
    const m = rows[mi];
    const given = ve.phases || {};
    let prony = given[m.id]?.prony ? { ...given[m.id].prony, source: given[m.id].prony.source } : null;
    if (!prony && m.c.classId === "hdpe") { const set = HDPE_PRONY_SEGURA_2025.sets[0]; prony = { Einf: set.Einf, terms: set.terms, source: `${HDPE_PRONY_SEGURA_2025.source}, ${set.strain * 100} % strain set` }; }
    if (!prony) s.blockers.push(`no relaxation spectrum for the matrix ${m.id}`);
    else if (!prony.source) s.blockers.push(`props.viscoelastic.phases.${m.id}.prony needs its source`);
    const nuM = m.c.properties.poisson ? span(m.c.properties.poisson) : null;
    if (!nuM) s.blockers.push(`no Poisson's ratio for the matrix ${m.id}`);
    const others = rows.filter((_, i) => i !== mi);
    const vePolymers = others.filter((r) => POLYMER.has(r.c.classId) && !given[r.id]?.prony).map((r) => r.id);
    if (vePolymers.length) s.blockers.push(`no relaxation spectrum for the polymer phase ${vePolymers.join(", ")} (a polymer is viscoelastic; it is not treated as elastic)`);
    const missE = others.filter((r) => !POLYMER.has(r.c.classId)).filter((r) => !modulusOf(r.c) || !r.c.properties.poisson).map((r) => r.id);
    if (missE.length) s.blockers.push(`no Young's modulus or Poisson's ratio for: ${missE.join(", ")}`);
    const shapes = { ...(s.micro.phases || {}) };
    for (const r of others) {
      const th = span(r.c.properties.thickness), D = span(r.c.properties.lateralSize);
      if (!shapes[r.id]?.aspectRatio && th && D) shapes[r.id] = { aspectRatio: { lo: th.lo / D.hi, hi: th.hi / D.lo } };
    }
    const noShape = others.filter((r) => !(span(shapes[r.id]?.aspectRatio)?.lo > 0)).map((r) => r.id);
    if (noShape.length) s.blockers.push(`no shape (props.micromechanics.phases.<id>.aspectRatio) for: ${noShape.join(", ")}`);
    if (vePolymers.length === 0 && others.some((r) => POLYMER.has(r.c.classId))) s.blockers.push("a second viscoelastic polymer phase is not supported by this elastic-filler model yet");
    if (s.blockers.length) return blocked(s.blockers);
    const t = rows.reduce((a, r) => a + r.phi, 0), omega = 2 * Math.PI * ve.frequencyHz;
    const run = (pickE, pickNu, pickA, nu0) => compoundDynamicModuli({ prony, nuMatrix: nu0, omega, inclusions: others.map((r) => ({ phi: r.phi / t, E: pickE(modulusOf(r.c)), nu: pickNu(span(r.c.properties.poisson)), aspect: pickA(span(shapes[r.id].aspectRatio)) })) });
    const cases = [];
    for (const nu0 of [...new Set([nuM.lo, nuM.hi])]) for (const fE of [(x) => x.lo, (x) => x.hi]) for (const fA of [(x) => x.lo, (x) => x.hi]) cases.push(run(fE, (x) => x.lo, fA, nu0));
    const lo = cases.reduce((a, b) => (b.storage < a.storage ? b : a)), hi = cases.reduce((a, b) => (b.storage > a.storage ? b : a));
    const taus = prony.terms.map((q) => q.tau);
    const warnings = [`the matrix Poisson's ratio is held constant (${nuM.lo}${nuM.hi !== nuM.lo ? `–${nuM.hi}` : ""}): an assumption`, `the spectrum's τ span ${Math.min(...taus)}–${Math.max(...taus)} s; at ${ve.frequencyHz} Hz (ωτ_min = ${(omega * Math.min(...taus)).toExponential(2)}) ${omega * Math.min(...taus) > 10 ? "the response is EXTRAPOLATED past the fastest measured mode" : "inside the measured modes"}`];
    return {
      inputs: { frequencyHz: { value: ve.frequencyHz }, matrix: { value: m.id, spectrum: prony.source } },
      outputs: {
        compound: { value: { storage: { low: lo.storage, high: hi.storage }, tanDelta: { atLowStorage: lo.tanDelta, atHighStorage: hi.tanDelta } }, unit: "Pa; 1" },
        matrix: { value: lo.matrix, unit: "Pa; 1" },
      },
      warnings,
    };
  },
});
