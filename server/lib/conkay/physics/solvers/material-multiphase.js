// server/lib/conkay/physics/solvers/material-multiphase.js
//
// N-phase stiffness on a formulated Material node (any recipe, any number of constituents):
//   material.modulus-hashin-shtrikman — rigorous shape-free bounds (needs E and ν of every phase)
//   material.modulus-mori-tanaka-random — an estimate for randomly oriented spheroids in one matrix
//     (needs every inclusion's shape: props.micromechanics.phases = { <id>: { aspectRatio: n | {lo, hi} } },
//      aspect 1 = sphere, > 1 fibre (length/diameter), < 1 platelet (thickness/diameter)).
// Nominal volume fractions as in material-stiffness.js (setup). Every missing input is listed.

import { registerSolver } from "../registry.js";
import { setup, blocked, formulated, span, modulusOf } from "./material-stiffness.js";
import { hashinShtrikman, kgIntervals, moriTanakaRandomBand } from "../../knowledge/multiphase-elasticity.js";

const nuOf = (c) => (c.properties.poisson ? span(c.properties.poisson) : null);

function phaseData(s) {
  const missing = [];
  const rows = s.ir.constituents.map((c, i) => {
    const E = modulusOf(c), nu = nuOf(c);
    if (!E) missing.push(`${c.id} (Young's modulus)`);
    if (!nu) missing.push(`${c.id} (Poisson's ratio)`);
    return { id: c.id, phi: s.phi ? s.phi[i] : null, E, nu };
  });
  return { rows, missing };
}

const common = { units: { inputs: "Pa, 1, % (mass or volume)", outputs: "Pa, 1" }, screening: true, targets: formulated, reference: "server/lib/conkay/knowledge/multiphase-elasticity.js" };

export const modulusHashinShtrikman = registerSolver({
  ...common,
  id: "material.modulus-hashin-shtrikman",
  version: "1.0.0",
  domain: "material.stiffness",
  fidelity: 1,
  method: "Hashin–Shtrikman–Walpole bounds for N isotropic phases at the nominal volume fractions; upper bound at every phase's high K and G, lower at every low one",
  regime: "a statistically isotropic, perfectly bonded, void-free composite of isotropic phases, any geometry; anisotropic fillers (fibres, platelets) enter with an isotropic modulus band and are flagged",
  tolerance: "exact bounds for the inputs; tighter than Voigt–Reuss",
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const { rows, missing } = phaseData(s);
    if (missing.length) s.blockers.push(`no cited ${missing.join(", ")}`);
    if (s.blockers.length) return blocked(s.blockers);
    const t = rows.reduce((a, r) => a + r.phi, 0);
    const hs = hashinShtrikman(rows.map((r) => ({ phi: r.phi / t, ...kgIntervals(r.E, r.nu) })));
    const aniso = s.ir.constituents.filter((c) => c.classId === "graphene" || c.classId === "basalt_fiber").map((c) => c.id);
    return {
      inputs: { volumeFractions: { value: Object.fromEntries(rows.map((r) => [r.id, r.phi])) }, phases: { value: rows.map((r) => ({ id: r.id, E: { lo: r.E.lo, hi: r.E.hi }, nu: r.nu, basis: r.E.basis })) } },
      outputs: {
        upper: { value: hs.upper, unit: "Pa (K, G, E)", basis: "HS upper bound, every phase at its high modulus" },
        lower: { value: hs.lower, unit: "Pa (K, G, E)", basis: "HS lower bound, every phase at its low modulus" },
      },
      warnings: [
        "bounds, not a prediction",
        ...(aniso.length ? [`${aniso.join(", ")} are anisotropic; they enter as isotropic phases with their modulus band, which the isotropic-phase bounds do not strictly cover`] : []),
        ...(s.ir.basis === "unknown" ? [`basis unknown (${s.ir.basisNote}): read as mass fractions`] : []),
      ],
    };
  },
});

export const modulusMoriTanakaRandom = registerSolver({
  ...common,
  id: "material.modulus-mori-tanaka-random",
  version: "1.0.0",
  domain: "material.stiffness",
  fidelity: 1,
  method: "Multi-phase Mori–Tanaka (Benveniste) with randomly oriented spheroids, Eshelby tensor from Heliyon 2024 App. A; matrix = the largest volume fraction; band over the corners of every E, ν and aspect interval",
  regime: "one continuous matrix; perfectly bonded, randomly oriented, non-interacting spheroids; moderate loading; anisotropic fillers treated as isotropic spheroids with their modulus band",
  tolerance: "an estimate (Yun 2023 random-sphere FEA at 35 vol % sits 5 % above it); lies between the HS bounds when the matrix is the softest phase",
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const { rows, missing } = phaseData(s);
    if (missing.length) s.blockers.push(`no cited ${missing.join(", ")}`);
    const shapes = { ...(s.micro.phases || {}) };
    // a platelet's shape is sourced when its thickness and lateral size are (graphene: constituent-properties.js)
    for (const c of s.ir.constituents) {
      const t = span(c.properties.thickness), D = span(c.properties.lateralSize);
      if (!shapes[c.id] && t && D) shapes[c.id] = { aspectRatio: { lo: t.lo / D.hi, hi: t.hi / D.lo }, source: `sourced: platelet thickness / lateral size (${c.properties.thickness.claimRef}, ${c.properties.lateralSize.claimRef})` };
    }
    if (rows.every((r) => r.phi != null)) {
      const mi = rows.reduce((b, r, i) => (r.phi > rows[b].phi ? i : b), 0);
      const needShape = rows.filter((_, i) => i !== mi).filter((r) => {
        const a = span(shapes[r.id]?.aspectRatio);
        return !(a && a.lo > 0);
      }).map((r) => r.id);
      if (needShape.length) s.blockers.push(`no shape (props.micromechanics.phases.<id>.aspectRatio: 1 sphere, > 1 fibre l/d, < 1 platelet t/D) for: ${needShape.join(", ")}`);
      if (s.blockers.length) return blocked(s.blockers);
      const t = rows.reduce((a, r) => a + r.phi, 0);
      const m = rows[mi];
      const band = moriTanakaRandomBand({ E: m.E, nu: m.nu }, rows.filter((_, i) => i !== mi).map((r) => ({ phi: r.phi / t, E: r.E, nu: r.nu, aspect: span(shapes[r.id].aspectRatio) })));
      return {
        inputs: { matrix: { value: m.id, basis: "the largest volume fraction is taken as the continuous phase" }, shapes: { value: Object.fromEntries(rows.filter((_, i) => i !== mi).map((r) => [r.id, { ...span(shapes[r.id].aspectRatio), source: shapes[r.id].source || "props.micromechanics.phases (design input)" }])) } },
        outputs: { modulus: { value: { low: band.low, high: band.high }, unit: "Pa (K, G, E)", basis: `estimate; extremes over ${band.corners} interval corners` } },
        warnings: ["an estimate between the HS bounds, not a bound", "perfect bond and random orientation assumed", ...(s.ir.basis === "unknown" ? [`basis unknown (${s.ir.basisNote}): read as mass fractions`] : [])],
      };
    }
    return blocked(s.blockers);
  },
});
