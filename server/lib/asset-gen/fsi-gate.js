// server/lib/asset-gen/fsi-gate.js
//
// Non-Newtonian fluid-structure interaction (Wave W1-B) — a beam wall
// deflects under a real non-Newtonian internal-flow pressure load, and
// that deflection changes the local channel gap the flow sees, solved as
// a Picard fixed-point coupled iteration. Sibling to
// server/lib/asset-gen/aero-gate.js and thermal-gate.js: same
// {nodes, members, loads, supports} beam-frame model shape, same
// UNCHANGED direct-stiffness solver (server/lib/simulation/fea-solver.js#
// runFEA), never a fourth physics engine bolted onto the existing gates.
//
// ── Why this is a SIBLING to aero-gate.js, never an extension ──────────
// (a) aero-gate is strictly one-way external flow with a constant Cd and
//     no viscosity model; this module is two-way and internal (channel
//     flow whose own geometry the structure defines).
// (b) Extending aero-gate would break its explicitly-tested
//     `velocity:0 ⇒ combinedUtilization === mechanicalOnlyUtilization`
//     self-consistency invariant, which an ITERATIVE coupled path cannot
//     preserve non-branchingly (a coupled solve either short-circuits at
//     zero load — as this module does at ΔP=0 — or it doesn't, and
//     bolting the two together would force that branch onto aero-gate's
//     callers too).
// (c) The failure surface is disjoint: aero-gate has no notion of
//     convergence; this module's four honest failure states
//     (did_not_converge / coupling_diverged / gap_collapsed /
//     non_laminar_regime_unsupported) would force every checkAeroGate
//     caller to handle cases that can never occur on that path.
//
// ── The physics (real, not invented) ─────────────────────────────────────
// The "wall" is a beam running along global X (see the orientation guard
// below for why). It bounds one side of a channel/duct whose local
// half-gap (radius, for a circular-pipe idealization) at node i is
// `gap[i]`. A fixed total pressure drop ΔP drives a non-Newtonian fluid
// (power-law or Carreau — see non-newtonian-flow.js) through the channel.
// For ANY candidate flow rate Q, each beam MEMBER m (spanning nodes i,j)
// has its own local characteristic radius R_m = avg(gap_i, gap_j) and
// length Δx_m, and therefore its own local pressure GRADIENT G_m(Q) — the
// pressure drop per unit length a fluid element at that local radius
// would need to carry flow rate Q (the SAME Rabinowitsch-Mooney/Carreau
// relation non-newtonian-flow.js already implements, just solved for the
// gradient instead of for Q). Because Q is the same everywhere along the
// channel (mass conservation, steady incompressible flow), the TOTAL
// pressure drop is the discrete line integral Σ_m G_m(Q)·Δx_m, and Q is
// found by inverting THAT monotonic scalar equation against the fixed ΔP
// via bisection.
//
// The transverse WALL LOAD intensity on member m is then taken
// proportional to that member's own local pressure gradient magnitude,
// w_m = G_m(Q)·channelWidth (units Pa/m · m = N/m, a genuine MESH-
// INDEPENDENT distributed-load intensity — it does not shrink as the
// mesh refines, unlike the local pressure DROP G_m·Δx_m, which would
// wrongly scale the lumped nodal force by Δx_m² if used as a load
// intensity directly). This is a deliberate, honestly-scoped engineering
// APPROXIMATION: "local viscous resistance intensity is a proxy for
// local wall loading intensity" — it does not attempt to reconstruct the
// absolute static pressure level at each node (which would additionally
// require assuming an axial reference/traversal order), only the REAL,
// gap-dependent, mesh-independent local gradient magnitude. It is exactly
// the same kind of screening-level approximation aero-gate.js's uniform
// free-stream and thermal-gate.js's fully-restrained bound already are —
// see APPROXIMATION_CAVEAT below, stamped on every successful result.
//
// This creates a genuine, non-invented TWO-WAY coupling: as a segment of
// wall deflects and its local gap narrows, that SAME segment's local
// pressure gradient G_m(Q) increases (steeply — the Rabinowitsch-Mooney
// relation is highly nonlinear in R_m), increasing the local load AT
// THAT SPOT, which can deflect it further. This is a real, steady,
// purely VISCOUS (not inertial, not dynamic) feedback mechanism — the
// honest boundary text below is explicit that flutter/added-mass/
// transient effects are out of scope; this is not that. It is exactly
// the kind of feedback that makes Picard iteration genuinely fragile
// above a critical wall compliance (see hazard note in the module
// header this file was commissioned against) — `coupling_diverged` and
// `gap_collapsed` are real, reachable outcomes of this model, not
// defensive padding.
//
// ── Force-only lumping (matching aero-gate.js#buildAeroLoads) ───────────
// Each member's distributed load w_m·Δx_m is split F/2 to each of its two
// end nodes — proven (by the design pass that commissioned this module)
// to give the EXACT member moment at every mesh density and a
// conservative, O(1/N²)-converging deflection, unlike "consistent" FE
// lumping, which under-reports member moment at coarse mesh via a
// fixed-end-moment term this codebase's `computeMemberForces` does not
// carry. See MIN_WALL_ELEMENTS below.
//
// ── Silent-zero-stiffness hazard (why the orientation guard exists) ────
// fea-solver.js's `solveSystem` does `if (Math.abs(pivot) < 1e-12) continue`
// and back-substitution writes `u[row] = 0` for an unconstrained/singular
// DOF. Its bending-stiffness assembly assumes a member lying in a plane
// with |lz|<0.001 bends about global Y (using the uy/rz DOFs) REGARDLESS
// of whether the member's own axis is X or Y — so a wall member whose
// axis is actually along global Y gets its axial stiffness and its
// (mis-assumed) bending stiffness both routed onto the SAME uy DOF,
// leaving the true transverse DOF (ux) with no bending stiffness
// contribution at all. That can pivot to (near) zero and silently
// resolve to a **fabricated zero deflection** — read by this module's
// coupling loop as "the wall is infinitely rigid" and reported as
// converged in one iteration. `assertFsiModelSupported` is therefore a
// HARD precondition, checked before any `runFEA` call, refusing any
// member whose direction is not (to tolerance) aligned with global X.
//
// This file does NOT modify fea-solver.js, aero-gate.js, or
// thermal-gate.js.

import { runFEA } from "../simulation/fea-solver.js";
import { bisection } from "../compute/numerical.js";
import {
  carreauPipeFlow,
  generalisedReynolds,
  assertLaminar,
  HONEST_BOUNDARY,
} from "../simulation/non-newtonian-flow.js";

export { HONEST_BOUNDARY };

// ── Tunable constants ────────────────────────────────────────────────────
export const DEFAULT_RELAXATION = 0.5;
export const DEFAULT_MAX_ITERS = 40;
export const DEFAULT_GAP_TOLERANCE = 1e-4;
// A wall discretized below this many elements has real (not fabricated)
// force-only-lumping discretization error per the design pass's measured
// convergence table (33.3%→8.3%→2.1%→0.52%→0.13%→0.033% for N=1→32).
// This is NOT a hard precondition here (a caller doing a deliberate mesh-
// convergence sweep must be free to pass fewer elements) — it is
// documentation of the recommended floor for a result meant to be taken
// as a real engineering answer rather than a convergence-study data
// point.
export const MIN_WALL_ELEMENTS = 16;
// Members must lie along global X to this tolerance (unit direction
// cosines ly, lz) — see the header's silent-zero-stiffness hazard note.
export const ORIENTATION_TOLERANCE = 1e-6;

// ── Configuration limitation (added during conductor verification) ──────
// The gap update is `gap = gap0 - dy` with the fluid load applied in +y:
// the fluid pushes the wall INWARD, so narrowing raises local resistance,
// which raises the inward push. That is a real, well-studied steady
// viscous instability (the collapsible-channel / Starling-resistor family,
// where the flow-induced pressure drop leaves a downstream section below
// ambient and the transmural load closes the gap).
//
// It is NOT the only physical configuration, and the sign matters to the
// ANSWER, not just the internals: an internally-pressurized pipe or duct
// (gauge pressure above ambient pushing the wall OUTWARD) has the
// OPPOSITE sign, and its coupling is stabilizing rather than
// destabilizing. Running such a case through this module would report
// `coupling_diverged` / `gap_collapsed` where the real structure is
// stable — a directionally wrong stability verdict, not merely a
// conservative one. This module models the collapsing configuration
// only; a pressurized-vessel FSI mode would be a separate, sign-flipped
// path with its own validation, and is deliberately not offered here
// rather than silently mis-answered.
export const CONFIGURATION_CAVEAT =
  "Models the COLLAPSING configuration only (fluid load pushes the wall " +
  "inward; narrowing increases resistance — the collapsible-channel / " +
  "Starling-resistor instability family). An internally-pressurized pipe " +
  "or duct has the OPPOSITE load sign and a STABILIZING coupling; this " +
  "module would report divergence/collapse for such a case where the real " +
  "structure is stable. Do not use it for pressurized-vessel FSI.";

const APPROXIMATION_CAVEAT =
  "local viscous pressure-gradient intensity used as a proxy for local " +
  "wall loading intensity — a screening-level approximation, not a " +
  "reconstructed absolute static-pressure field; no wake, turbulence, " +
  "inertia, added-mass, or flutter modeled. " +
  CONFIGURATION_CAVEAT + " " +
  HONEST_BOUNDARY;

// ── Geometry helpers (module-private; duplicated from the same ~12-line
// pattern thermal-gate.js/aero-gate.js/multi-physics-bundle.js already
// use in their own files, per CLAUDE.md's "don't refactor the existing
// gates" instruction) ─────────────────────────────────────────────────
function findNode(nodes, id) {
  return nodes.find((n) => String(n.id) === String(id)) || null;
}

function memberDirection(nodes, member) {
  const ni = findNode(nodes, member.nodeI);
  const nj = findNode(nodes, member.nodeJ);
  if (!ni || !nj) return null;
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const dz = (nj.z || 0) - (ni.z || 0);
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 0)) return null;
  return { lx: dx / L, ly: dy / L, lz: dz / L, L };
}

/**
 * Hard precondition: every member must lie along global X (within
 * ORIENTATION_TOLERANCE), or fea-solver.js's bending-stiffness assembly
 * silently fabricates a zero deflection for it (see this file's header).
 * Checked BEFORE any runFEA call — never a warning.
 * @returns {{ok:boolean, reason?:string, memberIds?:string[]}}
 */
export function assertFsiModelSupported(nodes, members) {
  const bad = [];
  for (const m of members) {
    const dir = memberDirection(nodes, m);
    if (!dir || Math.abs(dir.ly) > ORIENTATION_TOLERANCE || Math.abs(dir.lz) > ORIENTATION_TOLERANCE) {
      bad.push(String(m.id));
    }
  }
  if (bad.length > 0) {
    return { ok: false, reason: "unsupported_member_orientation", memberIds: bad };
  }
  return { ok: true };
}

// ── Per-member local pressure gradient G_m(Q) — the fluid-model dispatch ─

/**
 * Closed-form power-law local pressure gradient: invert
 * Q = (πn/(3n+1))·R³·(G·R/(2K))^(1/n) for G, given Q and the member's own
 * local radius R. Exact algebraic inversion of the SAME Rabinowitsch-
 * Mooney relation non-newtonian-flow.js#powerLawPipeFlow implements — no
 * bisection needed for this fluid model.
 * @returns {number} Pa/m
 */
export function powerLawLocalGradient({ K, n }, R, Q) {
  if (Q === 0) return 0;
  const sign = Math.sign(Q);
  const C = ((Math.PI * n) / (3 * n + 1)) * Math.pow(R, 3);
  const magnitude = ((2 * K) / R) * Math.pow(Math.abs(Q) / C, n);
  return sign * magnitude;
}

/**
 * Carreau local pressure gradient: no closed form, so invert
 * carreauPipeFlow(R, lengthM=1, ΔP) = Q for ΔP via bisection (a UNIT-
 * LENGTH pipe segment's pressure drop numerically equals its own
 * gradient). Reuses carreauPipeFlow (itself bisection+quadrature)
 * unchanged — no new numerical method, just an outer bracket+bisection
 * around it.
 * @returns {number} Pa/m
 */
export function carreauLocalGradient({ mu0, muInf, lambda, n }, R, Q, opts = {}) {
  if (Q === 0) return 0;
  const { tolerance = 1e-9, maxIter = 100, maxDoublings = 100 } = opts;
  const sign = Math.sign(Q);
  const absQ = Math.abs(Q);
  const f = (dp) => carreauPipeFlow({ mu0, muInf, lambda, n, diameter: 2 * R, lengthM: 1, pressureDropPa: dp }) - absQ;
  let hi = 1;
  let doublings = 0;
  while (f(hi) < 0 && doublings < maxDoublings) {
    hi *= 2;
    doublings++;
  }
  const res = bisection(f, 0, hi, { tolerance, maxIter });
  return sign * res.root;
}

function localGradient(fluidModel, params, R, Q) {
  if (fluidModel === "carreau") return carreauLocalGradient(params, R, Q);
  return powerLawLocalGradient(params, R, Q);
}

// ── Total pressure drop for a candidate Q, given the CURRENT gap array ──

function totalPressureDropForQ(members, gapByNodeId, memberSpan, fluidModel, params, Q) {
  let total = 0;
  for (const m of members) {
    const gi = gapByNodeId.get(String(m.nodeI));
    const gj = gapByNodeId.get(String(m.nodeJ));
    const R = (gi + gj) / 2;
    if (!(R > 0)) return null; // gap already collapsed — honest bail, caller handles it
    const dx = memberSpan.get(String(m.id));
    total += localGradient(fluidModel, params, R, Q) * dx;
  }
  return total;
}

/**
 * Solve for the flow rate Q that drives exactly deltaPTarget through the
 * CURRENT gap profile — Σ_m G_m(Q)·Δx_m = ΔP, inverted via bisection
 * (the sum is monotonically increasing in Q for any physically
 * admissible fluid model, since each G_m(Q) term is). deltaPTarget=0
 * short-circuits to Q=0 exactly, matching non-newtonian-flow.js's own
 * ΔP=0 shortcut — no bisection call, no fabricated near-zero residual.
 */
export function solveFlowRateForPressureDrop(members, gapByNodeId, memberSpan, fluidModel, params, deltaPTarget, opts = {}) {
  if (deltaPTarget === 0) return { Q: 0, converged: true };
  const { tolerance = 1e-16, maxIter = 200, maxDoublings = 200 } = opts;
  const sign = Math.sign(deltaPTarget);
  const absDP = Math.abs(deltaPTarget);
  const f = (Q) => {
    const total = totalPressureDropForQ(members, gapByNodeId, memberSpan, fluidModel, params, Q);
    return total === null ? Infinity : total - absDP;
  };
  let hi = 1e-9;
  let doublings = 0;
  while (f(hi) < 0 && doublings < maxDoublings) {
    hi *= 2;
    doublings++;
  }
  const res = bisection(f, 0, hi, { tolerance, maxIter });
  return { Q: sign * res.root, converged: res.converged, iterations: res.iterations };
}

// ── Force-only lumped nodal loads from the per-member gradient field ───

function buildFsiLoads(nodes, members, memberSpan, gapByNodeId, fluidModel, params, Q, channelWidth) {
  const byNode = new Map();
  const add = (nodeId, fy) => {
    const key = String(nodeId);
    const cur = byNode.get(key) || { nodeId, Fx: 0, Fy: 0, Fz: 0 };
    cur.Fy += fy;
    byNode.set(key, cur);
  };
  const forceByMember = {};
  const gradientByMember = {};
  for (const m of members) {
    const gi = gapByNodeId.get(String(m.nodeI));
    const gj = gapByNodeId.get(String(m.nodeJ));
    const R = (gi + gj) / 2;
    const dx = memberSpan.get(String(m.id));
    const G = localGradient(fluidModel, params, R, Q);
    gradientByMember[m.id] = G;
    const w = G * channelWidth; // N/m — mesh-independent distributed load intensity
    const F = w * dx; // N — total member force, scales linearly with dx
    forceByMember[m.id] = F;
    if (F === 0) continue;
    const half = F / 2;
    add(m.nodeI, half);
    add(m.nodeJ, half);
  }
  return { nodalLoads: [...byNode.values()], forceByMember, gradientByMember };
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

// ── Top-level FSI gate ───────────────────────────────────────────────────

/**
 * Picard fixed-point fluid-structure interaction gate: iterates
 * (1) solve flow on the current gap profile → per-member wall load,
 * (2) ONE unchanged runFEA call → wall deflection,
 * (3) under-relaxed gap update,
 * until the gap profile's relative change falls below gapTolerance, or a
 * real honest failure is reached. NEVER fabricates a pass.
 *
 * @param {{nodes:Array, members:Array, loads?:Array, supports:Array}} model
 *   the wall beam-frame model — members MUST lie along global X.
 * @param {object} opts
 * @param {"powerLaw"|"carreau"} [opts.fluidModel="powerLaw"]
 * @param {number} [opts.K] power-law consistency index (powerLaw)
 * @param {number} [opts.n] flow-behavior index (both models)
 * @param {number} [opts.mu0] zero-shear viscosity (carreau)
 * @param {number} [opts.muInf] infinite-shear viscosity (carreau)
 * @param {number} [opts.lambda] relaxation time constant (carreau)
 * @param {number} opts.deltaP total driving pressure drop, Pa (>=0)
 * @param {number} opts.density fluid density, kg/m³ (for the Reynolds check — no default; an invented density would violate honest-by-construction)
 * @param {number|number[]} opts.nominalGap undeformed channel half-gap/radius, m — a single number (uniform) or one value per node
 * @param {number} [opts.channelWidth=1] per-unit-width screening convention (m), matching aero-gate.js's defaultArea fallback pattern
 * @param {number} [opts.relaxation=DEFAULT_RELAXATION]
 * @param {number} [opts.maxIters=DEFAULT_MAX_ITERS]
 * @param {number} [opts.gapTolerance=DEFAULT_GAP_TOLERANCE]
 * @returns {object} see honest-failure reasons in this file's header;
 *   on success: { ok, converged:true, iterations, flowRate, gapProfile,
 *   deflection, reynolds, mechanicalOnlyUtilization, combinedUtilization,
 *   maxUtilizationCombined, approximationCaveat, mechanical, combined,
 *   residualHistory }
 */
export function checkFsiGate(model, opts = {}) {
  const {
    fluidModel = "powerLaw",
    K, n, mu0, muInf, lambda,
    deltaP,
    density,
    nominalGap,
    channelWidth = 1,
    relaxation = DEFAULT_RELAXATION,
    maxIters = DEFAULT_MAX_ITERS,
    gapTolerance = DEFAULT_GAP_TOLERANCE,
  } = opts;

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
  if (!Number.isFinite(deltaP) || deltaP < 0) {
    return { ok: false, reason: "invalid_delta_p" };
  }
  if (!Number.isFinite(density) || density <= 0) {
    return { ok: false, reason: "invalid_density" };
  }
  if (fluidModel === "carreau") {
    if (![mu0, muInf, lambda, n].every((v) => Number.isFinite(v)) || mu0 <= 0 || muInf < 0 || lambda < 0 || n <= 0) {
      return { ok: false, reason: "invalid_fluid_params" };
    }
  } else if (fluidModel === "powerLaw") {
    if (!Number.isFinite(K) || K <= 0 || !Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: "invalid_fluid_params" };
    }
  } else {
    return { ok: false, reason: "unsupported_fluid_model", fluidModel };
  }

  const { nodes, members } = model;

  // Hard precondition — before ANY runFEA call.
  const orientationCheck = assertFsiModelSupported(nodes, members);
  if (!orientationCheck.ok) return orientationCheck;

  // Build the initial gap array (parallel to `nodes`) and per-member span.
  let gapArray;
  if (Array.isArray(nominalGap)) {
    if (nominalGap.length !== nodes.length) return { ok: false, reason: "bad_nominal_gap_length" };
    gapArray = nominalGap.slice();
  } else if (Number.isFinite(nominalGap) && nominalGap > 0) {
    gapArray = nodes.map(() => nominalGap);
  } else {
    return { ok: false, reason: "invalid_nominal_gap" };
  }

  const memberSpan = new Map();
  for (const m of members) {
    const dir = memberDirection(nodes, m);
    if (!dir) return { ok: false, reason: "degenerate_member", memberId: m.id };
    memberSpan.set(String(m.id), dir.L);
  }

  const fluidParams = fluidModel === "carreau" ? { mu0, muInf, lambda, n } : { K, n };
  const mechanicalLoads = Array.isArray(model.loads) ? model.loads : [];

  const residualHistory = [];
  let gapByNodeId = new Map(nodes.map((node, i) => [String(node.id), gapArray[i]]));
  let lastFsiResult = null;
  let lastFlowRate = 0;

  for (let iter = 0; iter < maxIters; iter++) {
    // Gap collapse check on the CURRENT profile before using it.
    for (const v of gapByNodeId.values()) {
      if (!(v > 0)) return { ok: false, reason: "gap_collapsed", iteration: iter, residualHistory };
    }

    const flowSolve = solveFlowRateForPressureDrop(members, gapByNodeId, memberSpan, fluidModel, fluidParams, deltaP);
    if (flowSolve.Q === null || !Number.isFinite(flowSolve.Q)) {
      return { ok: false, reason: "gap_collapsed", iteration: iter, residualHistory };
    }
    lastFlowRate = flowSolve.Q;

    // Laminar precondition — refuse rather than extrapolate.
    if (deltaP > 0) {
      const minGap = Math.min(...gapByNodeId.values());
      const meanVelocity = flowSolve.Q / (Math.PI * minGap * minGap);
      const reArgs = fluidModel === "carreau"
        ? { K: mu0, n, density, velocity: meanVelocity, diameter: 2 * minGap } // mu0 as the zero-shear reference viscosity for the screening Re check
        : { K, n, density, velocity: meanVelocity, diameter: 2 * minGap };
      const re = generalisedReynolds(reArgs);
      const laminarCheck = assertLaminar(re);
      if (!laminarCheck.ok) {
        return { ok: false, reason: laminarCheck.reason, Re: laminarCheck.Re, regime: laminarCheck.regime, iteration: iter, residualHistory };
      }
    }

    const { nodalLoads: fsiLoads, forceByMember, gradientByMember } = buildFsiLoads(
      nodes, members, memberSpan, gapByNodeId, fluidModel, fluidParams, flowSolve.Q, channelWidth
    );

    const combinedLoads = sumLoadsByNode([mechanicalLoads, fsiLoads]);
    const combinedRes = runFEA({ nodes, members, loads: combinedLoads, supports });
    if (!combinedRes.ok) return { ok: false, reason: "fea_solve_failed", error: combinedRes.error, iteration: iter, residualHistory };

    lastFsiResult = { combinedRes, forceByMember, gradientByMember, flowRate: flowSolve.Q };

    // Update the gap from the wall's own transverse (dy) displacement.
    // Sign convention: the fluid-pressure-gradient load is applied in +y
    // (buildFsiLoads), representing the fluid pushing the wall TOWARD the
    // channel centerline (closing the gap) — the physically-motivated
    // choice for a genuine "narrowing increases local resistance,
    // increasing the inward push" feedback loop (a real, steady, purely
    // viscous pinch instability; see this file's header). gap = gap0 - dy
    // encodes that: a positive (inward) deflection shrinks the gap.
    const newGapByNodeId = new Map();
    let maxGap = 0;
    for (const d of combinedRes.displacements) {
      const g0 = gapByNodeId.get(String(d.nodeId));
      const gNew = g0 - d.dy;
      newGapByNodeId.set(String(d.nodeId), gNew);
      if (Math.abs(g0) > maxGap) maxGap = Math.abs(g0);
    }

    let maxChange = 0;
    const relaxedGapByNodeId = new Map();
    for (const [id, gOld] of gapByNodeId) {
      const gNew = newGapByNodeId.get(id);
      const gRelaxed = gOld + relaxation * (gNew - gOld);
      relaxedGapByNodeId.set(id, gRelaxed);
      const change = Math.abs(gRelaxed - gOld);
      if (change > maxChange) maxChange = change;
    }

    const residual = maxGap > 0 ? maxChange / maxGap : maxChange;
    residualHistory.push(residual);

    if (residual < gapTolerance) {
      const mechRes = runFEA({ nodes, members, loads: mechanicalLoads, supports });
      const gapProfile = nodes.map((node) => relaxedGapByNodeId.get(String(node.id)));
      return {
        ok: mechRes.ok && combinedRes.ok ? combinedRes.summary.allPass : false,
        converged: true,
        iterations: iter + 1,
        flowRate: lastFsiResult.flowRate,
        gapProfile,
        deflection: combinedRes.displacements,
        mechanicalOnlyUtilization: mechRes.ok ? mechRes.summary.maxUtilization : null,
        combinedUtilization: combinedRes.summary.maxUtilization,
        maxUtilizationCombined: combinedRes.summary.maxUtilization,
        approximationCaveat: APPROXIMATION_CAVEAT,
        mechanical: mechRes.ok ? { utilization: mechRes.utilization, stresses: mechRes.stresses, summary: mechRes.summary } : null,
        combined: { utilization: combinedRes.utilization, stresses: combinedRes.stresses, summary: combinedRes.summary },
        residualHistory,
      };
    }

    // Divergence check — the residual rising 3 iterations running means
    // burning through the remaining iterations would only produce more
    // garbage; stop honestly now instead.
    // A meaningful relative-growth threshold (not a bare `>`) — floating-
    // point noise in the flow-rate bisection can otherwise nudge a
    // genuinely-converging-but-flat residual sequence up in the last
    // couple of significant digits and trip a false "divergence" on a
    // sequence that was actually settling.
    if (residualHistory.length >= 4) {
      const last4 = residualHistory.slice(-4);
      const grew = (a, b) => b > a * 1.02;
      if (grew(last4[0], last4[1]) && grew(last4[1], last4[2]) && grew(last4[2], last4[3])) {
        return { ok: false, reason: "coupling_diverged", iteration: iter, residualHistory };
      }
    }

    // Detect collapse in the RELAXED profile before the next iteration uses it.
    for (const v of relaxedGapByNodeId.values()) {
      if (!(v > 0)) return { ok: false, reason: "gap_collapsed", iteration: iter, residualHistory };
    }

    gapByNodeId = relaxedGapByNodeId;
  }

  return { ok: false, reason: "did_not_converge", flowRate: lastFlowRate, residualHistory };
}
