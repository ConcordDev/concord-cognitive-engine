// server/lib/conkay/structural/car-chassis-frame.js
//
// Car chassis screen as a 3D ladder frame (structure.frame), replacing the
// one-rail point-load idealisation with the actual two rails, cross-members,
// four suspension supports and two load cases:
//   bending: gross mass × the vertical load factor, spread along both rails;
//   twist:   rear axle held, front-left held vertically, a test force at the
//            front-right pickup: torsional stiffness = couple / twist.
// The rails (section, material) are the car's RAIL_L / RAIL_R parts, read from
// the design graph, so a rail edit re-runs the frame. The car layout does not
// place the rails (both sit at y = 0, a placeholder) and has no cross-members,
// so the rail spacing and the cross-members are SCREEN LAYOUT CHOICES, stated
// in `choices` and in the run's assumptions, never presented as the design.

const num = (v) => (typeof v === "number" ? v : parseFloat(v));

export const CHASSIS_SCREEN_CHOICES = Object.freeze({
  railSpacingM: { value: 1.1, state: "design choice", basis: "screen layout choice: rails at y = ±0.55 m; the car layout places both rails at y = 0 (placeholder)" },
  crossMembers: { value: ["front-end", "front-axle", "rear-axle", "rear-end"], state: "design choice", basis: "screen layout choice: four cross-members of the rail section at the rail ends and the axle lines; none are designed in the car" },
  loadFactor: { value: 2, state: "estimated", basis: "2 g vertical, the same assumption as vehicle.chassis-screen; no load spectrum measured" },
  twistForceN: { value: 10, state: "design choice", basis: "test force for the stiffness case: linear, so the stiffness does not depend on it; small so the twist stays inside the small-displacement range" },
});

/** Add the ladder-frame model to a car IR (from buildCarFromLibrary). Returns a new IR. */
export function withChassisFrame(ir, choices = {}) {
  const c = { ...Object.fromEntries(Object.entries(CHASSIS_SCREEN_CHOICES).map(([k, v]) => [k, v.value])), ...choices };
  const out = JSON.parse(JSON.stringify(ir));
  const veh = out.nodes.find((n) => n.id === "VEH");
  const rail = out.nodes.find((n) => n.id === "RAIL_L");
  const chassis = out.nodes.find((n) => n.id === "CHASSIS");
  if (!veh || !rail || !chassis) throw new Error("car IR needs VEH, RAIL_L and CHASSIS");
  const fx = num(veh.props.vehicle.frontAxleX), rx = num(veh.props.vehicle.rearAxleX);
  const len = num(rail.geometry.length), xc = num(rail.position.x), z = num(rail.position.z);
  const x0 = xc - len / 2, x1 = xc + len / 2;
  if (!(x0 < fx && fx < rx && rx < x1)) throw new Error("rails must span both axles");
  const y = c.railSpacingM / 2;
  const stations = { "front-end": x0, "front-axle": fx, "rear-axle": rx, "rear-end": x1 };
  const nodes = [];
  for (const [side, ys] of [["L", y], ["R", -y]]) for (const [k, x] of Object.entries(stations)) nodes.push({ id: `${side}.${k}`, x, y: ys, z });
  const keys = Object.keys(stations);
  const members = [];
  for (const side of ["L", "R"]) for (let i = 0; i < 3; i++) members.push({ id: `rail-${side}${i + 1}`, i: `${side}.${keys[i]}`, j: `${side}.${keys[i + 1]}`, part: `RAIL_${side}` });
  for (const k of c.crossMembers) members.push({ id: `cross-${k}`, i: `L.${k}`, j: `R.${k}`, part: "RAIL_L" });
  const vertical = (n) => ({ node: n, fix: ["z"] });
  const supports = [{ node: "L.front-axle", fix: ["x", "y", "z"] }, { node: "R.front-axle", fix: ["x", "z"] }, vertical("L.rear-axle"), vertical("R.rear-axle")];
  const twistSupports = [{ node: "L.rear-axle", fix: ["x", "y", "z"] }, { node: "R.rear-axle", fix: ["x", "z"] }, vertical("L.front-axle")];
  chassis.props = {
    ...(chassis.props || {}),
    frameModel: {
      nodes, members, supports,
      loadCases: [
        { id: "bending", weight: [{ from: { solver: "mass.assembly", target: "VEH", output: "grossMass" }, factor: CHASSIS_SCREEN_CHOICES.loadFactor.value === c.loadFactor ? CHASSIS_SCREEN_CHOICES.loadFactor : { value: c.loadFactor, state: "estimated", basis: "caller" }, dir: [0, 0, -1], members: members.filter((m) => m.id.startsWith("rail-")).map((m) => m.id) }] },
        { id: "twist", stiffnessOnly: true, nodal: [{ node: "R.front-axle", F: [0, 0, c.twistForceN] }], supports: twistSupports },
      ],
      stiffness: [{ id: "torsional", case: "twist", node: "R.front-axle", dof: "z", force: c.twistForceN, arm: c.railSpacingM, kind: "torsional" }],
      buckling: { cases: ["bending"] },
      assumptions: [
        `Screen layout choices (not the car design): ${CHASSIS_SCREEN_CHOICES.railSpacingM.basis}; ${CHASSIS_SCREEN_CHOICES.crossMembers.basis}.`,
        "Suspension pickups are rigid vertical supports at the axle lines on the rails; springs, bushings and the subframes are not modelled.",
        "The CFRP tub, body and floor are not in the frame: their stiffness is not credited.",
        "I-section torsion is Saint-Venant only (warping restraint at the joints not credited: conservative for twist stiffness).",
        "Gross mass spread uniformly along the rails (bending case), times the stated load factor.",
      ],
      choices: c,
    },
  };
  return out;
}
