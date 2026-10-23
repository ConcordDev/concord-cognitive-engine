// server/lib/conkay/physics/solvers/joint-bolt-screening.js
//
// joint.bolt-screening: an ADAPTER, not a new physics.
//
// The humanoid has bolted brackets and joint mounts, and `dynamics.inverse`
// produces real joint torques. The AISC 360-16 bolt limit states already
// exist in this repository (physics/solvers/bolted-joint.js: shear,
// bearing, tear-out, tension, combined, gross/net section, block shear,
// bolt-group distribution, slip-critical, prying) — but they are written
// against the ConKay design-graph context (ctx.children / ctx.loadsOn /
// ctx.get / ctx.material), so nothing has ever run them against a bare
// list of joint loads. This solver closes that gap.
//
// Pipeline, per joint:
//   1. Pre-flight the spec. Every field the underlying solvers need is
//      named explicitly; a joint that is missing one is NOT_COMPUTED with
//      the missing field names listed. It is never treated as passing and
//      never silently dropped.
//   2. Synthesize the minimal design-graph context those solvers already
//      read (Joint/Bolt/Plate nodes + one load case), and CALL the
//      registered solvers. No AISC equation is reimplemented here.
//   3. If a solver's contract needs something this adapter cannot
//      synthesize, that limit state is reported NOT_COMPUTED with the
//      upstream solver's own reason, prefixed with the solver id. We never
//      substitute a look-alike calculation.
//   4. Reduce the evaluated limit states to one governing utilization per
//      joint, plus the full AISC-scope verdict from
//      joint-governing-check.aggregateJointVerdict.
//
// Honesty conventions (inherited from joint-governing-check):
//   - A blocked limit state never contributes a utilization, and it never
//     lets a joint report "ok". A joint with any intended-but-uncomputed
//     limit state is floored at "warn" and listed in partialJoints.
//   - Missing required inputs are NOT_COMPUTED, never a pass.
//   - All reported numbers are finite; a non-finite demand/capacity ratio
//     from an upstream solver is reported as NOT_COMPUTED with the reason
//     rather than as Infinity.
//
// MOMENT HANDLING — why an adapter convention is needed, stated plainly:
//   The AISC §J3 bolt checks in bolted-joint.js deliberately assume a
//   CONCENTRIC load: they divide the joint shear equally by the bolt count
//   ("Loads are factored (LRFD) and shared equally by the bolts"). A joint
//   torque is therefore invisible to those checks as written. Rather than
//   re-deriving a capacity, the adapter uses the existing Crawford-Kulak
//   solver (joint.bolt-group-distribution), whose own documentation says it
//   exists precisely to "refine that assumption", and then re-runs the
//   connection checks against the equivalent joint-level shear that
//   reproduces the governing per-bolt resultant. Capacities still come from
//   the AISC equations in bolted-joint.js; only the demand is distributed.
//
//   If no props.holePattern is supplied, the moment cannot be distributed
//   and joint.bolt-group-distribution returns its own NOT_COMPUTED. That
//   reason is propagated verbatim (prefixed with the solver id) and the
//   joint is reported as partial — an unscreened torque is never a pass.
//
// Scope: screening-level only (fidelity 2 as an adapter, delegating to
// fidelity-1 AISC checks). This is not a connection certification: no
// pre-tension verification, no fatigue, no prying, no bolt-group
// certification beyond the distribution the adapter consumes.

import { registerSolver, getSolver, listSolvers, envelope as registryEnvelope } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";
import { aggregateJointVerdict, JOINT_VERDICT } from "./joint-governing-check.js";
// Side-effect import: ensures the AISC bolt solvers are registered even
// when this adapter is imported on its own (outside conkay/index.js).
import "./bolted-joint.js";

// Limit states this adapter drives. Names are the registered solver ids so
// a reader can grep bolted-joint.js for any of them.
const LS_SHEAR = "joint.bolt-shear";
const LS_BEARING = "joint.bolt-bearing";
const LS_TEAROUT = "joint.bolt-tearout";
const LS_TENSION = "joint.bolt-tension";
const LS_COMBINED = "joint.bolt-combined";
const LS_DISTRIBUTION = "joint.bolt-group-distribution";

// Verdict enum → the small status vocabulary used in this envelope.
const VERDICT_TO_STATUS = {
  [JOINT_VERDICT.PASS]: "ok",
  [JOINT_VERDICT.FAIL]: "fail",
  [JOINT_VERDICT.INCOMPLETE]: "warn",
  [JOINT_VERDICT.ERROR]: "fail",
};

function firstFinite(...values) {
  for (const v of values) if (Number.isFinite(v)) return v;
  return null;
}

// Material resolution. Accepts a nested { material: {...} }, flat Fu/Fy /
// ultimatePa/yieldPa fields, or a joint-level default shared by every bolt
// or plate. The shape returned is exactly what ctx.material() must return
// for the AISC solvers: { id, label, ultimatePa, yieldPa, source }.
function resolveMaterial(entity, fallback) {
  if (!entity && !fallback) return { id: null, label: null, ultimatePa: null, yieldPa: null, source: null };
  const nested = entity && typeof entity.material === "object" && entity.material ? entity.material : null;
  const src = nested || entity || fallback;
  return {
    id: src.id ?? null,
    label: src.label ?? null,
    ultimatePa: firstFinite(entity?.ultimatePa, entity?.Fu, nested?.ultimatePa, nested?.Fu, fallback?.ultimatePa, fallback?.Fu),
    yieldPa: firstFinite(entity?.yieldPa, entity?.Fy, nested?.yieldPa, nested?.Fy, fallback?.yieldPa, fallback?.Fy),
    source: src.source ?? "declared on the joint.bolt-screening input spec",
  };
}

const positive = (v) => (Number.isFinite(v) && v > 0 ? v : null);

/**
 * Build the minimal node set the AISC solvers read, and collect the names
 * of anything they need that the caller did not supply.
 *
 * Field names mirror the ConKay IR paths exactly (Bolt.geometry.diameter,
 * Bolt.props.stressArea, Plate.geometry.thickness, Joint.props.edgeDistance,
 * Joint.props.holePattern, ...) so there is one vocabulary, not two.
 */
function buildNodes(spec) {
  const missing = [];
  const jointId = typeof spec?.id === "string" && spec.id.length ? spec.id : null;
  if (!jointId) missing.push("id");

  const geo = spec?.geometry && typeof spec.geometry === "object" ? spec.geometry : null;
  if (!geo) missing.push("geometry");

  const edgeDistance = positive(geo?.edgeDistance);
  if (edgeDistance == null) missing.push("geometry.edgeDistance");
  const holeDiameter = positive(geo?.holeDiameter);
  if (holeDiameter == null) missing.push("geometry.holeDiameter");

  const holePattern = Array.isArray(geo?.holePattern) && geo.holePattern.length ? geo.holePattern : null;
  if (geo?.holePattern != null && holePattern == null) missing.push("geometry.holePattern (must be a non-empty array)");

  const boltInputs = Array.isArray(spec?.bolts) ? spec.bolts : [];
  if (!boltInputs.length) missing.push("bolts");
  const plateInputs = Array.isArray(spec?.plates) ? spec.plates : [];
  if (!plateInputs.length) missing.push("plates");

  const load = spec?.load && typeof spec.load === "object" ? spec.load : null;
  if (!load) missing.push("load");
  const shearForceN = firstFinite(load?.shearForceN);
  if (shearForceN == null) missing.push("load.shearForceN");
  const axialForceN = firstFinite(load?.axialForceN) ?? 0;
  const momentNm = firstFinite(load?.momentNm) ?? 0;

  const bolts = boltInputs.map((b, i) => {
    const id = typeof b?.id === "string" && b.id.length ? b.id : `${jointId || "joint"}.bolt${i + 1}`;
    const diameter = positive(b?.diameter);
    if (diameter == null) missing.push(`bolts[${i}].diameter`);
    const stressArea = positive(b?.stressArea);
    // Ab is only needed when the joint actually carries axial tension:
    // joint.bolt-tension refuses to invent it from the nominal diameter.
    if (axialForceN > 0 && stressArea == null) missing.push(`bolts[${i}].stressArea (Ab)`);
    const material = resolveMaterial(b, spec?.boltMaterial);
    if (material.ultimatePa == null) missing.push(`bolts[${i}] material ultimatePa (Fu)`);
    return {
      id,
      kind: "Bolt",
      geometry: { diameter },
      props: { stressArea, pretension: b?.pretension, holeType: b?.holeType },
      material,
    };
  });

  const plates = plateInputs.map((p, i) => {
    const id = typeof p?.id === "string" && p.id.length ? p.id : `${jointId || "joint"}.plate${i + 1}`;
    const thickness = positive(p?.thickness);
    if (thickness == null) missing.push(`plates[${i}].thickness`);
    const material = resolveMaterial(p, spec?.plateMaterial);
    if (material.ultimatePa == null) missing.push(`plates[${i}] material ultimatePa (Fu)`);
    return {
      id,
      kind: "Plate",
      geometry: { thickness, width: p?.width },
      props: {
        grossArea: positive(p?.grossArea),
        netAreaEffective: positive(p?.netAreaEffective),
        shearLagFactor: p?.shearLagFactor,
      },
      material,
    };
  });

  const joint = {
    id: jointId,
    kind: "Joint",
    props: {
      kind: geo?.kind ?? spec?.kind ?? "bearing",
      edgeDistance,
      holeDiameter,
      shearPlanes: geo?.shearPlanes,
      threadsExcluded: geo?.threadsExcluded,
      holePattern,
      eccentricity: geo?.eccentricity ?? null,
      loadVector: geo?.loadVector ?? null,
    },
    material: null,
  };

  const nodes = new Map();
  nodes.set(jointId, joint);
  for (const b of bolts) nodes.set(b.id, b);
  for (const p of plates) nodes.set(p.id, p);

  return { jointId, joint, bolts, plates, nodes, missing, load: { shearForceN, axialForceN, momentNm }, loadCase: spec?.loadCase || "screening" };
}

/**
 * The minimum design-graph context bolted-joint.js reads:
 *   ctx.children(id, "CONTAINS") -> [{ id, kind }]
 *   ctx.loadsOn(id)              -> [{ loadCase, shear, tension, axial }]
 *   ctx.get(id, "props.x" / "geometry.x")
 *   ctx.material(id)             -> { id, label, ultimatePa, yieldPa, source }
 *   ctx.envelopes()              -> envelope list (joint.bolt-combined)
 *   ctx.loadCases()              -> load cases (joint-governing-check)
 */
function makeCtx({ nodes, jointId, bolts, plates, load, envelopes }) {
  return {
    get(nodeId, path) {
      const node = nodes.get(nodeId);
      if (!node || typeof path !== "string") return undefined;
      const dot = path.indexOf(".");
      if (dot < 0) return undefined;
      const section = path.slice(0, dot);
      const field = path.slice(dot + 1);
      if (section === "props") return node.props?.[field];
      if (section === "geometry") return node.geometry?.[field];
      return undefined;
    },
    children(nodeId) {
      return nodeId === jointId ? [...bolts, ...plates] : [];
    },
    material(nodeId) {
      const node = nodes.get(nodeId);
      return node ? node.material : null;
    },
    loadsOn(nodeId) {
      return nodeId === jointId ? [load] : [];
    },
    loadCases() {
      return [
        {
          id: load.loadCase,
          loads: [{ target: jointId, shear: load.shear, tension: load.tension, axial: load.tension }],
        },
      ];
    },
    envelopes: () => envelopes || [],
  };
}

// Reduce an envelope to a single finite utilization, or null when the
// solver did not produce one. Never returns Infinity or NaN.
function utilizationOf(env) {
  if (!env) return null;
  if (Array.isArray(env.margins) && env.margins.length) {
    let worst = 0;
    for (const m of env.margins) {
      const u = Number.isFinite(m.utilization) ? m.utilization
        : (Number.isFinite(m.demand) && Number.isFinite(m.capacity) && m.capacity > 0 ? m.demand / m.capacity : null);
      if (u == null) return null;
      if (u > worst) worst = u;
    }
    return Number.isFinite(worst) ? worst : null;
  }
  // joint.bolt-combined reports an interaction ratio against a limit
  // (1.3 for AISC §J3.7 bearing-type) rather than a demand/capacity margin.
  const ratio = env.outputs?.governingRatio?.value;
  const limit = env.outputs?.governingLimit?.value;
  if (Number.isFinite(ratio) && Number.isFinite(limit) && limit > 0) {
    const u = ratio / limit;
    return Number.isFinite(u) ? u : null;
  }
  const direct = env.outputs?.utilization?.value;
  return Number.isFinite(direct) ? direct : null;
}

/**
 * Run one registered limit state through the registry. Everything the
 * solver needs is already in ctx; anything it refuses is reported as
 * NOT_COMPUTED with a reason that names the solver, never reimplemented.
 *
 * `informational: true` is for solvers that answer a question rather than
 * check a capacity — joint.bolt-group-distribution reports per-bolt demand
 * and emits no margins, so it legitimately has no utilization to reduce.
 * For those, a PASS envelope is a success even with no utilization.
 */
function runLimitState(solverId, ctx, target, { informational = false } = {}) {
  const solver = getSolver(solverId);
  if (!solver) {
    return {
      name: solverId,
      status: "not_computed",
      utilization: null,
      reason: `${solverId} is not in the ConKay solver registry. This adapter calls the registered solver instead of reimplementing its physics, so this limit state cannot be evaluated.`,
    };
  }
  let env;
  try {
    env = registryEnvelope(solver, target, solver.run(ctx, target), { runtimeMs: null });
  } catch (err) {
    return {
      name: solverId,
      status: "not_computed",
      utilization: null,
      reason: `${solverId} threw while running against the synthesized adapter context: ${err && err.message ? err.message : String(err)}`,
    };
  }
  if (env.status === "NOT_COMPUTED") {
    return {
      name: solverId,
      status: "not_computed",
      utilization: null,
      reason: `${solverId}: ${env.reason || "not computed"}`,
      envelope: env,
    };
  }
  if (env.status === "ERROR") {
    return {
      name: solverId,
      status: "not_computed",
      utilization: null,
      reason: `${solverId}: envelope ERROR (${env.error || "execution failure"})`,
      envelope: env,
    };
  }
  const util = informational ? null : utilizationOf(env);
  if (!informational && util == null) {
    return {
      name: solverId,
      status: "not_computed",
      utilization: null,
      reason: `${solverId} returned no finite utilization (envelope status ${env.status}). The adapter does not invent a demand/capacity ratio it was not given.`,
      envelope: env,
    };
  }
  return {
    name: solverId,
    status: env.status === "PASS" ? "ok" : env.status === "FAIL" ? "fail" : env.status === "WARN" ? "warn" : String(env.status).toLowerCase(),
    utilization: util,
    envelope: env,
  };
}

function screenJoint(spec, warnUtilization) {
  const id = typeof spec?.id === "string" && spec.id.length ? spec.id : "<unnamed>";
  let built;
  try {
    built = buildNodes(spec);
  } catch (err) {
    return {
      id,
      status: "not_computed",
      reason: `${id}: joint spec could not be read (${err && err.message ? err.message : String(err)})`,
      governingUtilization: null,
      governingLimitState: null,
      limitStates: [],
      notComputed: { missing: ["(unreadable joint spec)"] },
    };
  }

  if (built.missing.length || !built.jointId) {
    const missing = built.missing.slice();
    // Name the upstream solver that would have consumed each missing class
    // of input, so the honest-propagation path is traceable from the
    // envelope alone.
    const named = [];
    if (missing.some((m) => m.startsWith("geometry.edgeDistance") || m.startsWith("geometry.holeDiameter"))) named.push(LS_TEAROUT);
    if (missing.some((m) => m.startsWith("bolts["))) named.push(`${LS_SHEAR}/${LS_BEARING}`);
    if (missing.some((m) => m.startsWith("plates["))) named.push(LS_BEARING);
    if (missing.some((m) => m.includes("stressArea"))) named.push(LS_TENSION);
    if (missing.some((m) => m.startsWith("load."))) named.push(`${LS_SHEAR}/${LS_TENSION}`);
    return {
      id,
      status: "not_computed",
      reason: `${id}: incomplete bolted-joint spec — missing ${missing.join(", ")}. ${named.length ? `Required by ${[...new Set(named)].join(", ")}; not screened, not passed.` : "No limit state could be attempted."}`,
      governingUtilization: null,
      governingLimitState: null,
      limitStates: [],
      notComputed: { missing },
    };
  }

  const { jointId, joint, bolts, plates, nodes, load: declared, loadCase } = built;
  const nBolts = bolts.length;
  const limitStates = [];
  const envelopes = [];

  const row = (shear, tension) => ({ loadCase, shear: Math.max(0, shear), tension: Math.max(0, tension), axial: Math.max(0, tension) });

  // --- Moment → per-bolt demand, via the existing Crawford-Kulak solver ---
  // Shear and tension run against this demand; bolt-combined gets its
  // capacities from the envelopes of joint.bolt-shear / joint.bolt-tension.
  let connectionShear = Math.max(0, declared.shearForceN);
  let effectiveShear = connectionShear;
  let momentScreened = declared.momentNm === 0;
  if (declared.momentNm !== 0) {
    const eccJoint = joint.props.eccentricity
      || (connectionShear > 0 ? { x: 0, y: declared.momentNm / connectionShear } : null);
    if (eccJoint) {
      joint.props.eccentricity = eccJoint;
      const ctxDist = makeCtx({ nodes, jointId, bolts, plates, load: row(connectionShear, declared.axialForceN), envelopes: [] });
      const dist = runLimitState(LS_DISTRIBUTION, ctxDist, jointId, { informational: true });
      const fMax = dist.envelope?.outputs?.governingForce?.value;
      if (dist.status !== "not_computed" && Number.isFinite(fMax) && fMax > 0) {
        // Re-express the governing per-bolt resultant as an equivalent
        // joint-level shear so the AISC solvers' own equal-distribution
        // demand (shear / bolts.length) reproduces it. Capacities are
        // untouched — they still come from bolted-joint.js.
        effectiveShear = fMax * nBolts;
        momentScreened = true;
        if (dist.envelope) envelopes.push(dist.envelope);
        limitStates.push({
          name: LS_DISTRIBUTION,
          status: "ok",
          utilization: null,
          reason: `informational only (demand distribution, not a capacity check): governing per-bolt resultant ${fMax.toPrecision(6)} N from a ${declared.momentNm} N·m joint moment; the connection checks below were re-run against the equivalent joint shear of ${effectiveShear.toPrecision(6)} N.`,
        });
      } else {
        const why = dist.reason || "no finite governing per-bolt force";
        limitStates.push({
          name: LS_DISTRIBUTION,
          status: "not_computed",
          utilization: null,
          reason: `${LS_DISTRIBUTION} could not distribute the ${declared.momentNm} N·m joint moment, so the moment is UNSCREENED: ${why}`,
        });
      }
    } else {
      limitStates.push({
        name: LS_DISTRIBUTION,
        status: "not_computed",
        utilization: null,
        reason: `${LS_DISTRIBUTION} needs a bolt-group geometry: a ${declared.momentNm} N·m joint moment cannot be turned into per-bolt demand without geometry.holePattern (1 entry per bolt) or geometry.eccentricity. The moment is UNSCREENED.`,
      });
    }
    delete joint.props.eccentricity;
  }

  const ctxMain = makeCtx({ nodes, jointId, bolts, plates, load: row(effectiveShear, declared.axialForceN), envelopes });
  const tensionPresent = declared.axialForceN > 0;

  // Connection-level checks (always) — AISC §J3.6, J3-6a, J3-6c.
  for (const id2 of [LS_SHEAR, LS_BEARING, LS_TEAROUT]) {
    const ls = runLimitState(id2, ctxMain, jointId);
    limitStates.push(ls);
    if (ls.envelope) envelopes.push(ls.envelope);
  }
  // Tension (AISC §J3.6 on Ab) — only when the joint carries axial tension.
  if (tensionPresent) {
    const ls = runLimitState(LS_TENSION, ctxMain, jointId);
    limitStates.push(ls);
    if (ls.envelope) envelopes.push(ls.envelope);
  }

  // Combined (AISC §J3.7) — preferred when the joint carries both shear
  // and tension, because it consumes the shear/tension capacities rather
  // than recomputing them. It reads ctx.envelopes().
  let combinedLimit = null;
  if (tensionPresent && effectiveShear > 0) {
    const ctxCombined = makeCtx({ nodes, jointId, bolts, plates, load: row(effectiveShear, declared.axialForceN), envelopes });
    const ls = runLimitState(LS_COMBINED, ctxCombined, jointId);
    limitStates.push(ls);
    if (ls.envelope) envelopes.push(ls.envelope);
    combinedLimit = ls;
  }

  // --- Governing utilization -------------------------------------------------
  // joint.governing-check's aggregateJointVerdict IS used below for the
  // full AISC-scope PASS|FAIL|INCOMPLETE|ERROR verdict, but that enum
  // carries no utilization, so the screening number is the max utilization
  // across the limit states actually evaluated. Not a placeholder: it is
  // one of the names in limitStates.
  const evaluated = limitStates.filter((l) => l.utilization != null && Number.isFinite(l.utilization));
  const blocked = limitStates.filter((l) => l.status === "not_computed");

  if (!evaluated.length) {
    return {
      id,
      status: "not_computed",
      reason: `${id}: no limit state produced a utilization — ${blocked.map((b) => b.name).join(", ") || "none attempted"}`,
      governingUtilization: null,
      governingLimitState: null,
      limitStates,
      notComputed: { missing: blocked.map((b) => b.reason) },
    };
  }

  let governing = evaluated[0];
  for (const l of evaluated) if (l.utilization > governing.utilization) governing = l;
  const utilization = governing.utilization;

  let status = utilization > 1 ? "fail" : utilization > warnUtilization ? "warn" : "ok";
  // Honesty floor: a joint with an intended-but-uncomputed limit state is
  // never reported "ok". Mirrors joint-governing-check's INCOMPLETE
  // semantics (a blocked required check cannot pass a joint).
  const flooredByIncomplete = status === "ok" && blocked.length > 0;
  if (flooredByIncomplete) status = "warn";

  // Full AISC-scope verdict from the existing aggregator. It is reported
  // alongside (not instead of) the screening utilization: a bearing-kind
  // joint also requires gross/net section and block shear, which this
  // adapter does not run, so INCOMPLETE is the expected honest answer
  // there.
  let verdict = null;
  try {
    const solverDomains = new Set(listSolvers().flatMap((s) => s.domains || [s.domain]));
    const v = aggregateJointVerdict(
      jointId,
      { ...ctxMain, _solverDomains: solverDomains },
      envelopes,
      { jointKind: joint.props.kind },
    );
    verdict = {
      value: v.verdict,
      status: VERDICT_TO_STATUS[v.verdict] || "warn",
      scope: v.declaredScope,
      jointKind: v.jointKind,
      checked: v.checks.length,
      missing: v.missing.map((m) => `${m.domain} (${m.reason})`),
      blocked: v.blocked.map((b) => `${b.domain} (${b.reason})`),
      failed: v.failed.map((f) => `${f.domain} (${f.status})`),
    };
  } catch (err) {
    verdict = {
      value: JOINT_VERDICT.ERROR,
      status: "fail",
      error: `aggregateJointVerdict threw: ${err && err.message ? err.message : String(err)}`,
    };
  }

  return {
    id,
    status,
    reason: flooredByIncomplete
      ? `${id}: utilization ${utilization.toPrecision(6)} ≤ ${warnUtilization}, but ${blocked.map((b) => b.name).join(", ")} could not be evaluated — floored to warn, never an unqualified pass.`
      : `${id}: ${governing.name} governs at utilization ${utilization.toPrecision(6)} (${status}).`,
    governingUtilization: utilization,
    governingLimitState: governing.name,
    tiedLimitStates: evaluated.filter((l) => l.utilization === utilization).map((l) => l.name),
    limitStates,
    verdict,
    screened: {
      directShearN: declared.shearForceN,
      axialForceN: declared.axialForceN,
      momentNm: declared.momentNm,
      momentScreened,
      effectiveShearN: effectiveShear,
      bolts: nBolts,
    },
    incomplete: blocked.length ? { missing: blocked.map((b) => b.reason) } : undefined,
  };
}

/**
 * Screen a list of bolted joints against the registered AISC 360-16 bolt
 * limit states.
 *
 * @param {object}  opts
 * @param {Array}   opts.joints           one spec per bolted joint
 * @param {number} [opts.warnUtilization=0.90] utilization above which a joint warns
 */
export function boltScreening({ joints, warnUtilization = 0.90 } = {}) {
  const warn = warnUtilization;
  const empty = (reason) => ({
    status: "not_computed",
    reason,
    partial: false,
    joints: [],
    overUtilizedJoints: [],
    partialJoints: [],
    warnUtilization: Number.isFinite(warn) ? warn : null,
    totals: { evaluated: 0, failed: 0, warned: 0, notComputed: 0 },
  });

  if (!Array.isArray(joints) || joints.length === 0) return empty("joints array required");
  if (!Number.isFinite(warn) || warn <= 0 || warn > 1) {
    return empty(`warnUtilization must be a finite threshold in (0, 1], got ${JSON.stringify(warnUtilization)}`);
  }

  const results = joints.map((j) => screenJoint(j, warn));

  const evaluated = results.filter((r) => Number.isFinite(r.governingUtilization));
  const notComputed = results.filter((r) => !Number.isFinite(r.governingUtilization));
  // partial = something in the answer is missing. Either a whole joint could
  // not be evaluated, or a joint was evaluated with a blocked limit state.
  const partialJoints = [
    ...new Set([
      ...notComputed.map((r) => r.id),
      ...results.filter((r) => Number.isFinite(r.governingUtilization) && r.limitStates.some((l) => l.status === "not_computed")).map((r) => r.id),
    ]),
  ];
  const overUtilizedJoints = evaluated.filter((r) => r.governingUtilization > 1).map((r) => r.id);

  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const partial = partialJoints.length > 0;

  let status = "ok";
  if (failed > 0) status = "fail";
  else if (warned > 0 || partial) status = "warn";

  let reason;
  if (status === "fail") {
    reason = `${overUtilizedJoints.length} of ${joints.length} joint(s) over-utilized: ${overUtilizedJoints.join(", ")}${partial ? `; ${partialJoints.length} joint(s) partially screened: ${partialJoints.join(", ")}` : ""}.`;
  } else if (partialJoints.length) {
    reason = `No joint failed, but ${partialJoints.length} of ${joints.length} could not be fully screened: ${partialJoints.join(", ")}. Incomplete joints are never reported as passing.`;
  } else {
    reason = `${evaluated.length} joint(s) screened against the AISC 360-16 §J3 bolt limit states; worst utilization ${results.reduce((a, r) => (Number.isFinite(r.governingUtilization) && (!Number.isFinite(a) || r.governingUtilization > a) ? r.governingUtilization : a), null)?.toPrecision(6) ?? "n/a"} at warn threshold ${warn}.`;
  }

  return {
    status,
    reason,
    partial,
    joints: results,
    overUtilizedJoints,
    partialJoints,
    warnUtilization: warn,
    totals: {
      evaluated: evaluated.length,
      failed,
      warned,
      notComputed: notComputed.length,
    },
    assumptions: [
      "Adapter only: every capacity comes from the registered solvers in physics/solvers/bolted-joint.js (AISC 360-16 LRFD). No AISC equation is reimplemented here.",
      "The joint moment is distributed by joint.bolt-group-distribution (Crawford-Kulak) and then re-expressed as an equivalent joint shear; when no holePattern is supplied the moment is reported UNSCREENED and the joint is never an unqualified pass.",
      "The AISC bolt checks assume concentric load; the equal-bolt-share demand is retained inside bolted-joint.js and only the joint-level demand is scaled by the adapter.",
      "joint.bolt-combined divides the TOTAL joint force by a PER-BOLT capacity (its own upstream convention). That is conservative for multi-bolt joints; it is not corrected here because bolted-joint.js is not modified.",
      "A limit state that cannot be synthesized or that the upstream solver refuses is reported NOT_COMPUTED with a reason naming the solver. No look-alike calculation is substituted.",
      "Screening level only. Not a connection certification: no pre-tension verification, no prying (joint.prying-action), no slip-critical check, no fatigue, no corrosion.",
    ],
  };
}

registerSolver({
  id: "joint.bolt-screening",
  version: "1.0.0",
  domain: "structural",
  domains: ["structural", "robotics"],
  method: "joint.bolt-screening-adapter",
  fidelity: 2,
  // Graph-native: runs when a node carries props.joint.boltScreen.
  targets: graphTargets("joint.boltScreen"),
  run: graphRunner("joint.boltScreen", (ctx, id, props) => envelope(boltScreening(props))),
});