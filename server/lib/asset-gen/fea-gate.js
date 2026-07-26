// server/lib/asset-gen/fea-gate.js
//
// Program C, Stage 4 — FEA-based structural validation gate for generated
// assets. Per CLAUDE.md's "compute-don't-guess" doctrine, the structural
// math is NOT hand-derived here: this module builds a beam-frame model from
// the mesh generator's already-emitted `beam.stations` co-product
// (server/lib/asset-gen/parametric-mesh.js) and hands it to the existing,
// UNCHANGED direct-stiffness solver (server/lib/simulation/fea-solver.js).
// The solver is the spec; this module is only the adapter + pass/fail gate.
//
// Why not feed the closed triangle mesh into the solver directly? The
// solver is a BEAM-FRAME method (nodes + 1D members with section
// properties), not a solid/shell FEA — it has no concept of a triangle
// soup. The mesh generator already co-emits the right abstraction for this
// (a sequence of stations with area + moment-of-inertia along the
// centerline), so this module consumes that lightweight abstraction
// instead of reverse-engineering beam properties from raw triangles.

import { runFEA } from "../simulation/fea-solver.js";
import { getMaterial } from "./mass-properties.js";

// ── Tunable constants (named, not magic numbers) ────────────────────────
//
// Citations (doc-only — no behavior here changes; see this file's other
// comments for the actual pass/fail logic):
//
// (a) NEAR-TIP TRUNCATION — justified by Saint-Venant's principle, not an
//     arbitrary cutoff. A linearly-tapered beam that runs all the way to a
//     true zero-area point is a genuine stress SINGULARITY: 1D
//     Euler-Bernoulli theory assumes a slowly-varying cross-section, and
//     Mc/I diverges as the section area (and thus I) goes to zero, so mesh
//     refinement near a mathematical point never converges — it's a
//     modeling artifact of idealizing the tip as a perfect point, not a
//     real load path. Saint-Venant's principle (see COMSOL's own explainer
//     on singularities and mesh convergence,
//     https://www.comsol.com/support/learning-center/article/Singularities-in-Finite-Element-Models-Their-Causes-Effects-and-Workarounds-52971,
//     and standard tapered-beam FEA practice) is why real structural
//     analysis evaluates stress away from a singular point/sharp reentrant
//     feature rather than driving refinement into it — the influence of a
//     locally-idealized geometric detail is expected to die out over a
//     distance comparable to the section's own dimension, so truncating
//     before the singularity and evaluating the beam over the region it can
//     still legitimately represent is standard, not a shortcut. See
//     MIN_SECTION_AREA_FRACTION below for where this module draws that line.
// (b) SAFETY FACTOR ≈1.5 — DEFAULT_SAFETY_FACTOR is a generic
//     mechanical-design floor (Shigley-class "Mechanical Engineering
//     Design" guidance: SF in the 1.5–2 range for well-characterized loads
//     and materials with well-known properties under controlled conditions,
//     higher for uncertain loads/materials/environments). It is NOT a
//     sword-specific or bladed-weapon-specific figure — it's the textbook
//     floor for the "known load, known material" end of the guidance range,
//     used here because DEFAULT_TIP_LOAD_N is itself only an engineering
//     assumption (see (c)), not because 1.5 was derived for swords.
// (c) DEFAULT_TIP_LOAD_N = 50 — an engineering ASSUMPTION (a "moderate
//     lateral parry/flick load"), not a measured value. Real bladed-weapon
//     flex testing exists — e.g. the SCA (Society for Creative Anachronism)
//     rattan/reenactment-weapon convention — but those tests calibrate
//     loads for padded/rattan reenactment weapons, not for a steel blade
//     under a structural parry/impact load, so they are NOT a like-for-like
//     substitute for this module's 50N figure. Treat 50N as a placeholder
//     "moderate" load until a real measured or use-case-specific figure
//     replaces it (override via opts.tipLoadN in the meantime).
export const DEFAULT_SAFETY_FACTOR = 1.5; // combinedStress ≤ yield / SF to "pass"
export const DEFAULT_TIP_LOAD_N = 50; // a moderate lateral parry/flick load applied at the retained near-tip region (engineering assumption, not a measured value — override via opts.tipLoadN)
export const MIN_SECTION_AREA_M2 = 1e-9; // absolute floor: a station at/below this area is a literal geometric degeneracy (e.g. the exact zero-area point of a linear taper) and can never be a real beam member end regardless of the relative floor below
// A linearly-tapered diamond blade approaches a true geometric point at the
// tip — a real stress SINGULARITY for 1D Euler-Bernoulli beam theory (which
// assumes a slowly-varying cross-section), not a modeling artifact. Real
// structural practice doesn't beam-model all the way to a knife edge; it
// truncates (or the physical part has a small manufactured flat/radius
// there instead of a mathematical point). This module truncates the beam
// chain at the last station whose area is still at least this fraction of
// the chain's largest (root) station area, and treats THAT as the modeled
// "tip" — the region closest to the point that Euler-Bernoulli beam theory
// can still meaningfully represent for a swept diamond taper. (See citation
// (a) above — this is the concrete Saint-Venant-justified cutoff.)
export const MIN_SECTION_AREA_FRACTION = 0.4;
export const MAX_OPTIMIZE_ITERS = 12;
export const DEFAULT_THICKEN_FACTOR = 1.15; // per-iteration multiplicative bump to the failing dimension

const MPA_TO_PA = 1e6;

// ── Non-blade use cases (mace / staff / shield) ──────────────────────────
//
// "sword-bending" (above) is the wrong physics for anything that isn't a
// tapered-to-a-point blade — a mace/staff/shield loaded as if it were a
// bending blade is a WRONG ANSWER delivered confidently, which is worse
// than no answer (see CLAUDE.md's honest-by-construction doctrine). Each
// use case below gets its own model (fixed end, load direction) matched to
// how that archetype actually gets loaded in use, per the SAME
// compute-don't-guess discipline DEFAULT_TIP_LOAD_N already established:
// every load magnitude is either a stated engineering assumption (same
// epistemic status as DEFAULT_TIP_LOAD_N's "moderate parry/flick" figure)
// or DERIVED from one via `estimateImpactForceN`, using REAL mass figures
// already grounded in this tree's own material library + generated
// geometry (never an invented weapon weight) — never hand-picked to make a
// result look clean. Where a derivation produces a nonsensical or
// uninformative result (see the shield-face-load note below), that is
// reported as a finding, not tuned away.

/**
 * Peak contact force from a standard work-energy blunt-impact estimate: a
 * mass carrying kinetic energy KE = ½mv² is brought to rest over a short
 * contact "stopping distance" — assuming an approximately constant
 * retarding force over that distance (the same simplified technique used
 * across blunt-impact/PPE-testing engineering estimates), F·d = KE ⟹
 * F = KE / d. This is an ENGINEERING ESTIMATE, not a measured value — same
 * epistemic status as DEFAULT_TIP_LOAD_N above. Exported so the derivation
 * itself (not just its numeric output) is independently testable.
 *
 * @param {number} massKg
 * @param {number} speedMs assumed impact speed
 * @param {number} stopDistanceM assumed contact deformation depth
 * @returns {number} force in Newtons, or NaN on a non-positive input
 */
export function estimateImpactForceN(massKg, speedMs, stopDistanceM) {
  if (!(massKg > 0) || !(speedMs > 0) || !(stopDistanceM > 0)) return NaN;
  const ke = 0.5 * massKg * speedMs * speedMs;
  return ke / stopDistanceM;
}

// STAFF-SWING rationale: a quarterstaff is worked two-handed for BOTH a
// controlled thrust (axial, sustained force resisted by the rear hand /
// stance) and a committed strike or parry (transverse, brief peak-impact
// force) — the combined case is the realistic worst-case load on the
// haft, not either alone.
export const STAFF_THRUST_AXIAL_N = 300; // a firm two-handed controlled thrust — generic ergonomics push-force guidance places a sustained two-hand push in the low hundreds of newtons; not a staff-specific measurement, same "moderate assumption" framing as DEFAULT_TIP_LOAD_N.
export const STAFF_STRIKE_SPEED_MS = 8; // assumed committed-but-not-maximal strike tip speed — an engineering assumption, not a measured value.
export const STAFF_STRIKE_STOP_DISTANCE_M = 0.02; // 2cm assumed contact deformation depth for a semi-rigid strike (a parry / blocked strike against another weapon or a guard, not a fully rigid collision where d→0 and force→∞).
export const STAFF_REFERENCE_MASS_KG = 0.635; // generateStaffMesh({}) run through massProperties(_, 'douglas-fir') — a REAL computed mass for the default staff geometry, not an invented weapon weight; cross-checked against the live generator in server/tests/fea-gate-archetypes.test.js.
export const DEFAULT_STAFF_STRIKE_TRANSVERSE_N = Math.round(
  estimateImpactForceN(STAFF_REFERENCE_MASS_KG, STAFF_STRIKE_SPEED_MS, STAFF_STRIKE_STOP_DISTANCE_M),
); // ≈1016N

// MACE-IMPACT rationale: a mace/flanged-hammer strike drives the head
// straight into a target along the swing's line of travel; at the instant
// of contact the deceleration force transmits back through the
// handle/collar/head chain as a predominantly AXIAL (compressive) load —
// this is a compression/impact case, not a transverse-bending case (that
// would be the wrong physics for a blunt weapon's actual load path — see
// the file header's WRONG-ANSWER warning).
export const MACE_IMPACT_SPEED_MS = 6; // assumed one-handed mace swing tip speed at contact — heavier than a staff, so a slower assumed swing speed; an engineering assumption, not a measured value.
export const MACE_IMPACT_STOP_DISTANCE_M = 0.01; // 1cm assumed contact deformation — stiffer contact than the staff case (a blunt weapon striking armor/wood/bone gives less than a parry against another weapon).
export const MACE_REFERENCE_MASS_KG = 3.67; // generateMaceMesh({}) run through massProperties(_, 'steel-a36') — REAL computed mass for the default mace geometry; cross-checked in server/tests/fea-gate-archetypes.test.js.
export const DEFAULT_MACE_IMPACT_AXIAL_N = Math.round(
  estimateImpactForceN(MACE_REFERENCE_MASS_KG, MACE_IMPACT_SPEED_MS, MACE_IMPACT_STOP_DISTANCE_M),
); // ≈6606N

// SHIELD-FACE-LOAD rationale: a shield's beam co-product runs along its
// DEPTH axis (front face → boss apex), not across its 0.35m face radius —
// that IS the direction a face blow's momentum transfers through the
// material, so modeling it as an AXIAL load (root = the wielder's braced
// arm side at the shield's rear face, tip = the last non-degenerate
// station reached after the boss's true zero-area apex point is excluded
// — see buildFullChainFrameModel's doc-comment) is a defensible reading of
// the available geometry. The blow itself is modeled as absorbing a full
// committed weapon strike (reusing this tree's OWN default sword mass —
// "material properties already in the tree", per CLAUDE.md).
//
// FINDING (see server/tests/fea-gate-archetypes.test.js for the numbers):
// this use case converges trivially (maxUtilization on the order of 1e-3
// or smaller) for ANY plausible blow force, because the depth-axis "beam"
// spans only the plate thickness + boss height (a few centimeters) with a
// cross-sectional area equal to the ENTIRE shield face (~0.38 m² at
// default proportions) — an enormous area for a stubby member. That is
// NOT evidence the shield is structurally safe against a real blow; a
// shield's actual failure mode (localized puncture/crack, or flexural
// bending across the 0.35m face radius under an off-center strike) needs
// 2D plate/shell FEA, which this 1D beam-frame solver does not do and the
// mesh's beam co-product (no radial station chain exists) cannot supply
// either. Read a "pass" here as "the depth-axis material stack doesn't
// axially crush under a square hit," nothing broader.
export const SHIELD_BLOW_SPEED_MS = 15; // assumed committed weapon-swing tip speed at contact — an engineering assumption, not a measured value.
export const SHIELD_BLOW_STOP_DISTANCE_M = 0.005; // 5mm assumed contact deformation — stiff edge/wood-on-wood contact, less give than the staff-parry case.
export const SHIELD_ATTACKER_MASS_KG = 1.19; // generateSwordMesh({}) run through massProperties(_, 'steel-a36') — the shield is modeled as absorbing a full committed sword-class blow, using this tree's OWN real computed sword mass rather than an invented attacker weapon weight.
export const DEFAULT_SHIELD_BLOW_AXIAL_N = Math.round(
  estimateImpactForceN(SHIELD_ATTACKER_MASS_KG, SHIELD_BLOW_SPEED_MS, SHIELD_BLOW_STOP_DISTANCE_M),
); // ≈26787N

// Use-case registry: "kind":"blade" routes through buildBladeFrameModel
// (approximation:true / diamond-only stations, tip-loaded); "kind":"chain"
// routes through buildFullChainFrameModel (the archetype's FULL station
// chain, tip-loaded with the stated axial/transverse combination). Default
// loads here are the DERIVED figures above; callers may override via
// opts.axialLoadN / opts.transverseLoadN exactly as opts.tipLoadN already
// overrides the blade case's default.
const USE_CASES = Object.freeze({
  "sword-bending": { kind: "blade" },
  "mace-impact": { kind: "chain", axialLoadN: DEFAULT_MACE_IMPACT_AXIAL_N, transverseLoadN: 0 },
  "staff-swing": { kind: "chain", axialLoadN: STAFF_THRUST_AXIAL_N, transverseLoadN: DEFAULT_STAFF_STRIKE_TRANSVERSE_N },
  "shield-face-load": { kind: "chain", axialLoadN: DEFAULT_SHIELD_BLOW_AXIAL_N, transverseLoadN: 0 },
});

/**
 * The mesh generator's `crossSectionProps` (parametric-mesh.js) reuses the
 * RECTANGLE moment-of-inertia formula (b·h³/12) for diamond/rhombus blade
 * cross-sections and flags this with `approximation: true` on the station
 * (see that file's HONESTY_NOTES). physics-compute.js#momentOfInertia's
 * `"rhombus"`/`"diamond"` case computes the TRUE centroidal value b·h³/48
 * for the identical b×h — an EXACT 1/4 of the rectangle formula (both are
 * linear in b and h³; only the constant denominator differs, 12 vs 48), so
 * correcting an `approximation:true` station never requires re-deriving b
 * and h from area — dividing the transcribed rectangle-formula value by 4
 * reproduces physics-compute.js's rhombus formula bit-for-bit. This keeps
 * the fix entirely on the fea-gate.js side of the boundary — no edit to
 * parametric-mesh.js is needed (see server/tests/fea-gate.test.js for the
 * pinning proof that dividing by 4 exactly equals calling
 * momentOfInertia("rhombus", ...) directly).
 *
 * @param {{momentOfInertia:number, approximation?:boolean}} station
 * @returns {number} corrected (or already-correct) moment of inertia
 */
export function correctedMomentOfInertia(station) {
  return station.approximation ? station.momentOfInertia / 4 : station.momentOfInertia;
}

/**
 * Build a beam-frame FE model (nodes/members/loads/supports) from a beam
 * co-product's stations, restricted to the stations flagged
 * `approximation: true` — i.e. the diamond-section BLADE portion of a
 * sword's `beam.stations` (the hilt/guard sections are circle/rect and use
 * an already-exact moment-of-inertia, but the sword-bending use case is
 * specifically about the blade under a transverse parry/impact load, per
 * the "blade root fixed, tip loaded" cantilever convention below).
 *
 * Model: a cantilever. The first (root, closest to the guard) usable
 * station is fully fixed (the tang/guard is assumed structurally rigid
 * relative to the thin blade — a standard simplification for a
 * blade-bending check). Consecutive stations become 2-node beam elements
 * with each member's area/momentI taken as the AVERAGE of its two end
 * stations' (corrected) properties — the standard constant-section
 * approximation for a linearly-tapered beam element. The transverse
 * "impact/parry" load is applied at the LAST usable station (nearest the
 * modeled tip); stations below MIN_SECTION_AREA_FRACTION of the chain's
 * largest (root) station area are excluded (see that constant's doc-comment)
 * — including, always, the mathematical zero-area point exactly at t=1,
 * since a literal zero cross-section is a geometric idealization, not a
 * physical member: dividing force by zero area would be a fabricated
 * infinite stress, not an honest one.
 */
function buildBladeFrameModel(stations, { totalLength, tipLoadN, material, safetyFactor }) {
  let bladeStations = stations
    .filter((st) => st.approximation === true)
    .filter((st) => st.area > MIN_SECTION_AREA_M2)
    .slice() // don't mutate caller's array
    .sort((a, b) => a.s - b.s);

  if (bladeStations.length >= 1) {
    const maxArea = Math.max(...bladeStations.map((st) => st.area));
    const areaFloor = maxArea * MIN_SECTION_AREA_FRACTION;
    bladeStations = bladeStations.filter((st) => st.area >= areaFloor);
  }

  if (bladeStations.length < 2) {
    return { error: "insufficient_blade_stations", count: bladeStations.length };
  }

  const nodes = bladeStations.map((st, i) => ({ id: i, x: st.s * totalLength, y: 0, z: 0 }));

  const E_Pa = material.E * MPA_TO_PA;
  const allowable_Pa = (material.yield * MPA_TO_PA) / safetyFactor;

  const members = [];
  for (let i = 0; i < bladeStations.length - 1; i++) {
    const a = bladeStations[i];
    const b = bladeStations[i + 1];
    const area = (a.area + b.area) / 2;
    const momentI = (correctedMomentOfInertia(a) + correctedMomentOfInertia(b)) / 2;
    members.push({
      id: `blade-${i}`,
      nodeI: i,
      nodeJ: i + 1,
      area,
      momentI,
      elasticModulus: E_Pa,
      allowableStress: allowable_Pa,
      // Depth of the section (for Mc/I extreme-fiber distance) — for a
      // rhombus/diamond with diagonals width×thickness, the diamond's
      // "height" diagonal IS the full thickness (2·halfThickness); the
      // solver's computeStresses falls back to sqrt(area)/2 when depthIn
      // is absent, which is a reasonable generic estimate but not exact
      // for a rhombus, so supply the real half-thickness extreme-fiber
      // distance directly via depthIn (member depth = 2·c).
      depthIn: stationThickness(a, b),
    });
  }

  const supports = [{ nodeId: 0, fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] }];
  const loads = [{ nodeId: bladeStations.length - 1, Fy: tipLoadN }];

  return { nodes, members, loads, supports, allowable_Pa, bladeStations };
}

/**
 * Recover an approximate physical thickness (the diamond's "height"
 * diagonal) from a station's `area` (rhombus area = width·thickness/2 =
 * b·h/2) and its corrected momentOfInertia (b·h³/48): dividing
 * momentOfInertia by area gives h²/24, so h = sqrt(24 · I / area). Used
 * only to give computeStresses a real extreme-fiber distance instead of
 * its generic sqrt(area)/2 fallback — not load-bearing to the pass/fail
 * math (utilization already derives from the correct I directly).
 */
function stationThickness(a, b) {
  const area = (a.area + b.area) / 2;
  const I = (correctedMomentOfInertia(a) + correctedMomentOfInertia(b)) / 2;
  if (area <= 0 || I <= 0) return undefined;
  return Math.sqrt(24 * I / area); // = h; depthIn expects full depth (2c), and c = h/2, so depthIn = h
}

/**
 * Merge stations that share an (near-)identical normalized position `s`.
 * Every multi-section, non-blade archetype (staff grip→orb, mace
 * handle→collar→head, shield plate→boss) emits TWO stations at the exact
 * same x at each section junction — one from each section's own local
 * parameterization (see assembleArchetype in parametric-mesh.js). A beam
 * element between two nodes at the same coordinate has ZERO length
 * (division by zero in the stiffness formulation), and physically there is
 * no length over which to average two different cross-sections meeting at
 * a true step change — it isn't a taper. Keep the WEAKER (smaller-area)
 * side of any coincident pair: the conservative choice, so a real
 * stress-concentrating step is never hidden behind the stronger side's
 * properties.
 */
function dedupeCoincidentStations(stations) {
  const bySKey = new Map();
  for (const st of stations) {
    const key = st.s.toFixed(9);
    const prev = bySKey.get(key);
    if (!prev || st.area < prev.area) bySKey.set(key, st);
  }
  return [...bySKey.values()].sort((a, b) => a.s - b.s);
}

/**
 * Extreme-fiber depth for a chain member spanning stations a→b, averaged
 * across both endpoints (same convention as stationThickness). Unlike the
 * blade-only stationThickness, a full-chain member can be EITHER a diamond
 * (mace head, approximation:true — same rhombus back-derivation as the
 * blade case) OR a circle (every other section in these four archetypes:
 * haft/handle/collar/grip/orb/plate/boss — see parametric-mesh.js's
 * section shapes). Circle depth is recovered EXACTLY from area = πr²
 * (unlike a generic rect, there is no aspect-ratio ambiguity for a
 * circle — area alone determines the radius).
 */
function stationDepth(a, b) {
  const depthFor = (st) => {
    if (!(st.area > 0)) return undefined;
    if (st.approximation) {
      const I = correctedMomentOfInertia(st);
      return I > 0 ? Math.sqrt(24 * I / st.area) : undefined; // rhombus h
    }
    return 2 * Math.sqrt(st.area / Math.PI); // circle diameter
  };
  const da = depthFor(a);
  const db = depthFor(b);
  if (da === undefined || db === undefined) return undefined;
  return (da + db) / 2;
}

/**
 * Build a beam-frame FE model from an archetype's FULL beam-station chain
 * (every section in sequence) — the counterpart to buildBladeFrameModel
 * for archetypes whose failure-relevant load path runs through circular
 * (haft/handle/collar) or blunt-diamond (mace head) sections rather than a
 * tapered-to-a-point blade. Same cantilever convention as the blade model:
 * the ROOT station (x=0 — the held/braced end: a two-handed grip, a
 * one-handed haft, or the wielder's braced arm behind a shield) is fully
 * fixed; the load is applied at the LAST usable station (nearest the
 * working end — a striking tip, an impact head, or a shield's face) after
 * the same MIN_SECTION_AREA_M2 floor excludes any literal zero-area point
 * (the shield boss's domed apex) for the identical Saint-Venant reason the
 * blade model already documents. Stations are also passed through
 * dedupeCoincidentStations to resolve the section-junction duplicate-x
 * issue described on that function.
 */
function buildFullChainFrameModel(stations, { totalLength, material, safetyFactor, axialLoadN = 0, transverseLoadN = 0 }) {
  let chain = stations
    .filter((st) => st.area > MIN_SECTION_AREA_M2)
    .slice() // don't mutate caller's array
    .sort((a, b) => a.s - b.s);
  chain = dedupeCoincidentStations(chain);

  if (chain.length < 2) {
    return { error: "insufficient_chain_stations", count: chain.length };
  }

  const nodes = chain.map((st, i) => ({ id: i, x: st.s * totalLength, y: 0, z: 0 }));

  const E_Pa = material.E * MPA_TO_PA;
  const allowable_Pa = (material.yield * MPA_TO_PA) / safetyFactor;

  const members = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const area = (a.area + b.area) / 2;
    const momentI = (correctedMomentOfInertia(a) + correctedMomentOfInertia(b)) / 2;
    members.push({
      id: `member-${i}`,
      nodeI: i,
      nodeJ: i + 1,
      area,
      momentI,
      elasticModulus: E_Pa,
      allowableStress: allowable_Pa,
      depthIn: stationDepth(a, b),
    });
  }

  const supports = [{ nodeId: 0, fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] }];
  const load = {};
  if (axialLoadN) load.Fx = axialLoadN;
  if (transverseLoadN) load.Fy = transverseLoadN;
  const loads = [{ nodeId: chain.length - 1, ...load }];

  return { nodes, members, loads, supports, allowable_Pa, chain };
}

/**
 * Run the beam-frame FEA solver against a generated part's beam co-product
 * and gate on stress utilization. NEVER fabricates a pass — any solver
 * failure or missing precondition is reported as an honest `ok:false`.
 *
 * @param {{stations:Array, totalLength?:number}} beam the mesh generator's
 *   `mesh.beam` co-product; pass `totalLength` either on this object or in
 *   `opts.totalLength` (mesh.meta.totalLength for generateSwordMesh output)
 * @param {object} [opts]
 * @param {string} [opts.material="steel-a36"] MATERIAL_LIBRARY key
 * @param {string} [opts.useCase="sword-bending"] one of the USE_CASES keys:
 *   "sword-bending" (tapered blade under a transverse tip load — also
 *   correct, unmodified, for the spear head, which uses the same diamond
 *   cross-section), "mace-impact" (axial compression through the
 *   handle→collar→head chain from a swing impact), "staff-swing" (combined
 *   axial thrust + transverse strike on the haft), "shield-face-load"
 *   (axial compression along the shield's depth axis from a face blow —
 *   see that use case's doc-comment above for its representational
 *   limits).
 * @param {number} [opts.totalLength] overrides beam.totalLength
 * @param {number} [opts.tipLoadN=DEFAULT_TIP_LOAD_N] transverse tip load (N) — "sword-bending" only
 * @param {number} [opts.axialLoadN] axial load (N) — "chain"-kind use cases only; defaults to that use case's derived figure
 * @param {number} [opts.transverseLoadN] transverse load (N) — "chain"-kind use cases only; defaults to that use case's derived figure
 * @param {number} [opts.safetyFactor=DEFAULT_SAFETY_FACTOR]
 * @returns {{ok:boolean, maxUtilization:number, failingStations:Array, worstStress:number, allowable:number, reason?:string}}
 */
export function structuralCheck(beam, opts = {}) {
  const {
    material = "steel-a36",
    useCase = "sword-bending",
    totalLength = beam?.totalLength,
    tipLoadN = DEFAULT_TIP_LOAD_N,
    axialLoadN,
    transverseLoadN,
    safetyFactor = DEFAULT_SAFETY_FACTOR,
  } = opts;

  const caseDef = USE_CASES[useCase];
  if (!caseDef) {
    return { ok: false, reason: "unsupported_use_case", useCase };
  }
  if (!beam || !Array.isArray(beam.stations)) {
    return { ok: false, reason: "bad_beam_input" };
  }
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return { ok: false, reason: "missing_total_length" };
  }
  const mat = getMaterial(material);
  if (!mat) {
    return { ok: false, reason: "unknown_material", material };
  }

  let model;
  let idPrefix;
  let resolvedAxialLoadN;
  let resolvedTransverseLoadN;
  if (caseDef.kind === "blade") {
    if (!Number.isFinite(tipLoadN) || tipLoadN <= 0) {
      return { ok: false, reason: "bad_tip_load" };
    }
    model = buildBladeFrameModel(beam.stations, { totalLength, tipLoadN, material: mat, safetyFactor });
    idPrefix = "blade";
  } else {
    resolvedAxialLoadN = axialLoadN !== undefined ? axialLoadN : caseDef.axialLoadN;
    resolvedTransverseLoadN = transverseLoadN !== undefined ? transverseLoadN : caseDef.transverseLoadN;
    const bothNonPositive = !(resolvedAxialLoadN > 0) && !(resolvedTransverseLoadN > 0);
    if (!Number.isFinite(resolvedAxialLoadN) || !Number.isFinite(resolvedTransverseLoadN) || bothNonPositive) {
      return { ok: false, reason: "bad_load" };
    }
    model = buildFullChainFrameModel(beam.stations, {
      totalLength, material: mat, safetyFactor,
      axialLoadN: resolvedAxialLoadN, transverseLoadN: resolvedTransverseLoadN,
    });
    idPrefix = "member";
  }

  if (model.error) {
    return { ok: false, reason: model.error };
  }

  const res = runFEA({ nodes: model.nodes, members: model.members, loads: model.loads, supports: model.supports });
  if (!res.ok) {
    return { ok: false, reason: "fea_solve_failed", error: res.error };
  }

  const stationsArr = caseDef.kind === "blade" ? model.bladeStations : model.chain;
  const failingStations = res.utilization
    .filter((u) => !u.pass)
    .map((u) => {
      const idx = Number(String(u.id).replace(`${idPrefix}-`, ""));
      const a = stationsArr[idx];
      const b = stationsArr[idx + 1];
      return {
        memberId: u.id,
        sRange: [a.s, b.s],
        utilization: u.utilization,
        combinedStress: u.combinedStress,
      };
    });

  const out = {
    ok: res.summary.allPass,
    maxUtilization: res.summary.maxUtilization,
    failingStations,
    worstStress: Math.max(...res.stresses.map((s) => s.combinedStress)),
    allowable: model.allowable_Pa,
    material,
    useCase,
    safetyFactor,
  };
  if (caseDef.kind === "blade") {
    out.tipLoadN = tipLoadN;
  } else {
    out.axialLoadN = resolvedAxialLoadN;
    out.transverseLoadN = resolvedTransverseLoadN;
  }
  return out;
}

/**
 * Bounded adjust-and-rerun loop: if `structuralCheck` fails, thicken the
 * blade (bump `bladeBaseThickness`, the failing dimension for a transverse
 * bending load) by `thickenFactor`, regenerate the mesh via
 * `generateSwordMesh`, and re-check — up to `maxIters` times. Mirrors
 * build-loop.js's honest-exhaustion shape: on exhaustion this returns
 * `{ ok:false, reason:'did_not_converge', history }` rather than silently
 * reporting the last (still-failing) attempt as a pass.
 *
 * @param {object} genParams params forwarded to the mesh generator
 * @param {object} [opts] forwarded to structuralCheck, plus:
 * @param {number} [opts.maxIters=MAX_OPTIMIZE_ITERS]
 * @param {number} [opts.thickenFactor=DEFAULT_THICKEN_FACTOR]
 * @param {string} [opts.thickenParam="bladeBaseThickness"] which generator
 *   param is the failing dimension to bump on each non-passing iteration —
 *   e.g. "headBaseThickness" (spear), "gripRadius" (staff), "handleRadius"
 *   (mace), "plateThickness" (shield). generate-asset.js's ARCHETYPES
 *   registry supplies the right value per archetype; direct callers of
 *   this function (e.g. fea-gate.test.js) default to the sword's own
 *   dimension for back-compat.
 * @param {number} [opts.thickenParamDefault=0.006] fallback seed value for
 *   `thickenParam` when `genParams` doesn't set it (so iteration 1 has
 *   something concrete to multiply — mirrors the mesh generator's own
 *   internal default for that param).
 * @param {function} [opts.generate] mesh generator override (tests inject
 *   generateSwordMesh directly to avoid an import cycle with
 *   parametric-mesh.js; production callers going through
 *   generate-asset.js always pass their archetype's own generator
 *   explicitly — the lazy dynamic import below is a sword-only fallback
 *   for direct, archetype-unaware callers of this function)
 */
export async function optimizeToPass(genParams, opts = {}) {
  const {
    maxIters = MAX_OPTIMIZE_ITERS,
    thickenFactor = DEFAULT_THICKEN_FACTOR,
    thickenParam = "bladeBaseThickness",
    thickenParamDefault = 0.006,
    generate,
    ...checkOpts
  } = opts;

  const generateMesh = generate || (await import("./parametric-mesh.js")).generateSwordMesh;

  let params = { ...genParams };
  const history = [];

  for (let iter = 0; iter < maxIters; iter++) {
    const mesh = generateMesh(params);
    const check = structuralCheck(mesh.beam, { ...checkOpts, totalLength: mesh.meta.totalLength });
    history.push({ iter, [thickenParam]: params[thickenParam], maxUtilization: check.maxUtilization, ok: check.ok, reason: check.reason });
    if (check.ok) {
      return { ok: true, params, check, history };
    }
    if (typeof check.maxUtilization !== "number") {
      // A hard structural precondition failure (bad material, bad beam
      // input, solver error) — thickening the failing dimension cannot fix
      // this, so stop honestly instead of spinning through dead iterations.
      return { ok: false, reason: "cannot_converge", check, history };
    }
    params = {
      ...params,
      [thickenParam]: (params[thickenParam] ?? thickenParamDefault) * thickenFactor,
    };
  }

  return { ok: false, reason: "did_not_converge", params, history };
}
