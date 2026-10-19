// server/lib/conkay/physics/solvers/robotics.js
//
// Screening checks for a limb and a walk. They are not a logged gait.
//
// robotics.limb-torque — gravity moment about a joint:
//   τ = g · sin(θ) · (m_limb · L · f_com + m_payload · L)
//   θ is the angle from vertical (0 upright, π/2 horizontal = the largest
//   static moment). A stated mass is used as given. massBasis "upper-bound"
//   means the caller put the whole robot mass on the limb; the torque is
//   then an upper bound, labelled so, not a link mass.
//
// robotics.walk-balance — quasi-static single support. The COM sits on the
//   centerline. It is inside one foot only when half the foot width covers
//   half the stance width. Otherwise the check fails and reports how far
//   the COM must shift onto the stance foot. No ZMP, no arm swing.

import { registerSolver } from "../registry.js";
import { parseQuantity } from "../../compiler/units.js";

export const G = 9.80665;

const LIMB_KINDS = new Set(["Joint", "Actuator", "Limb"]);

function angleOf(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(rad|deg|°)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /deg|°/i.test(m[2] || "") ? (n * Math.PI) / 180 : n;
}

function si(value, dim) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return null;
  if (dim === "angle") return angleOf(value);
  const text = typeof value === "string" ? value.replace(/N·m/gi, "Nm").replace(/N\*m/gi, "Nm") : value;
  const q = parseQuantity(text, dim);
  return q.ok ? q.si : null;
}

/**
 * Static gravity moment about the joint.
 * comFraction is the COM distance from the joint as a fraction of length
 * (0.5 for a uniform link). Payload is taken at the tip.
 */
export function limbHoldingTorque({
  massKg,
  lengthM,
  comFraction = 0.5,
  angleFromVerticalRad = Math.PI / 2,
  payloadKg = 0,
} = {}) {
  const s = Math.sin(angleFromVerticalRad);
  const limbArmM = lengthM * comFraction;
  const payloadArmM = lengthM;
  const torqueNm = G * s * (massKg * limbArmM + payloadKg * payloadArmM);
  return { torqueNm, limbArmM, payloadArmM, sinTheta: s };
}

/**
 * Quasi-static walk on level ground. singleSupportMarginM is positive when
 * the centerline COM lies inside one foot.
 */
export function walkBalance({ massKg, stanceWidthM, footWidthM, footLengthM = null, comHeightM = null } = {}) {
  const halfStance = stanceWidthM / 2;
  const halfFoot = footWidthM / 2;
  const singleSupportMarginM = halfFoot - halfStance;
  const requiredComShiftM = Math.max(0, -singleSupportMarginM);
  return {
    singleSupportMarginM,
    requiredComShiftM,
    unshiftedAnkleTorqueNm: massKg * G * halfStance,
    doubleSupportMarginM: halfStance + halfFoot,
    footLengthM,
    comHeightM,
  };
}

function massOf(ctx, nodeId) {
  const env = ctx.result("mass.part", nodeId);
  const m = env?.outputs?.mass?.value;
  return Number.isFinite(m) ? { kg: m, source: env.runId } : null;
}

export const limbTorque = registerSolver({
  id: "robotics.limb-torque",
  version: "1.0.0",
  domain: "robotics.torque",
  domains: ["robotics.torque"],
  fidelity: 0,
  method: "τ = m·g·L·sin(θ) about the joint; θ from vertical; payload at the tip",
  regime: "quasi-static; no angular acceleration",
  units: { inputs: "kg, m, rad, N·m", outputs: "N·m" },
  tolerance: "exact arithmetic",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => LIMB_KINDS.has(n.kind) && n.props?.limb).map((n) => n.id),
  run(ctx, id) {
    const limb = ctx.get(id, "props.limb") || {};
    const lengthM = si(limb.length ?? limb.lengthM, "length");
    if (!(lengthM > 0)) return { notComputed: "props.limb.length required (metres)" };
    let massKg = si(limb.massKg ?? limb.mass, "mass");
    let massSource = limb.massBasis === "upper-bound" ? "stated upper bound (whole-robot mass on this limb)" : "props.limb.massKg";
    if (!Number.isFinite(massKg) && limb.massFrom) {
      const got = massOf(ctx, limb.massFrom);
      if (!got) return { notComputed: `no mass for ${limb.massFrom}` };
      massKg = got.kg;
      massSource = got.source;
    }
    if (!Number.isFinite(massKg) && ctx.get(id, "props.mass") != null) {
      const got = massOf(ctx, id);
      if (got) { massKg = got.kg; massSource = got.source; }
    }
    if (!(massKg > 0)) return { notComputed: "props.limb.massKg (or massFrom) required" };
    const comFraction = Number.isFinite(limb.comFraction) ? limb.comFraction : 0.5;
    if (!(comFraction > 0 && comFraction <= 1)) return { notComputed: "props.limb.comFraction must be in (0, 1]" };
    const angle = limb.angleFromVertical == null ? null : si(limb.angleFromVertical, "angle");
    const angleRad = angle == null ? Math.PI / 2 : angle;
    if (!Number.isFinite(angleRad)) return { notComputed: "props.limb.angleFromVertical is not an angle" };
    const payloadKg = si(limb.payloadKg ?? 0, "mass") || 0;
    const t = limbHoldingTorque({ massKg, lengthM, comFraction, angleFromVerticalRad: angleRad, payloadKg });
    const rated = si(limb.ratedTorqueNm ?? ctx.get(id, "props.actuator.ratedTorqueNm"), "torque");
    const warnings = [];
    if (limb.massBasis === "upper-bound") warnings.push("limb mass is an upper bound (the whole stated robot mass). Torque is high on purpose.");
    if (angle == null) warnings.push("angle not stated; torque is the horizontal gravity moment (θ = π/2), the static maximum");
    const margins = Number.isFinite(rated)
      ? [{ check: `limb holding torque ≤ rated (${id})`, demand: t.torqueNm, capacity: rated, unit: "N·m" }]
      : [];
    if (!Number.isFinite(rated)) warnings.push("no rated torque: the moment is computed and not checked against an actuator");
    return {
      inputs: {
        mass: { value: massKg, unit: "kg", source: massSource },
        length: { value: lengthM, unit: "m" },
        comFraction: { value: comFraction },
        angleFromVertical: { value: angleRad, unit: "rad" },
        payload: { value: payloadKg, unit: "kg" },
        ...(Number.isFinite(rated) ? { ratedTorque: { value: rated, unit: "N·m", source: limb.source || ctx.get(id, "props.actuator.source") || "props.limb.ratedTorqueNm" } } : {}),
      },
      outputs: {
        holdingTorque: { value: t.torqueNm, unit: "N·m" },
        limbArm: { value: t.limbArmM, unit: "m" },
      },
      margins,
      warnings,
      assumptions: [
        "Quasi-static. θ = 0 is aligned with gravity; θ = π/2 is horizontal.",
        comFraction === 0.5 ? "COM at mid-link (uniform limb) unless comFraction is set." : `COM fraction ${comFraction} as stated.`,
        "No inertial torque.",
      ],
    };
  },
});

export const walkBalanceCheck = registerSolver({
  id: "robotics.walk-balance",
  version: "1.0.0",
  domain: "robotics.walk",
  domains: ["robotics.walk"],
  fidelity: 0,
  method: "single-support margin = footWidth/2 − stanceWidth/2; unshifted ankle torque = m·g·(stanceWidth/2)",
  regime: "quasi-static, level ground, COM on the centerline; no ZMP",
  units: { inputs: "kg, m", outputs: "m, N·m" },
  tolerance: "exact geometry",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.walk).map((n) => n.id),
  run(ctx, id) {
    const w = ctx.get(id, "props.walk") || {};
    const stanceWidthM = si(w.stanceWidth ?? w.stanceWidthM, "length");
    const footWidthM = si(w.footWidth ?? w.footWidthM, "length");
    if (!(stanceWidthM > 0) || !(footWidthM > 0)) return { notComputed: "props.walk needs stanceWidth and footWidth (metres)" };
    let massKg = si(w.massKg ?? w.mass, "mass");
    let massSource = "props.walk.massKg";
    if (!Number.isFinite(massKg)) {
      const cg = ctx.result("mass.cg", id);
      const m = cg?.outputs?.mass?.value;
      if (Number.isFinite(m) && cg.status !== "NOT_COMPUTED" && cg.status !== "ERROR") {
        massKg = m;
        massSource = cg.runId;
      }
    }
    if (!Number.isFinite(massKg) && ctx.get(id, "props.massBudget")) {
      const budget = ctx.result("mass.budget", id);
      const known = budget?.outputs?.knownMass?.value;
      if (Number.isFinite(known)) { massKg = known; massSource = budget.runId; }
    }
    if (!(massKg > 0)) return { notComputed: "walk mass missing: set props.walk.massKg or give the assembly a closed mass.cg" };
    const footLengthM = si(w.footLength ?? w.footLengthM, "length");
    const comHeightM = si(w.comHeight ?? w.comHeightM, "length");
    const b = walkBalance({ massKg, stanceWidthM, footWidthM, footLengthM, comHeightM });
    const rated = si(w.ratedAnkleTorqueNm, "torque");
    const failures = [];
    if (b.singleSupportMarginM < 0) {
      failures.push(`quasi-static single support: COM is ${(-b.singleSupportMarginM).toFixed(3)} m outside the stance foot. Shift the COM ${b.requiredComShiftM.toFixed(3)} m toward the stance foot, or widen the foot. This is not a dynamic walking proof.`);
    }
    const margins = [];
    if (Number.isFinite(rated)) {
      margins.push({ check: `unshifted single-support ankle torque ≤ rated (${id})`, demand: b.unshiftedAnkleTorqueNm, capacity: rated, unit: "N·m" });
    }
    return {
      inputs: {
        mass: { value: massKg, unit: "kg", source: massSource },
        stanceWidth: { value: stanceWidthM, unit: "m" },
        footWidth: { value: footWidthM, unit: "m" },
        ...(Number.isFinite(footLengthM) ? { footLength: { value: footLengthM, unit: "m" } } : {}),
        ...(Number.isFinite(comHeightM) ? { comHeight: { value: comHeightM, unit: "m" } } : {}),
      },
      outputs: {
        singleSupportMargin: { value: b.singleSupportMarginM, unit: "m" },
        requiredComShift: { value: b.requiredComShiftM, unit: "m" },
        unshiftedAnkleTorque: { value: b.unshiftedAnkleTorqueNm, unit: "N·m" },
        doubleSupportMargin: { value: b.doubleSupportMarginM, unit: "m" },
      },
      margins,
      failures,
      warnings: Number.isFinite(rated) ? [] : ["no rated ankle torque: the moment is computed and not checked against an actuator"],
      assumptions: [
        "COM stays on the centerline until the robot shifts weight. Quasi-static, level ground.",
        "Double support contains the COM whenever both feet are on the ground (margin = stanceWidth/2 + footWidth/2).",
        "Not a logged walk and not a ZMP check.",
      ],
    };
  },
});
