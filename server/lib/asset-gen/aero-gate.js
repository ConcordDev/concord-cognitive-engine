// server/lib/asset-gen/aero-gate.js
//
// Aero-on-structure cross-check, third leg of Cross-System Multi-Physics
// CAD. Sibling to server/lib/asset-gen/thermal-gate.js (thermal leg) and
// server/lib/simulation/circuit-solver.js (electrical leg): this module
// computes a real aerodynamic drag load co-product and hands it through
// to the SAME UNCHANGED direct-stiffness solver (server/lib/simulation/
// fea-solver.js#runFEA) that the other two legs use. Per CLAUDE.md's
// "compute-don't-guess" doctrine, this module does not reimplement or
// modify the solver — it only builds a real distributed drag load and
// lets the real solver produce the real combined-stress answer.
//
// This file does NOT modify thermal-gate.js, circuit-solver.js, or
// fea-solver.js. It is a new, standalone adapter that composes with them.
//
// ── The physics (textbook, not invented) ─────────────────────────────────
// Quadratic aerodynamic drag on a bluff body in a free stream:
//
//     q = 0.5 · ρ · v²                                       (Pa, dynamic pressure)
//     F_drag = q · Cd · A                                     (N, drag force)
//
// This is the SAME formula already used elsewhere in this codebase —
// confirmed, not invented, at:
//   - server/lib/compute/physics-compute.js:354-358 `dragForce({velocity,
//     area, dragCoeff, density})` → `0.5 * density * velocity * velocity *
//     dragCoeff * area`, formula string "F = ½ρv²CdA" (SI units: v in m/s,
//     A in m², ρ in kg/m³).
//   - server/domains/physics.js:30 `params.airDensity ?? 1.225` (kg/m³,
//     the standard sea-level air density default) and the multi-body
//     projectile engine's own quadratic-drag term at physics.js:63
//     (`0.5 * s.cd * s.area * rho * speed * speed`).
//   - server/lib/compute/physics-compute.js:43 `windLoad(...)`'s imperial
//     variant uses the identical formula with a `dragCoeff = 1.2` default
//     (a generic bluff/flat-plate reference value) — this module reuses
//     that same 1.2 default for consistency with the rest of the codebase.
// This module reuses the formula and the SI-unit convention (m/s, m²,
// kg/m³, N, Pa) rather than inventing a new one.
//
// ── Honest scope note — read before trusting "combined" ─────────────────
// This module deliberately implements a SCREENING-LEVEL approximation,
// NOT computational fluid dynamics. What is and is not modeled:
//   - NO turbulence, wake, vortex shedding, or flow separation modeling.
//   - NO member-to-member interference or shadowing: every member is
//     treated as sitting in an UNDISTURBED, UNIFORM free stream of the
//     same velocity/direction, independent of every other member. A real
//     downwind member in a real structure would see a reduced, turbulent
//     wake velocity from an upwind member blocking it — this module does
//     not model that.
//   - NO member-orientation-dependent projected-area correction: the
//     frontal/projected area used for a member's drag is whatever the
//     caller supplies (per-member `frontalArea`, or the uniform
//     `opts.defaultArea` fallback) — this module does not itself resolve
//     a true wind-facing projected area from member length × diameter ×
//     the angle between the member's axis and the flow direction. If the
//     caller wants an orientation-aware projected area, it must compute it
//     upstream and pass it in as `frontalArea`; treating the same
//     `frontalArea`/`defaultArea` for every member regardless of its own
//     orientation relative to flow is the explicit simplification here.
//   - The resulting drag force is applied in the FLOW direction (not
//     projected onto/against the member's own axis the way thermal-gate.js
//     projects its axial thermal load along each member's own axis) —
//     drag is a free-stream force on the member, not a member-internal
//     axial effect, so it is lumped as a real nodal force at each of the
//     member's two end nodes (F/2 at nodeI, F/2 at nodeJ — the standard
//     FE lumping of a uniformly distributed transverse load onto its two
//     end nodes), in global {Fx,Fy,Fz} = F_drag · flowDirection.
//
// This is an honest, deliberately-scoped APPROXIMATION — a screening
// check for whether a structure's members can plausibly survive a given
// wind/flow loading superposed on their mechanical loads, not a
// certified CFD or wind-tunnel result. See `approximationCaveat` on every
// successful `checkAeroGate` result, and never present this module's
// output with more precision than that.
//
// This module reports the SAME never-blended, two-real-solver-calls
// pattern as thermal-gate.js:
//   - `mechanicalOnlyUtilization` — the real solver, the caller's own
//     mechanical loads only, ZERO aero contribution — the untouched
//     baseline.
//   - `combinedUtilization` (and the full `combined` result) — the real
//     solver, same model, with the real per-member drag load superposed
//     as a genuine applied nodal force alongside the mechanical loads.
//     Superposing two real forces on a real linear-elastic model is
//     ordinary, valid linear superposition — nothing is fabricated.
//
// A `velocity: 0` call collapses every member's drag force to exactly
// zero, so `combinedUtilization` degrades to being numerically identical
// to `mechanicalOnlyUtilization` — a genuine self-consistency property,
// not a special-cased branch (see server/tests/aero-gate.test.js, mirroring
// thermal-gate.js's own `deltaT:0` self-consistency test).

import { runFEA } from "../simulation/fea-solver.js";

// Sea-level standard air density, kg/m³ — the SAME default already used
// at server/domains/physics.js:30 (`params.airDensity ?? 1.225`) and
// server/lib/procedural-creature.js:40 (`const AIR_DENSITY = 1.225`).
// Override via opts.airDensity for altitude/temperature-corrected air, or
// a different fluid entirely (e.g. water) — the formula is fluid-agnostic.
export const DEFAULT_AIR_DENSITY_KG_M3 = 1.225;

// Generic bluff/flat-plate reference drag coefficient — the SAME default
// already used at server/lib/compute/physics-compute.js:43
// (`windLoad({..., dragCoeff = 1.2, ...})`). Used only when neither the
// member itself nor opts.defaultCd supplies one.
export const DEFAULT_CD = 1.2;

/**
 * q = 0.5 · ρ · v² — dynamic pressure of a uniform free stream.
 * @param {number} velocity m/s
 * @param {number} [airDensity=DEFAULT_AIR_DENSITY_KG_M3] kg/m³
 * @returns {number} Pa
 */
export function dynamicPressurePa(velocity, airDensity = DEFAULT_AIR_DENSITY_KG_M3) {
  return 0.5 * airDensity * velocity * velocity;
}

/**
 * Resolve a caller-supplied flow direction into a real unit vector.
 * Accepts either:
 *   - a plain number: an angle in RADIANS in the global XY plane,
 *     measured from +X toward +Y (a horizontal wind heading) —
 *     resolved to {x:cos(angle), y:sin(angle), z:0}.
 *   - an object {x,y,z}: any non-zero 3D vector, normalized to unit
 *     length here (the caller does not need to pre-normalize).
 * Returns null (never throws) for a missing, malformed, zero-magnitude,
 * or non-finite direction — an honest "can't resolve a flow direction"
 * signal to the caller, exactly like thermal-gate.js's directionCosines
 * returning null for a degenerate member.
 * @param {number|{x?:number,y?:number,z?:number}} direction
 * @returns {{x:number,y:number,z:number}|null}
 */
export function resolveFlowDirection(direction) {
  if (typeof direction === "number") {
    if (!Number.isFinite(direction)) return null;
    return { x: Math.cos(direction), y: Math.sin(direction), z: 0 };
  }
  if (!direction || typeof direction !== "object") return null;
  const x = direction.x ?? 0;
  const y = direction.y ?? 0;
  const z = direction.z ?? 0;
  if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (!(mag > 0)) return null;
  return { x: x / mag, y: y / mag, z: z / mag };
}

/**
 * F_drag = q · Cd · A for a single member. Resolves Cd/A with the
 * priority: explicit per-member field > caller-supplied default > (for
 * Cd only) DEFAULT_CD. There is deliberately NO universal default for
 * frontal area — area is geometry, and inventing a number for it would
 * violate the "honest by construction" invariant — so a member with
 * neither its own `frontalArea` nor an `opts.defaultArea` fallback
 * returns `null` (an honest "cannot compute drag for this member"
 * signal), which the caller (`buildAeroLoads`) surfaces as a hard
 * precondition failure rather than silently treating it as zero-drag.
 *
 * @param {number} q dynamic pressure, Pa
 * @param {{dragCoeff?:number, frontalArea?:number}} member
 * @param {{defaultCd?:number, defaultArea?:number}} [opts]
 * @returns {number|null} N, or null if area cannot be resolved
 */
export function memberDragForceN(q, member, opts = {}) {
  const cd = Number.isFinite(member?.dragCoeff)
    ? member.dragCoeff
    : Number.isFinite(opts.defaultCd)
      ? opts.defaultCd
      : DEFAULT_CD;
  const area = Number.isFinite(member?.frontalArea) ? member.frontalArea : opts.defaultArea;
  if (!Number.isFinite(area)) return null;
  return q * cd * area;
}

/**
 * Build the assembled equivalent-drag nodal-force vector for an entire
 * beam-frame model: for each member, F_drag = q·Cd·A is applied in the
 * global flow direction, split evenly between the member's two end nodes
 * (F/2 each — the standard FE lumping of a uniformly distributed
 * transverse load), and forces from members sharing a node are summed,
 * exactly like thermal-gate.js's buildThermalLoads / ordinary FE load
 * assembly. See this file's header for the "uniform free-stream, no
 * interference/shadowing" honest scope note.
 *
 * @param {Array} nodes [{id,x,y,z}]
 * @param {Array} members [{id,nodeI,nodeJ,dragCoeff?,frontalArea?}]
 * @param {number} q dynamic pressure, Pa
 * @param {{x:number,y:number,z:number}} flowDir unit vector
 * @param {{defaultCd?:number, defaultArea?:number}} [opts]
 * @returns {{
 *   nodalLoads: Array<{nodeId, Fx:number, Fy:number, Fz:number}>,
 *   dragForceByMember: Record<string, number>,
 *   missingAreaMembers: Array<string>,
 * }}
 */
export function buildAeroLoads(nodes, members, q, flowDir, opts = {}) {
  const byNode = new Map();
  const add = (nodeId, fx, fy, fz) => {
    const key = String(nodeId);
    const cur = byNode.get(key) || { nodeId, Fx: 0, Fy: 0, Fz: 0 };
    cur.Fx += fx;
    cur.Fy += fy;
    cur.Fz += fz;
    byNode.set(key, cur);
  };

  const dragForceByMember = {};
  const missingAreaMembers = [];

  for (const m of members) {
    const F = memberDragForceN(q, m, opts);
    if (F === null) {
      missingAreaMembers.push(String(m.id));
      continue;
    }
    dragForceByMember[m.id] = F;
    if (F === 0) continue; // v=0 (or zero-area member): no load to add — the honest degrade case
    const half = F / 2;
    add(m.nodeI, half * flowDir.x, half * flowDir.y, half * flowDir.z);
    add(m.nodeJ, half * flowDir.x, half * flowDir.y, half * flowDir.z);
  }

  return { nodalLoads: [...byNode.values()], dragForceByMember, missingAreaMembers };
}

function sumLoadsByNode(loadLists) {
  const byNode = new Map();
  for (const loads of loadLists) {
    for (const l of loads) {
      const key = String(l.nodeId);
      const cur = byNode.get(key) || { nodeId: l.nodeId, Fx: 0, Fy: 0, Fz: 0 };
      cur.Fx += l.Fx || 0;
      cur.Fy += l.Fy || 0;
      cur.Fz += l.Fz || 0;
      byNode.set(key, cur);
    }
  }
  return [...byNode.values()];
}

const APPROXIMATION_CAVEAT =
  "uniform free-stream approximation — no wake, turbulence, or member-to-member " +
  "interference modeled; treat as a screening check, not a certified CFD result.";

/**
 * Run the real solver twice against the SAME beam-frame model — once with
 * only the caller's mechanical loads, once with the mechanical loads plus
 * the equivalent aerodynamic drag loads superposed — and report both,
 * clearly labeled, alongside the dynamic pressure and per-member drag
 * forces. NEVER fabricates a pass: any bad input, unresolvable flow
 * direction, missing per-member aero geometry, or solver failure is
 * reported as an honest `ok:false, reason`.
 *
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} model
 *   the same nodes/members/loads/supports shape thermal-gate.js and
 *   fea-solver.js#runFEA consume.
 * @param {object} opts
 * @param {number} opts.velocity flow velocity, m/s (must be finite, >= 0)
 * @param {number|{x?:number,y?:number,z?:number}} [opts.direction={x:1,y:0,z:0}]
 *   flow direction — a radian angle in the XY plane, or a {x,y,z} vector
 *   (normalized internally; need not be pre-unit).
 * @param {number} [opts.airDensity=DEFAULT_AIR_DENSITY_KG_M3] kg/m³
 * @param {number} [opts.defaultCd] uniform drag-coefficient fallback for
 *   members that don't carry their own `dragCoeff` (else DEFAULT_CD=1.2).
 * @param {number} [opts.defaultArea] uniform frontal-area (m²) fallback
 *   for members that don't carry their own `frontalArea`. There is no
 *   further fallback — a member with neither is an honest failure.
 * @returns {{
 *   ok:boolean, reason?:string,
 *   velocity?:number, airDensity?:number, dynamicPressurePa?:number,
 *   flowDirection?:{x:number,y:number,z:number},
 *   mechanicalOnlyUtilization?:number, combinedUtilization?:number,
 *   maxUtilizationCombined?:number,
 *   dragForceByMember?:Record<string,number>,
 *   approximationCaveat?:string,
 *   mechanical?:object, combined?:object,
 * }}
 */
export function checkAeroGate(model, opts = {}) {
  const {
    velocity,
    direction = { x: 1, y: 0, z: 0 },
    airDensity = DEFAULT_AIR_DENSITY_KG_M3,
    defaultCd,
    defaultArea,
  } = opts;

  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.members)) {
    return { ok: false, reason: "bad_model_input" };
  }
  if (model.nodes.length === 0 || model.members.length === 0) {
    return { ok: false, reason: "bad_model_input" };
  }
  if (typeof velocity !== "number" || !Number.isFinite(velocity) || velocity < 0) {
    return { ok: false, reason: "invalid_velocity" };
  }
  if (!Number.isFinite(airDensity) || airDensity <= 0) {
    return { ok: false, reason: "invalid_air_density" };
  }
  const flowDir = resolveFlowDirection(direction);
  if (!flowDir) {
    return { ok: false, reason: "invalid_flow_direction" };
  }

  const supports = Array.isArray(model.supports) ? model.supports : [];
  if (supports.length === 0) {
    return { ok: false, reason: "missing_supports" };
  }
  const mechanicalLoads = Array.isArray(model.loads) ? model.loads : [];

  // Mechanical-only baseline — the real solver, zero aero contribution.
  const mechRes = runFEA({ nodes: model.nodes, members: model.members, loads: mechanicalLoads, supports });
  if (!mechRes.ok) {
    return { ok: false, reason: "fea_solve_failed", error: mechRes.error };
  }

  const q = dynamicPressurePa(velocity, airDensity);
  const { nodalLoads: aeroLoads, dragForceByMember, missingAreaMembers } =
    buildAeroLoads(model.nodes, model.members, q, flowDir, { defaultCd, defaultArea });

  if (missingAreaMembers.length > 0) {
    return { ok: false, reason: "missing_aero_properties", memberIds: missingAreaMembers };
  }

  // Combined pass — real superposition of mechanical + drag-equivalent
  // loads, through the SAME unchanged solver, in one solve.
  const combinedLoads = sumLoadsByNode([mechanicalLoads, aeroLoads]);
  const combinedRes = runFEA({ nodes: model.nodes, members: model.members, loads: combinedLoads, supports });
  if (!combinedRes.ok) {
    return { ok: false, reason: "fea_solve_failed", error: combinedRes.error };
  }

  return {
    ok: combinedRes.summary.allPass,
    velocity,
    airDensity,
    dynamicPressurePa: q,
    flowDirection: flowDir,
    mechanicalOnlyUtilization: mechRes.summary.maxUtilization,
    combinedUtilization: combinedRes.summary.maxUtilization,
    maxUtilizationCombined: combinedRes.summary.maxUtilization, // alias, matches thermal-gate.js's own naming
    dragForceByMember,
    approximationCaveat: APPROXIMATION_CAVEAT,
    mechanical: { utilization: mechRes.utilization, stresses: mechRes.stresses, summary: mechRes.summary },
    combined: { utilization: combinedRes.utilization, stresses: combinedRes.stresses, summary: combinedRes.summary },
  };
}
