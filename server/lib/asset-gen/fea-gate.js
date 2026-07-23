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
// can still meaningfully represent for a swept diamond taper.
export const MIN_SECTION_AREA_FRACTION = 0.4;
export const MAX_OPTIMIZE_ITERS = 12;
export const DEFAULT_THICKEN_FACTOR = 1.15; // per-iteration multiplicative bump to the failing dimension

const MPA_TO_PA = 1e6;

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
 * Run the beam-frame FEA solver against a generated part's beam co-product
 * and gate on stress utilization. NEVER fabricates a pass — any solver
 * failure or missing precondition is reported as an honest `ok:false`.
 *
 * @param {{stations:Array, totalLength?:number}} beam the mesh generator's
 *   `mesh.beam` co-product; pass `totalLength` either on this object or in
 *   `opts.totalLength` (mesh.meta.totalLength for generateSwordMesh output)
 * @param {object} [opts]
 * @param {string} [opts.material="steel-a36"] MATERIAL_LIBRARY key
 * @param {string} [opts.useCase="sword-bending"] only "sword-bending" is implemented
 * @param {number} [opts.totalLength] overrides beam.totalLength
 * @param {number} [opts.tipLoadN=DEFAULT_TIP_LOAD_N] transverse tip load (N)
 * @param {number} [opts.safetyFactor=DEFAULT_SAFETY_FACTOR]
 * @returns {{ok:boolean, maxUtilization:number, failingStations:Array, worstStress:number, allowable:number, reason?:string}}
 */
export function structuralCheck(beam, opts = {}) {
  const {
    material = "steel-a36",
    useCase = "sword-bending",
    totalLength = beam?.totalLength,
    tipLoadN = DEFAULT_TIP_LOAD_N,
    safetyFactor = DEFAULT_SAFETY_FACTOR,
  } = opts;

  if (useCase !== "sword-bending") {
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
  if (!Number.isFinite(tipLoadN) || tipLoadN <= 0) {
    return { ok: false, reason: "bad_tip_load" };
  }

  const model = buildBladeFrameModel(beam.stations, { totalLength, tipLoadN, material: mat, safetyFactor });
  if (model.error) {
    return { ok: false, reason: model.error };
  }

  const res = runFEA({ nodes: model.nodes, members: model.members, loads: model.loads, supports: model.supports });
  if (!res.ok) {
    return { ok: false, reason: "fea_solve_failed", error: res.error };
  }

  const failingStations = res.utilization
    .filter((u) => !u.pass)
    .map((u) => {
      const idx = Number(String(u.id).replace("blade-", ""));
      const a = model.bladeStations[idx];
      const b = model.bladeStations[idx + 1];
      return {
        memberId: u.id,
        sRange: [a.s, b.s],
        utilization: u.utilization,
        combinedStress: u.combinedStress,
      };
    });

  return {
    ok: res.summary.allPass,
    maxUtilization: res.summary.maxUtilization,
    failingStations,
    worstStress: Math.max(...res.stresses.map((s) => s.combinedStress)),
    allowable: model.allowable_Pa,
    material,
    tipLoadN,
    safetyFactor,
  };
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
 * @param {object} genParams params forwarded to generateSwordMesh
 * @param {object} [opts] forwarded to structuralCheck, plus:
 * @param {number} [opts.maxIters=MAX_OPTIMIZE_ITERS]
 * @param {number} [opts.thickenFactor=DEFAULT_THICKEN_FACTOR]
 * @param {function} [opts.generate] mesh generator override (tests inject
 *   generateSwordMesh directly to avoid an import cycle with
 *   parametric-mesh.js; production callers may omit — a lazy dynamic
 *   import of generateSwordMesh is used when absent)
 */
export async function optimizeToPass(genParams, opts = {}) {
  const {
    maxIters = MAX_OPTIMIZE_ITERS,
    thickenFactor = DEFAULT_THICKEN_FACTOR,
    generate,
    ...checkOpts
  } = opts;

  const generateSwordMesh = generate || (await import("./parametric-mesh.js")).generateSwordMesh;

  let params = { ...genParams };
  const history = [];

  for (let iter = 0; iter < maxIters; iter++) {
    const mesh = generateSwordMesh(params);
    const check = structuralCheck(mesh.beam, { ...checkOpts, totalLength: mesh.meta.totalLength });
    history.push({ iter, bladeBaseThickness: params.bladeBaseThickness, maxUtilization: check.maxUtilization, ok: check.ok, reason: check.reason });
    if (check.ok) {
      return { ok: true, params, check, history };
    }
    if (typeof check.maxUtilization !== "number") {
      // A hard structural precondition failure (bad material, bad beam
      // input, solver error) — thickening the blade cannot fix this, so
      // stop honestly instead of spinning through dead iterations.
      return { ok: false, reason: "cannot_converge", check, history };
    }
    params = {
      ...params,
      bladeBaseThickness: (params.bladeBaseThickness ?? 0.006) * thickenFactor,
    };
  }

  return { ok: false, reason: "did_not_converge", params, history };
}
