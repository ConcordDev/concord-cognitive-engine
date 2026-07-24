// server/lib/asset-gen/multi-physics-bundle.js
//
// Cross-System Multi-Physics CAD — unified bundle entry point.
//
// This is a COMPOSITION layer, not a fourth physics engine. It lets a
// caller request multiple physics checks against ONE beam-frame model in
// a single call, by delegating to the three existing, UNMODIFIED legs:
//   - thermal-gate.js#checkThermalGate  (thermal-stress leg)
//   - aero-gate.js#checkAeroGate         (aero-on-structure leg)
//   - circuit-solver.js#solveCircuit     (electrical leg)
//
// Per CLAUDE.md's "honest by construction" invariant, this module never
// collapses different physical domains into one fabricated "combined"
// number. Read the two design decisions below before changing anything.
//
// ── Design decision 1 — electrical is EXCLUDED from the structural bundle ──
// `solveCircuit` operates on a genuinely different model shape
// (`{nodes:[{id}], elements:[...], groundNodeId}` — a resistor/source
// network) than the mechanical/thermal/aero legs
// (`{nodes:[{id,x,y,z}], members:[...], loads, supports}` — a beam-frame
// structure). There is no physically meaningful operation that turns a
// node voltage or a branch current into a structural stress/utilization
// ratio, or vice versa — they are not even the same UNITS (volts/amps vs.
// a dimensionless stress/allowable ratio). Inventing a "structural +
// electrical combined score" would be exactly the false-precision
// fabrication CLAUDE.md's honesty invariant forbids.
//
// The honest design taken here: `runMultiPhysicsBundle`'s `legs` option
// (thermal/aero) drives the STRUCTURAL bundle and its `allPass` /
// `simultaneous` fields; an entirely separate, OPTIONAL `electrical`
// option runs `solveCircuit` against its own circuit model and reports
// the result under its own top-level `electrical` key, clearly labeled
// as an independent parallel result. It is NEVER folded into `allPass`,
// never contributes to `simultaneousUtilization`, and the returned
// `electricalNote` field says so explicitly so a caller can't misread the
// bundle shape as implying a combination that was never computed.
//
// ── Design decision 2 — a genuine SIMULTANEOUS thermal+aero solve ─────────
// `checkThermalGate` and `checkAeroGate` each independently superpose
// their own equivalent load onto the caller's mechanical loads (thermal
// OR aero + mechanical, never both at once) — that is why neither leg's
// `combinedUtilization` says anything about concurrent thermal+aero
// loading. This module goes one step further than "keep the legs
// independent" and additionally supports (opt-in via `opts.simultaneous:
// true`, and only when BOTH `legs.thermal` and `legs.aero` are
// requested) a TRUE combined-loads solve: the real mechanical loads, the
// real thermal-equivalent loads (thermal-gate.js#buildThermalLoads — the
// same closed-form fully-restrained axial force this module does not
// reimplement), and the real aero-equivalent drag loads
// (aero-gate.js#buildAeroLoads) are all superposed onto the SAME model
// and solved in ONE real fea-solver.js#runFEA call. That result is
// reported as `simultaneous.simultaneousUtilization` — a name deliberately
// distinct from the per-leg `ok`s, because it means something the two
// independent per-leg checks cannot: a genuine concurrent-loading answer,
// not a "worst of two screening checks" convention. It is still subject
// to every honest scope caveat the two source modules already document
// (statically-determinate thermal caveat, uniform-free-stream aero
// caveat) — this module does not remove or paper over those; it just
// composes the two real load vectors instead of computing a max().
//
// This module does NOT implement a fallback "max(thermalUtilization,
// aeroUtilization)" blended number anywhere. If a future caller wants a
// cheap worst-case-governing-check convention instead of the real
// simultaneous solve, that would need its own explicitly-named field
// (e.g. `worstCaseGoverningUtilization`) with its own caveat that it says
// nothing about concurrent loading — deliberately NOT built here because
// the real simultaneous solve above is a strictly better and still-honest
// alternative, and shipping both would invite confusing the two.

import { runFEA } from "../simulation/fea-solver.js";
import { getMaterial } from "./mass-properties.js";
import { checkThermalGate, buildThermalLoads, DEFAULT_DELTA_T_C } from "./thermal-gate.js";
import {
  checkAeroGate,
  buildAeroLoads,
  dynamicPressurePa,
  resolveFlowDirection,
  DEFAULT_AIR_DENSITY_KG_M3,
} from "./aero-gate.js";
import { solveCircuit } from "../simulation/circuit-solver.js";

const SIMULTANEOUS_CAVEAT =
  "genuine simultaneous solve: mechanical + thermal-equivalent + aero-equivalent " +
  "loads superposed in ONE real runFEA call. Still subject to each leg's own honest " +
  "scope caveat (thermal: closed-form fully-restrained bound, may overstate a " +
  "statically-determinate free end; aero: uniform free-stream approximation, no " +
  "wake/turbulence/member-interference modeled) — this is a real concurrent-loading " +
  "answer, not a certified multi-physics-coupled (e.g. thermally-varying material " +
  "properties, aero-thermal heating) analysis.";

const ELECTRICAL_NOTE =
  "independent electrical-network solve (solveCircuit over its own circuit model) — " +
  "a genuinely separate physical domain from the beam-frame structural checks above " +
  "(different model shape, different units: volts/amps vs. a stress/allowable ratio). " +
  "Never combined into allPass or any structural utilization number.";

/**
 * Local helper mirroring thermal-gate.js's and aero-gate.js's own
 * (module-private, unexported) `sumLoadsByNode` — duplicated in miniature
 * here for the same reason thermal-gate.js duplicates fea-solver.js's
 * direction-cosine logic: the source modules do not export it, and this
 * file must not modify them.
 */
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
 * Validate + resolve the inputs a genuine simultaneous thermal+aero solve
 * needs, mirroring checkThermalGate's / checkAeroGate's own precondition
 * checks (this module calls runFEA directly for the simultaneous solve,
 * so it must perform the same honest validation those two gates already
 * do for their own single-leg solves — never fabricate a pass on bad
 * input).
 */
function validateSimultaneousInputs(model, thermalOpts, aeroOpts) {
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.members)) {
    return { ok: false, reason: "bad_model_input" };
  }
  if (model.nodes.length === 0 || model.members.length === 0) {
    return { ok: false, reason: "bad_model_input" };
  }
  const supports = Array.isArray(model.supports) ? model.supports : [];
  if (supports.length === 0) {
    return { ok: false, reason: "missing_supports" };
  }

  const deltaT = thermalOpts.deltaT === undefined || thermalOpts.deltaT === null || thermalOpts.deltaT === ""
    ? DEFAULT_DELTA_T_C
    : Number(thermalOpts.deltaT);
  if (!Number.isFinite(deltaT)) {
    return { ok: false, reason: "bad_delta_t" };
  }
  const materialRaw = thermalOpts.material ?? "steel-a36";
  const mat = typeof materialRaw === "string" ? getMaterial(materialRaw) : materialRaw;
  if (!mat || !Number.isFinite(mat.E) || !Number.isFinite(mat.cte)) {
    return { ok: false, reason: "unknown_material", material: materialRaw };
  }

  const velocity = aeroOpts.velocity;
  if (typeof velocity !== "number" || !Number.isFinite(velocity) || velocity < 0) {
    return { ok: false, reason: "invalid_velocity" };
  }
  const airDensity = aeroOpts.airDensity === undefined || aeroOpts.airDensity === null || aeroOpts.airDensity === ""
    ? DEFAULT_AIR_DENSITY_KG_M3
    : Number(aeroOpts.airDensity);
  if (!Number.isFinite(airDensity) || airDensity <= 0) {
    return { ok: false, reason: "invalid_air_density" };
  }
  const flowDir = resolveFlowDirection(aeroOpts.direction ?? { x: 1, y: 0, z: 0 });
  if (!flowDir) {
    return { ok: false, reason: "invalid_flow_direction" };
  }

  return { ok: true, mat, materialRaw, deltaT, velocity, airDensity, flowDir };
}

/**
 * Run the genuine simultaneous thermal+aero combined-loads solve
 * described in this file's header (design decision 2). Never fabricates
 * a pass — any bad input, unresolvable material/flow-direction, missing
 * per-member aero geometry, or solver failure is reported as an honest
 * `ok:false, reason`.
 *
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} model
 * @param {{deltaT?:number, material?:string|object}} thermalOpts
 * @param {{velocity:number, direction?:number|object, airDensity?:number, defaultCd?:number, defaultArea?:number}} aeroOpts
 */
export function runSimultaneousMultiPhysics(model, thermalOpts = {}, aeroOpts = {}) {
  const v = validateSimultaneousInputs(model, thermalOpts, aeroOpts);
  if (!v.ok) return v;
  const { mat, materialRaw, deltaT, velocity, airDensity, flowDir } = v;

  const supports = model.supports;
  const mechanicalLoads = Array.isArray(model.loads) ? model.loads : [];

  // Mechanical-only baseline — the real solver, zero thermal/aero contribution.
  const mechRes = runFEA({ nodes: model.nodes, members: model.members, loads: mechanicalLoads, supports });
  if (!mechRes.ok) {
    return { ok: false, reason: "fea_solve_failed", error: mechRes.error };
  }

  const { nodalLoads: thermalLoads, thermalStressByMember, thermalForceByMember } =
    buildThermalLoads(model.nodes, model.members, mat, deltaT);

  const q = dynamicPressurePa(velocity, airDensity);
  const { nodalLoads: aeroLoads, dragForceByMember, missingAreaMembers } =
    buildAeroLoads(model.nodes, model.members, q, flowDir, {
      defaultCd: aeroOpts.defaultCd,
      defaultArea: aeroOpts.defaultArea,
    });
  if (missingAreaMembers.length > 0) {
    return { ok: false, reason: "missing_aero_properties", memberIds: missingAreaMembers };
  }

  // The real simultaneous superposition: mechanical + thermal-equivalent +
  // aero-equivalent, all three real load sets, ONE solver call.
  const simultaneousLoads = sumLoadsByNode([mechanicalLoads, thermalLoads, aeroLoads]);
  const simRes = runFEA({ nodes: model.nodes, members: model.members, loads: simultaneousLoads, supports });
  if (!simRes.ok) {
    return { ok: false, reason: "fea_solve_failed", error: simRes.error };
  }

  return {
    ok: simRes.summary.allPass,
    deltaT,
    material: mat.key || (typeof materialRaw === "string" ? materialRaw : mat.label),
    velocity,
    airDensity,
    dynamicPressurePa: q,
    flowDirection: flowDir,
    mechanicalOnlyUtilization: mechRes.summary.maxUtilization,
    simultaneousUtilization: simRes.summary.maxUtilization,
    thermalStressByMember,
    thermalForceByMember,
    dragForceByMember,
    caveat: SIMULTANEOUS_CAVEAT,
    mechanical: { utilization: mechRes.utilization, stresses: mechRes.stresses, summary: mechRes.summary },
    simultaneousResult: { utilization: simRes.utilization, stresses: simRes.stresses, summary: simRes.summary },
  };
}

/**
 * Unified multi-physics bundle: run any of {thermal, aero} against the
 * SAME beam-frame model in one call, plus (optionally) an independent
 * electrical circuit solve, WITHOUT ever collapsing them into one
 * fabricated "combined" score. See this file's header for the full
 * design-decision writeup.
 *
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} model
 *   the same nodes/members/loads/supports shape checkThermalGate/
 *   checkAeroGate/runFEA already consume. Only required when at least
 *   one of legs.thermal/legs.aero is requested.
 * @param {object} opts
 * @param {{thermal?:true|{deltaT?:number,material?:string}, aero?:true|{velocity:number,direction?:number|object,airDensity?:number,defaultCd?:number,defaultArea?:number}}} [opts.legs]
 *   which structural legs to run, and their own leg-specific params.
 *   `true` runs the leg with its own module defaults.
 * @param {boolean} [opts.simultaneous=false] when true AND both
 *   legs.thermal and legs.aero are requested, additionally runs the real
 *   simultaneous combined-loads solve (see runSimultaneousMultiPhysics).
 *   Requesting it with fewer than both legs is an honest failure, not a
 *   silent skip.
 * @param {{model:{nodes:Array<{id:*}>, elements:Array, groundNodeId:*}}} [opts.electrical]
 *   an entirely independent circuit-network request. See design decision 1.
 * @returns {{
 *   ok:boolean, reason?:string,
 *   requestedLegs?:string[],
 *   legs?: { thermal?:object, aero?:object },
 *   allPass?:boolean,
 *   simultaneous?:object,
 *   electrical?:object, electricalNote?:string,
 * }}
 */
export function runMultiPhysicsBundle(model, opts = {}) {
  const legsInput = opts.legs && typeof opts.legs === "object" ? opts.legs : {};
  const wantThermal = !!legsInput.thermal;
  const wantAero = !!legsInput.aero;
  const wantElectrical = !!opts.electrical;
  const wantSimultaneous = opts.simultaneous === true;

  if (!wantThermal && !wantAero && !wantElectrical) {
    return { ok: false, reason: "no_legs_requested" };
  }

  const requestedLegs = [];
  const legs = {};

  if (wantThermal) {
    requestedLegs.push("thermal");
    const thermalOpts = legsInput.thermal === true ? {} : legsInput.thermal || {};
    legs.thermal = checkThermalGate(model, thermalOpts);
  }
  if (wantAero) {
    requestedLegs.push("aero");
    const aeroOpts = legsInput.aero === true ? {} : legsInput.aero || {};
    legs.aero = checkAeroGate(model, aeroOpts);
  }

  // `allPass` — a legitimate boolean AND over every REQUESTED structural
  // leg's own `ok`. This is NOT a blended severity score: it says nothing
  // about HOW close either leg is to failing, only whether every leg that
  // was actually run reported success. A leg that wasn't requested does
  // not participate (vacuously true if zero structural legs requested,
  // e.g. an electrical-only call).
  const requestedResults = requestedLegs.map((name) => legs[name]);
  const allPass = requestedResults.length === 0 ? true : requestedResults.every((r) => r && r.ok === true);

  const result = { ok: true, requestedLegs, legs, allPass };

  if (wantSimultaneous) {
    if (wantThermal && wantAero) {
      const thermalOpts = legsInput.thermal === true ? {} : legsInput.thermal || {};
      const aeroOpts = legsInput.aero === true ? {} : legsInput.aero || {};
      result.simultaneous = runSimultaneousMultiPhysics(model, thermalOpts, aeroOpts);
    } else {
      // Honest refusal, not a silent skip: the caller asked for a
      // simultaneous solve but didn't request both legs it needs.
      result.simultaneous = { ok: false, reason: "simultaneous_requires_both_thermal_and_aero_legs" };
    }
  }

  // Electrical — see design decision 1. Deliberately independent: its own
  // model, its own result key, never touching allPass/simultaneous.
  if (wantElectrical) {
    const electricalModel = opts.electrical && opts.electrical.model;
    if (!electricalModel) {
      result.electrical = { ok: false, reason: "missing_electrical_model" };
    } else {
      result.electrical = solveCircuit(electricalModel);
    }
    result.electricalNote = ELECTRICAL_NOTE;
  }

  return result;
}
