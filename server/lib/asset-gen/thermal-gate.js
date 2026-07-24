// server/lib/asset-gen/thermal-gate.js
//
// Additive thermal-stress cross-check, mirroring server/lib/asset-gen/
// fea-gate.js's adapter pattern: this module builds/consumes a beam-frame
// FE model (the same nodes/members/loads/supports shape fea-gate.js's
// buildBladeFrameModel already constructs, and the same shape
// server/domains/engineering.js's `runFEA`/`meshGenerate` lens actions
// accept from a caller-supplied model) and hands the loads through to the
// UNCHANGED direct-stiffness solver (server/lib/simulation/fea-solver.js#
// runFEA). Per CLAUDE.md's "compute-don't-guess" doctrine, THIS module does
// not reimplement or modify the solver — it only computes the thermal load
// term and lets the real solver produce the real combined-stress answer.
//
// This file does NOT modify fea-gate.js or fea-solver.js. It is a new,
// standalone adapter that composes with either of them.
//
// ── The physics (textbook, not invented) ─────────────────────────────────
// A bar of length L, elastic modulus E and coefficient of thermal
// expansion (CTE) α, subjected to a uniform temperature change ΔT, wants
// to freely change length by ΔL = α·ΔT·L. If the bar is instead FULLY
// RESTRAINED (both ends rigidly held so it cannot change length at all),
// the restraint reaction develops a uniform normal stress given by the
// standard mechanics-of-materials result for a fully-restrained thermal
// member (Boresi & Schmidt, "Advanced Mechanics of Materials"; Shigley,
// "Mechanical Engineering Design" — restrained thermal expansion is a
// standard undergraduate strength-of-materials result, not derived here):
//
//     σ_thermal = E · α · ΔT                              (Pa)
//
// and the equivalent axial FORCE the restraint must supply is that
// uniform stress times the member's own cross-sectional area:
//
//     F_thermal = σ_thermal · A = E · A · α · ΔT           (N)
//
// Notice σ_thermal does NOT depend on member area — a uniformly heated,
// fully-restrained assembly of the SAME material develops the SAME stress
// in every member regardless of cross-section (this module's own tests
// pin this as a real physical property, not an implementation quirk).
// F_thermal DOES depend on area, because it is the force that particular
// member's restraint must carry to hold that stress.
//
// ── Honest scope note — read before trusting "combined" ─────────────────
// fea-gate.js's cantilever model (root fixed, everything else free) is
// STATICALLY DETERMINATE for axial loading: a free-ended cantilever CAN
// change length under a uniform ΔT with genuinely zero induced stress,
// because nothing stops the free end from moving. σ_thermal above is the
// FULLY-RESTRAINED closed-form bound — a real, textbook number — but it is
// not automatically "what a free-ended cantilever would show" under a
// rigorous thermal-FE solve (which requires subtracting the thermal
// pre-strain from the post-solve elastic force recovery, a correction
// fea-solver.js's computeMemberForces/computeStresses does not perform,
// and this module must not add, since it may not modify fea-solver.js).
//
// This module therefore reports TWO honestly-labeled, never-blended
// numbers:
//   - `thermalStressByMember` — the closed-form fully-restrained bound,
//     computed directly from the formula above (no solver call; hand
//     verifiable).
//   - `combinedUtilization` (and the full `combined` result) — the REAL
//     output of the UNCHANGED solver when the fully-restrained-equivalent
//     axial force (F_thermal, per member) is superposed as a genuine
//     applied load alongside whatever mechanical load already exists.
//     Superposing two real forces on a real linear-elastic model is
//     ordinary, valid linear superposition — nothing is fabricated — but
//     because the underlying beam-frame model may itself be statically
//     determinate for axial loading, treat `combinedUtilization` as a
//     CONSERVATIVE WORST-CASE SCREENING CHECK (as if the member could not
//     freely expand), not a certified indeterminate thermal-FE answer.
//   - `mechanicalOnlyUtilization` — the same real solver, same model, with
//     ZERO thermal contribution — the untouched baseline for comparison.
//
// A `deltaT: 0` call collapses the thermal load to exactly zero for every
// member, so `combinedUtilization` degrades to being numerically identical
// to `mechanicalOnlyUtilization` — a genuine self-consistency property,
// not a special-cased branch (see server/tests/thermal-gate.test.js).

import { runFEA } from "../simulation/fea-solver.js";
import { getMaterial } from "./mass-properties.js";

const MPA_TO_PA = 1e6;
// MATERIAL_LIBRARY's `cte` field (server/domains/engineering.js /
// server/lib/asset-gen/mass-properties.js) is documented in units of
// 1e-6/K (microstrain per kelvin) — the standard CTE convention for
// engineering materials tables. Converting to a plain per-kelvin strain
// coefficient is just this scale factor.
export const CTE_UNIT_SCALE = 1e-6;

// A "moderate operating temperature swing" default, in the same spirit as
// fea-gate.js's DEFAULT_TIP_LOAD_N: an engineering ASSUMPTION, not a
// measured value for any specific part or environment. 50°C spans, e.g., a
// part assembled near room temperature (~20°C) later operating anywhere
// from a cold morning (~-10°C) to a sun-warmed exterior (~40°C) — a
// commonly-cited outdoor/mechanical-part design-swing order of magnitude,
// not a precise figure. Override via opts.deltaT.
export const DEFAULT_DELTA_T_C = 50;

/**
 * Coefficient of thermal expansion in real per-kelvin strain units.
 * @param {{cte:number}} material a MATERIAL_LIBRARY entry (or getMaterial() result)
 * @returns {number} α, dimensionless strain per kelvin
 */
export function alphaPerKelvin(material) {
  return material.cte * CTE_UNIT_SCALE;
}

/**
 * σ_thermal = E · α · ΔT — the closed-form fully-restrained thermal
 * stress for a member of the given material under a uniform temperature
 * change ΔT (°C or K — a temperature DIFFERENCE, so the two scales are
 * identical here). Independent of member area/geometry by design (see
 * this file's header comment).
 * @param {{E:number, cte:number}} material E in MPa (MATERIAL_LIBRARY convention)
 * @param {number} deltaT temperature change, °C
 * @returns {number} Pa
 */
export function thermalStressPa(material, deltaT) {
  const E_Pa = material.E * MPA_TO_PA;
  return E_Pa * alphaPerKelvin(material) * deltaT;
}

/**
 * F_thermal = σ_thermal · A — the equivalent axial force a fully-restrained
 * member of the given cross-sectional area would need reacted against it
 * to hold that member at its original length under ΔT.
 * @param {{E:number, cte:number}} material
 * @param {number} deltaT °C
 * @param {number} area m²
 * @returns {number} N
 */
export function thermalAxialForceN(material, deltaT, area) {
  return thermalStressPa(material, deltaT) * (area || 0);
}

/**
 * Direction cosines + length of a member, computed the same way
 * fea-solver.js's (module-private) memberCosines does — duplicated here in
 * miniature because fea-solver.js does not export it and this module must
 * not modify fea-solver.js. Returns null (never throws) for a
 * degenerate/zero-length member or a dangling node reference — an honest
 * "can't place this member's thermal load" signal to the caller.
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
 * Build the assembled equivalent-thermal-load nodal-force vector for an
 * entire beam-frame model: for each member, the fully-restrained axial
 * force F_thermal = σ_thermal · area is applied as a real force pair along
 * the member's own axis (pushing nodeJ away from nodeI when ΔT>0, i.e. the
 * member "wants" to elongate); forces from members sharing a node are
 * summed, exactly like ordinary FE load assembly.
 *
 * @param {Array} nodes [{id,x,y,z}]
 * @param {Array} members [{id,nodeI,nodeJ,area}]
 * @param {{E:number, cte:number}} material
 * @param {number} deltaT °C
 * @returns {{
 *   nodalLoads: Array<{nodeId, Fx:number, Fy:number, Fz:number}>,
 *   thermalStressByMember: Record<string, number>,
 *   thermalForceByMember: Record<string, number|null>,
 * }}
 */
export function buildThermalLoads(nodes, members, material, deltaT) {
  const sigma = thermalStressPa(material, deltaT);
  const byNode = new Map();
  const add = (nodeId, fx, fy, fz) => {
    const key = String(nodeId);
    const cur = byNode.get(key) || { nodeId, Fx: 0, Fy: 0, Fz: 0 };
    cur.Fx += fx;
    cur.Fy += fy;
    cur.Fz += fz;
    byNode.set(key, cur);
  };

  const thermalStressByMember = {};
  const thermalForceByMember = {};

  for (const m of members) {
    thermalStressByMember[m.id] = sigma;
    const dc = directionCosines(nodes, m);
    if (!dc) {
      thermalForceByMember[m.id] = null;
      continue;
    }
    const F = sigma * (m.area || 0);
    thermalForceByMember[m.id] = F;
    if (F === 0) continue; // ΔT=0 (or zero-area member): no load to add — the honest degrade case
    add(m.nodeI, -F * dc.lx, -F * dc.ly, -F * dc.lz);
    add(m.nodeJ, F * dc.lx, F * dc.ly, F * dc.lz);
  }

  return { nodalLoads: [...byNode.values()], thermalStressByMember, thermalForceByMember };
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

/**
 * Run the real solver twice against the SAME beam-frame model — once with
 * only the caller's mechanical loads, once with the mechanical loads plus
 * the equivalent fully-restrained thermal loads superposed — and report
 * both, clearly labeled, alongside the closed-form per-member thermal
 * stress. NEVER fabricates a pass: any bad input or solver failure is
 * reported as an honest `ok:false, reason`.
 *
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} model
 *   the same nodes/members/loads/supports shape fea-gate.js builds and
 *   fea-solver.js#runFEA consumes.
 * @param {object} opts
 * @param {number} [opts.deltaT=DEFAULT_DELTA_T_C] temperature change, °C
 * @param {string|{E:number,cte:number}} opts.material a MATERIAL_LIBRARY
 *   key (resolved via mass-properties.js#getMaterial) or an
 *   already-resolved material object exposing real `E`/`cte` fields.
 * @returns {{
 *   ok:boolean, reason?:string,
 *   deltaT?:number, material?:string,
 *   mechanicalOnlyUtilization?:number, combinedUtilization?:number,
 *   maxUtilizationCombined?:number,
 *   thermalStressByMember?:Record<string,number>,
 *   thermalForceByMember?:Record<string,number|null>,
 *   mechanical?:object, combined?:object,
 * }}
 */
export function checkThermalGate(model, opts = {}) {
  const { deltaT = DEFAULT_DELTA_T_C, material } = opts;

  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.members)) {
    return { ok: false, reason: "bad_model_input" };
  }
  if (model.nodes.length === 0 || model.members.length === 0) {
    return { ok: false, reason: "bad_model_input" };
  }
  if (!Number.isFinite(deltaT)) {
    return { ok: false, reason: "bad_delta_t" };
  }
  const mat = typeof material === "string" ? getMaterial(material) : material;
  if (!mat || !Number.isFinite(mat.E) || !Number.isFinite(mat.cte)) {
    return { ok: false, reason: "unknown_material", material };
  }

  const supports = Array.isArray(model.supports) ? model.supports : [];
  if (supports.length === 0) {
    return { ok: false, reason: "missing_supports" };
  }
  const mechanicalLoads = Array.isArray(model.loads) ? model.loads : [];

  // Mechanical-only baseline — the real solver, zero thermal contribution.
  const mechRes = runFEA({ nodes: model.nodes, members: model.members, loads: mechanicalLoads, supports });
  if (!mechRes.ok) {
    return { ok: false, reason: "fea_solve_failed", error: mechRes.error };
  }

  const { nodalLoads: thermalLoads, thermalStressByMember, thermalForceByMember } =
    buildThermalLoads(model.nodes, model.members, mat, deltaT);

  // Combined pass — real superposition of mechanical + thermal-equivalent
  // loads, through the SAME unchanged solver, in one solve.
  const combinedLoads = sumLoadsByNode([mechanicalLoads, thermalLoads]);
  const combinedRes = runFEA({ nodes: model.nodes, members: model.members, loads: combinedLoads, supports });
  if (!combinedRes.ok) {
    return { ok: false, reason: "fea_solve_failed", error: combinedRes.error };
  }

  return {
    ok: combinedRes.summary.allPass,
    deltaT,
    material: mat.key || (typeof material === "string" ? material : mat.label),
    mechanicalOnlyUtilization: mechRes.summary.maxUtilization,
    combinedUtilization: combinedRes.summary.maxUtilization,
    maxUtilizationCombined: combinedRes.summary.maxUtilization, // alias, matches the task's suggested field name
    thermalStressByMember,
    thermalForceByMember,
    mechanical: { utilization: mechRes.utilization, stresses: mechRes.stresses, summary: mechRes.summary },
    combined: { utilization: combinedRes.utilization, stresses: combinedRes.stresses, summary: combinedRes.summary },
  };
}
