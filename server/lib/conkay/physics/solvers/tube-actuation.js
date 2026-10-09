// server/lib/conkay/physics/solvers/tube-actuation.js
//
// structural.tube-bending — screening bending check of a rectangular-tube
// cantilever (props.bending): tip mass read from another node's mass
// (props.bending.tipMassFrom), lever arm from that node's position to the
// member root (props.bending.rootX along the member axis), member
// self-weight as a uniform load, times a dynamic factor. Section properties
// are computed here from the outside dimensions and wall (sharp corners):
//   I = (b·h³ − (b−2t)(h−2t)³)/12,  S = I/(h/2),  σ = M/S.
// Allowable = Fy / factor of safety. If the material's yield is a typical
// value rather than a specified minimum, or the dynamic factor is an
// estimate, the result says so.
//
// actuation.static-torque — joint torque to hold the stated pose:
// τ = (known mass carried by the joint) · g · lever · share, against the
// actuator's datasheet rated (continuous) torque, and peak torque reported.

import { registerSolver } from "../registry.js";

const G = 9.80665;

export function rectTubeSection({ width: b, height: h, wall: t }) {
  const bi = Math.max(0, b - 2 * t); const hi = Math.max(0, h - 2 * t);
  const A = b * h - bi * hi;
  const I = (b * h ** 3 - bi * hi ** 3) / 12;
  return { A, I, S: I / (h / 2) };
}

export const tubeBending = registerSolver({
  id: "structural.tube-bending",
  version: "1.0.0",
  domain: "structural.bending",
  fidelity: 1,
  method: "σ = M/S, M = DF·(m_tip·g·a + w·L²/2), S from sharp-corner rectangular tube; allowable = Fy/FS",
  reference: "Euler–Bernoulli beam, linear elastic; section by closed-form RHS formulas",
  regime: "linear-elastic, static-equivalent (dynamic factor), small deflection, no local buckling or weld HAZ",
  units: { inputs: "m, kg, Pa", outputs: "Pa, N·m, m" },
  tolerance: "exact arithmetic",
  screening: true,
  targets: (g) => g.nodesOfKind("Beam").filter((n) => n.geometry?.shape === "rect-tube" && n.props?.bending).map((n) => n.id),
  run(ctx, id) {
    const g = ctx.get(id, "geometry");
    const b = ctx.get(id, "props.bending");
    const mat = ctx.material(id);
    if (!mat || mat.yieldPa == null) return { notComputed: "material needs a yield strength" };
    const tip = b.tipMassFrom;
    const tipMass = ctx.get(tip, "props.mass.value");
    const tipPos = ctx.get(tip, "position");
    if (!Number.isFinite(tipMass) || !tipPos) return { notComputed: `tip mass/position of ${tip} unknown` };
    const axis = ctx.get(id, "props.axis") || "x";
    const lever = Math.abs(tipPos[axis] - b.rootAt);
    const sec = rectTubeSection(g);
    const w = sec.A * mat.densityKgM3 * G; // N/m self-weight
    const DF = b.dynamicFactor?.value ?? 1;
    const FS = b.factorOfSafety?.value;
    if (!Number.isFinite(FS)) return { notComputed: "props.bending.factorOfSafety required (a design rule, not a default)" };
    const M = DF * (tipMass * G * lever + (w * g.length ** 2) / 2);
    const sigma = M / sec.S;
    const allow = mat.yieldPa / FS;
    const deflection = (tipMass * G * lever ** 3) / (3 * mat.youngsModulusPa * sec.I);
    const warnings = [];
    if (mat.basis !== "specified minimum") warnings.push(`yield is a ${mat.basis} value, not a specified minimum: the check is estimated`);
    if (b.dynamicFactor?.state === "estimated") warnings.push(`dynamic factor ${DF} is an estimate (${b.dynamicFactor.basis || "no basis stated"})`);
    if (lever > g.length + 1e-9) warnings.push(`tip load lever ${lever.toFixed(3)} m exceeds the member length ${g.length.toFixed(3)} m (payload hangs beyond the tip)`);
    return {
      inputs: {
        width: { value: g.width, unit: "m" }, height: { value: g.height, unit: "m" }, wall: { value: g.wall, unit: "m" }, length: { value: g.length, unit: "m" },
        tipMass: { value: tipMass, unit: "kg", source: `${tip} props.mass (${ctx.get(tip, "props.mass.state")})` },
        lever: { value: lever, unit: "m" },
        dynamicFactor: { value: DF, status: b.dynamicFactor?.state || "stated" },
        factorOfSafety: { value: FS, status: b.factorOfSafety?.state || "design rule" },
        yield: { value: mat.yieldPa, unit: "Pa", basis: mat.basis, source: mat.source },
      },
      outputs: {
        area: { value: sec.A, unit: "m2" }, I: { value: sec.I, unit: "m4" }, S: { value: sec.S, unit: "m3" },
        moment: { value: M, unit: "N·m" }, stress: { value: sigma, unit: "Pa" }, allowable: { value: allow, unit: "Pa" },
        tipDeflection: { value: deflection, unit: "m" },
      },
      margins: [{ check: `bending stress ≤ Fy/${FS} (${id})`, demand: sigma, capacity: allow, unit: "Pa" }],
      warnings,
      assumptions: ["Cantilever fixed at the root; tip mass at its CG lever.", "Sharp-corner section (corner radii ignored).", "No weld heat-affected-zone reduction (members bolted/clamped)."],
    };
  },
});

export const staticTorque = registerSolver({
  id: "actuation.static-torque",
  version: "1.0.0",
  domain: "actuation.torque",
  fidelity: 0,
  method: "τ = m_carried·g·lever·share vs datasheet rated torque",
  regime: "quasi-static pose; no acceleration torques",
  units: { inputs: "kg, m, N·m", outputs: "N·m" },
  tolerance: "exact arithmetic",
  screening: true,
  targets: (g) => g.nodesOfKind("Actuator").filter((n) => n.props?.holding && n.props?.actuator).map((n) => n.id),
  run(ctx, id) {
    const h = ctx.get(id, "props.holding");
    const a = ctx.get(id, "props.actuator");
    const mb = ctx.result("mass.budget", h.assembly);
    if (!mb || mb.status === "NOT_COMPUTED") return { notComputed: `no mass budget for ${h.assembly}` };
    const items = mb.outputs.items.value;
    const below = new Set(h.excludeBelow || []);
    const carried = items.filter((i) => !below.has(i.id)).reduce((s, i) => s + i.mass, 0);
    const lever = h.lever?.value;
    if (!Number.isFinite(lever)) return { notComputed: "props.holding.lever required" };
    const tau = carried * G * lever * (h.share ?? 1);
    const unknown = mb.outputs.unknownItems.value;
    return {
      inputs: {
        carriedMass: { value: carried, unit: "kg", source: mb.runId },
        lever: { value: lever, unit: "m", status: h.lever.state || "stated" },
        share: { value: h.share ?? 1 },
        ratedTorque: { value: a.ratedTorqueNm, unit: "N·m", source: a.source },
      },
      outputs: { holdingTorque: { value: tau, unit: "N·m" }, peakTorque: { value: a.peakTorqueNm, unit: "N·m" } },
      margins: [{ check: `holding torque ≤ rated continuous torque (${id})`, demand: tau, capacity: a.ratedTorqueNm, unit: "N·m" }],
      warnings: [
        ...(h.lever.state === "estimated" ? [`pose lever ${lever} m is an estimate`] : []),
        ...(unknown.length ? [`carried mass excludes ${unknown.length} unknown-mass item(s): torque is understated`] : []),
      ],
      assumptions: [h.pose || "stated pose", "Gravity only; no inertial or impact torques."],
    };
  },
});
