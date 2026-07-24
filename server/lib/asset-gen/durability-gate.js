// server/lib/asset-gen/durability-gate.js
//
// W1-A — Long-horizon materials degradation engine, the FEA-facing gate.
// Composes degradation-kinetics.js's pure time-integration with the SAME
// unchanged direct-stiffness solver (server/lib/simulation/fea-solver.js#
// runFEA) that thermal-gate.js and aero-gate.js already use — this module
// adds NO new Gaussian elimination and does not modify fea-solver.js.
// Follows the adapter precedent set by those two files: build a
// (degraded) model, call the unchanged solver, report honestly-labeled
// results, never blend real numbers into a fabricated composite.
//
// ── Honest boundary (verbatim — see degradation-kinetics.js for the
// canonical copy) ─────────────────────────────────────────────────────
// Empirical-kinetics engineering practice, not first-principles materials
// physics. Atomistic/molecular-dynamics simulation is out of scope: no
// bond-scale chemistry, no polymer chain-scission mechanism, no
// microstructural evolution. Arrhenius, Paris-Erdogan and Fickian
// diffusion are phenomenological laws whose constants are fitted to
// short-term accelerated tests; this engine extrapolates those fits. No
// 50-year field data is used or claimed. The kinetic-extent → stiffness/
// strength knock-down law is the least-standardised step: there is no
// universal form, the default here is one cited empirical fit, and it is
// caller-overridable precisely because it should be calibrated per
// material system before any result is relied on.
//
// ── 🔴 The fea-solver.js zero-stiffness bug this module guards against ──
// server/lib/simulation/fea-solver.js#buildStiffnessMatrix assigns EVERY
// member's bending stiffness to exactly ONE transverse DOF pair, chosen
// purely from `Math.abs(lz) < 0.001`: members with |lz|<0.001 get bending
// on (uy,rz); everything else gets it on (ux,ry). For a member whose
// direction is (near-)PURELY along global Y (ly≈±1, lx≈0, lz≈0), this
// mislabels the member's own AXIAL direction (uy) as its transverse
// bending direction — so the member's genuine transverse directions (ux,
// uz) receive ZERO stiffness contribution from it. If nothing else braces
// those DOFs, solveSystem's Gaussian elimination hits a near-zero pivot
// and its `if (Math.abs(pivot) < 1e-12) continue;` (fea-solver.js) SILENTLY
// skips that row, leaving the displacement at exactly 0 — reading as
// "infinitely rigid" with NO error surfaced anywhere. Verified empirically
// (not just from the design pass): a vertical (Y-axis) cantilever loaded
// transversely in X returns `dx:0` with `ok:true`, while the identical
// cantilever built along X (loaded transversely in Y) returns the exact
// textbook PL³/3EI. This is exactly the kind of silent zero the
// "compute-don't-guess" doctrine exists to catch — `assertSupportedOrientation`
// below is the guard, and checkDurabilityGate calls it before EVERY
// runFEA call in this module.
//
// (This solver has a broader, related simplification — since only ONE
// transverse DOF pair is ever assigned per member, EVERY member is only
// rigorously modeled for loading in ONE of its two true transverse
// directions, not both, and diagonal members' bending is not resolved
// into a proper local frame at all. This module does not attempt to fix
// that broader limitation — out of scope, and fea-solver.js is
// unchanged-by-mandate — but flags it here for the next reader. The
// specific, verified, silently-wrong-with-no-error case this module
// guards against is the Y-axis one described above, which is also the
// most consequential in practice: a vertical column is an extremely
// common real structural member.)

import { runFEA } from '../simulation/fea-solver.js';
import { getMaterial } from './mass-properties.js';
import {
  getDegradationConstants,
  mechanismAvailable,
} from './degradation-constants.js';
import {
  integrateDegradation,
  arrheniusRatio,
  HONEST_BOUNDARY,
} from '../simulation/degradation-kinetics.js';

const MPA_TO_PA = 1e6;
const ORIENTATION_EPS = 1e-3; // matches fea-solver.js's own `Math.abs(lz) < 0.001` branch threshold exactly

export const DEFAULT_SAMPLE_YEARS = Object.freeze([0, 5, 10, 25, 50]);
export const DEFAULT_KNOCKDOWN_LAW_ID = 'linear-damage-fraction-lemaitre-chaboche';

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Direction cosines + length of a member, computed the same way
 * fea-solver.js's (module-private) memberCosines does — duplicated here in
 * miniature (matching thermal-gate.js's own precedent for this exact
 * duplication) because fea-solver.js does not export it and this module
 * must not modify fea-solver.js. Returns null (never throws) for a
 * dangling node reference or a degenerate (zero-length) member.
 */
function directionCosines(nodes, member) {
  const ni = nodes.find((n) => String(n.id) === String(member.nodeI));
  const nj = nodes.find((n) => String(n.id) === String(member.nodeJ));
  if (!ni || !nj) return null;
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const dz = (nj.z || 0) - (ni.z || 0);
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 0)) return null;
  return { lx: dx / L, ly: dy / L, lz: dz / L, L };
}

/**
 * Guard against fea-solver.js's silent zero-stiffness bug (see file
 * header). Flags any member whose direction is (near-)purely along
 * global Y — the specific, verified, silently-wrong case — and any
 * member with a dangling node reference or zero length (which
 * fea-solver.js's own nodeIndex()/memberCosines() would throw on, so this
 * surfaces that as an honest pre-check failure instead of an uncaught
 * exception mid-solve).
 * @param {Array} nodes [{id,x,y,z}]
 * @param {Array} members [{id,nodeI,nodeJ,...}]
 * @returns {{ok:boolean, reason?:string, memberIds?:string[]}}
 */
export function assertSupportedOrientation(nodes, members) {
  const badIds = [];
  for (const m of members) {
    const dc = directionCosines(nodes, m);
    if (!dc) {
      badIds.push(String(m.id));
      continue;
    }
    const { lx, lz } = dc;
    if (Math.abs(lz) < ORIENTATION_EPS && Math.abs(lx) < ORIENTATION_EPS) {
      badIds.push(String(m.id));
    }
  }
  return badIds.length > 0
    ? { ok: false, reason: 'unsupported_member_orientation', memberIds: badIds }
    : { ok: true };
}

/**
 * The default knock-down law — see this module's honest boundary above
 * and degradation-constants.js's per-material `knockdown` citation
 * (Lemaitre & Chaboche, "Mechanics of Solid Materials", 1990): a scalar
 * damage variable D = clamp(thermalExtent + leachFraction, 0, 1) linearly
 * reduces both modulus and yield strength, E_eff = E0·(1−D). Crack length
 * reduces cross-section area/moment-of-inertia via a SEPARATE net-section
 * approximation (state.crackFraction = a_crack/thickness, precomputed by
 * the caller since thickness is per-member, not a material property):
 * area scales linearly with remaining depth (b·h→b·(h−a)), moment of
 * inertia scales with remaining-depth CUBED (I=b·h³/12 for a rectangular
 * section — a standard simplified residual-strength approximation, in
 * the spirit of ASME B31G-style net-section-reduction methodology, NOT a
 * full crack-tip stress-intensity residual-strength calculation).
 * @param {{material:object, state:object, constants:object|null}} args
 * @returns {{E_Pa:number, yield_Pa:number, areaFactor:number, momentIFactor:number, lawUsed:string}}
 */
function defaultKnockdownLaw({ material, state }) {
  const D = clamp01((state.thermalExtent || 0) + (state.leachFraction || 0));
  const E0_Pa = material.E * MPA_TO_PA;
  const yield0_Pa = material.yield * MPA_TO_PA;
  const remaining = clamp01(1 - (state.crackFraction || 0));
  return {
    E_Pa: E0_Pa * (1 - D),
    yield_Pa: yield0_Pa * (1 - D),
    areaFactor: remaining,
    momentIFactor: Math.pow(remaining, 3),
    lawUsed: DEFAULT_KNOCKDOWN_LAW_ID,
  };
}

/**
 * Map a degradation state (+ material + cited constants) to knocked-down
 * absolute properties, via the default law (defaultKnockdownLaw) or a
 * caller-supplied `lawOverride(args)` with the SAME signature. Every
 * result echoes `lawUsed` so a caller can never mistake which knock-down
 * law produced a given number — see this module's honest-boundary note on
 * why this mapping is the least-standardised step in the whole engine.
 * @param {object} material a getMaterial() result (mass-properties.js — E, yield in MPa)
 * @param {{thermalExtent?:number, leachFraction?:number, crackFraction?:number}} state
 * @param {object|null} constants a getDegradationConstants() result (echoed for provenance)
 * @param {Function} [lawOverride] optional custom law, same signature as defaultKnockdownLaw
 * @returns {{E_Pa:number, yield_Pa:number, areaFactor:number, momentIFactor:number, lawUsed:string, material:string, constantsKey:string|null}}
 */
export function degradedProperties(material, state, constants, lawOverride) {
  const law = typeof lawOverride === 'function' ? lawOverride : defaultKnockdownLaw;
  const out = law({ material, state, constants });
  return {
    ...out,
    material: material.key || material.label,
    constantsKey: constants?.key ?? null,
  };
}

/**
 * Build a NEW beam-frame model (never mutates baseModel) with every
 * member's elasticModulus/allowableStress/area/momentI scaled by the
 * degraded factors. Scaling (rather than overwriting with absolute
 * material-table values) means this composes correctly even when the
 * caller's baseModel already bakes in its own safety factor or
 * geometry-specific section properties — exactly the same "never mutate,
 * always return a new model" contract as thermal-gate.js/aero-gate.js.
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} baseModel
 * @param {{E_Pa:number, yield_Pa:number, areaFactor:number, momentIFactor:number}} degraded
 * @returns {object} a new model, same shape as baseModel
 */
export function buildDegradedModel(baseModel, degraded) {
  // Every member gets the SAME material-level degraded absolute E/yield
  // (this module models one material per gate call, matching thermal-
  // gate.js/aero-gate.js's own single-material-per-call convention) — area
  // and momentI are scaled per-member instead, since section geometry
  // (and thus how a given crack fraction reduces it) is per-member, not
  // material-level.
  return {
    ...baseModel,
    members: baseModel.members.map((m) => ({
      ...m,
      elasticModulus: degraded.E_Pa,
      allowableStress: degraded.yield_Pa,
      area: m.area * degraded.areaFactor,
      momentI: m.momentI * degraded.momentIFactor,
    })),
  };
}

/**
 * Run the real solver once per sample year against the SAME beam-frame
 * model — baseline (year 0, zero degradation) plus one solve per year in
 * `opts.sampleYears` with that year's degraded properties superposed —
 * and report each honestly. NEVER fabricates a pass: bad input, an
 * unsupported member orientation, an unknown/uncited material, a
 * requested mechanism this material has no real constants for, a crack
 * that exceeds the section, or a solver failure are all reported as an
 * honest `ok:false, reason`.
 *
 * `ok` is pass-at-FINAL-sampled-year only (never blended across years);
 * `firstFailureYear` (the first sampled year with `allPass:false`, or
 * null) is reported separately — see this module's header.
 *
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} model
 * @param {object} opts
 * @param {string} opts.materialKey a MATERIAL_LIBRARY / DEGRADATION_CONSTANTS key
 * @param {string[]} [opts.mechanisms=['fatigue']] subset of ['fatigue','thermal','moisture']
 * @param {{deltaSigma:number, Y:number, a0?:number, thickness:number, cyclesPerYear?:number}} [opts.fatigue]
 * @param {{temperatureK:number}} [opts.thermal]
 * @param {{h:number, temperatureK?:number}} [opts.moisture]
 * @param {number[]} [opts.sampleYears=DEFAULT_SAMPLE_YEARS]
 * @param {Function} [opts.lawOverride]
 * @returns {object}
 */
export function checkDurabilityGate(model, opts = {}) {
  const {
    materialKey,
    mechanisms = ['fatigue'],
    fatigue,
    thermal,
    moisture,
    sampleYears = DEFAULT_SAMPLE_YEARS,
    lawOverride,
  } = opts;

  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.members)) {
    return { ok: false, reason: 'bad_model_input', honestBoundary: HONEST_BOUNDARY };
  }
  if (model.nodes.length === 0 || model.members.length === 0) {
    return { ok: false, reason: 'bad_model_input', honestBoundary: HONEST_BOUNDARY };
  }
  const supports = Array.isArray(model.supports) ? model.supports : [];
  if (supports.length === 0) {
    return { ok: false, reason: 'missing_supports', honestBoundary: HONEST_BOUNDARY };
  }

  const orientationCheck = assertSupportedOrientation(model.nodes, model.members);
  if (!orientationCheck.ok) {
    return { ...orientationCheck, honestBoundary: HONEST_BOUNDARY };
  }

  const material = getMaterial(materialKey);
  if (!material) {
    return { ok: false, reason: 'unknown_material', material: materialKey, honestBoundary: HONEST_BOUNDARY };
  }
  const constants = getDegradationConstants(materialKey);
  if (!constants) {
    return { ok: false, reason: 'missing_degradation_constants', material: materialKey, honestBoundary: HONEST_BOUNDARY };
  }
  for (const mech of mechanisms) {
    if (!mechanismAvailable(constants, mech)) {
      return {
        ok: false,
        reason: 'missing_degradation_constants',
        material: materialKey,
        mechanism: mech,
        honestBoundary: HONEST_BOUNDARY,
      };
    }
  }

  const mechanicalLoads = Array.isArray(model.loads) ? model.loads : [];

  // Resolve a temperature-corrected diffusion coefficient once, up front,
  // if 'moisture' is requested and the caller supplied a temperature
  // different from the material's cited referenceTempK. Uses
  // arrheniusRatio (ratio form — no absolute A needed), matching how
  // degradation-constants.js documents its arrhenius entries are meant to
  // be used for diffusion temperature-correction.
  let diffusionD = constants.diffusion?.D_m2_s;
  if (mechanisms.includes('moisture') && moisture?.temperatureK && constants.arrhenius) {
    const ratio = arrheniusRatio({
      Ea_J_per_mol: constants.arrhenius.Ea_J_per_mol,
      T1_K: constants.diffusion.referenceTempK,
      T2_K: moisture.temperatureK,
    });
    diffusionD = constants.diffusion.D_m2_s * ratio;
  }
  const effectiveConstants = diffusionD !== constants.diffusion?.D_m2_s
    ? { ...constants, diffusion: { ...constants.diffusion, D_m2_s: diffusionD } }
    : constants;

  const baselineRes = runFEA({ nodes: model.nodes, members: model.members, loads: mechanicalLoads, supports });
  if (!baselineRes.ok) {
    return { ok: false, reason: 'fea_solve_failed', error: baselineRes.error, honestBoundary: HONEST_BOUNDARY };
  }

  const samples = [];
  let firstFailureYear = null;

  for (const year of sampleYears) {
    const integrated = integrateDegradation({
      mechanisms,
      constants: effectiveConstants,
      fatigue,
      thermal,
      moisture,
      years: year,
    });
    if (!integrated.ok) {
      return { ...integrated, material: materialKey, honestBoundary: HONEST_BOUNDARY };
    }

    const crackFraction = mechanisms.includes('fatigue') && Number.isFinite(fatigue?.thickness)
      ? clamp01(integrated.a_crack / fatigue.thickness)
      : 0;
    const state = {
      a_crack: integrated.a_crack,
      thermalExtent: integrated.thermalExtent,
      leachFraction: integrated.leachFraction,
      crackFraction,
    };
    const degraded = degradedProperties(material, state, effectiveConstants, lawOverride);
    const degradedModel = buildDegradedModel(
      { nodes: model.nodes, members: model.members, loads: mechanicalLoads, supports },
      degraded,
    );
    const res = runFEA(degradedModel);
    if (!res.ok) {
      return { ok: false, reason: 'fea_solve_failed', error: res.error, year, honestBoundary: HONEST_BOUNDARY };
    }

    const allPass = res.summary.allPass;
    if (!allPass && firstFailureYear === null) firstFailureYear = year;

    samples.push({
      year,
      allPass,
      utilization: res.summary.maxUtilization,
      state,
      lawUsed: degraded.lawUsed,
    });
  }

  const finalSample = samples[samples.length - 1];

  return {
    ok: finalSample.allPass,
    material: materialKey,
    mechanisms,
    baseline: { utilization: baselineRes.summary.maxUtilization },
    samples,
    firstFailureYear,
    lawUsed: finalSample.lawUsed,
    honestBoundary: HONEST_BOUNDARY,
  };
}
