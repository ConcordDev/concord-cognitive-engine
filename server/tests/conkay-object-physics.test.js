// Physics for everyday objects on any build: tipping, a cooling drink, a wing.
// Each is pinned to a closed-form benchmark it must reproduce, plus honesty:
// a property it needs and was not given is NOT_COMPUTED, never assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { liftingLine, nacaZeroLift, convexHull } from "../lib/conkay/physics/solvers/objects.js";

const near = (a, b, rel, msg = "") => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);
const run = (nodes, edges = [], materials) => {
  const r = openDesign({ design: { id: "t", name: "t" }, nodes, edges, loadCases: [], requirements: [], ...(materials ? { materials } : {}) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return (solver, target) => r.session.results().find((e) => e.solver.id === solver && e.target === target);
};

test("lifting line: an elliptic wing gives CL = a0 α / (1 + a0/(π AR)) and e = 1 (Anderson Eq. 5.43)", () => {
  const b = 10, c0 = 1.5, a0 = 2 * Math.PI, alpha = (5 * Math.PI) / 180;
  const r = liftingLine({ span: b, chordAt: (y) => c0 * Math.sqrt(Math.max(0, 1 - (2 * y / b) ** 2)), alphaAt: () => alpha, alphaL0At: () => 0, N: 60 });
  const S = (Math.PI * b * c0) / 4, AR = b * b / S;
  near(r.AR, AR, 1e-3, "AR");
  near(r.CL, (a0 * alpha) / (1 + a0 / (Math.PI * AR)), 2e-3, "CL");
  near(r.e, 1, 1e-3, "e");
  near(r.CDi, (r.CL ** 2) / (Math.PI * AR), 3e-3, "CDi");
});

test("lifting line: a rectangular AR 6 wing has e ≈ 0.95 (Anderson Fig. 5.20, δ ≈ 0.05)", () => {
  const r = liftingLine({ span: 6, chordAt: () => 1, alphaAt: () => 0.08, alphaL0At: () => 0, N: 60 });
  assert.ok(r.e > 0.93 && r.e < 0.97, `e = ${r.e}`);
});

test("thin-airfoil zero-lift angle: NACA 2412 is −2.08°; symmetric sections are 0", () => {
  near((nacaZeroLift("2412") * 180) / Math.PI, -2.077, 2e-3, "2412");
  assert.equal(nacaZeroLift("0012"), 0);
});

test("a lofted NACA wing on a build: lift, drag and the lift-≥-weight check, every value sourced", () => {
  const wing = (aero) => [{ id: "W", kind: "Part", name: "wing", material: "aluminum-6061-t6", props: { axis: "y", aero },
    geometry: { shape: "loft", sections: [{ at: 0, shape: "naca", chord: "1.5 m", naca: "2412" }, { at: "5 m", shape: "naca", chord: "1.5 m", naca: "2412" }] } }];
  const air = { density: { value: "1.225 kg/m3", source: "ISA sea level" }, kinematicViscosity: { value: "1.46e-5 m^2/s", source: "ISA sea level" } };
  const get = run(wing({ speed: "30 m/s", air, angleOfAttack: "4 deg", stallAngle: { value: "15 deg", source: "NACA 2412 data" }, mustLift: { value: "500 kg", source: "the person" } }));
  const e = get("aero.lifting-line", "W");
  assert.notEqual(e.status, "NOT_COMPUTED", e.reason);
  // the same wing through the bare function: L = ½ ρ V² S CL
  const ll = liftingLine({ span: 10, chordAt: () => 1.5, alphaAt: () => (4 * Math.PI) / 180, alphaL0At: () => nacaZeroLift("2412"), N: 40 });
  near(e.outputs.lift.value, 0.5 * 1.225 * 900 * 15 * ll.CL, 1e-6, "lift");
  assert.ok(e.margins.some((m) => /lift at least the weight/.test(m.check)));
  assert.equal(e.margins.find((m) => /weight/.test(m.check)).demand, 500 * 9.80665);
  // without air properties it says what it needs
  const n = run(wing({ speed: "30 m/s" }))("aero.lifting-line", "W");
  assert.equal(n.status, "NOT_COMPUTED");
  assert.match(n.reason, /air\.density/);
});

test("tipping: a standing block tips at atan(half-width / CG height); a push tips it when F·H > W·d", () => {
  const block = (tipping) => [
    { id: "A", kind: "Assembly", name: "block", props: { tipping } },
    { id: "B", kind: "Part", name: "block", material: "steel-a36", position: { x: 0, y: 0, z: "200 mm" }, geometry: { shape: "box", length: "200 mm", width: "200 mm", height: "400 mm" } },
  ];
  const edges = [{ from: "A", to: "B", type: "CONTAINS" }];
  const W = 0.2 * 0.2 * 0.4 * 7850 * 9.80665;
  const pushN = (W * 0.1) / 0.4; // exactly the tipping push at the top
  const get = run(block({ base: "B", tiltRequired: { value: "20 deg", source: "test" }, pushes: [{ name: "shove", at: [0, 0, "400 mm"], force: [pushN * 0.9, 0, 0] }] }), edges);
  const e = get("stability.tipping", "A");
  near(e.outputs.tipAngle.value, (Math.atan2(0.1, 0.2) * 180) / Math.PI, 1e-9, "tip angle");
  assert.equal(e.status, "PASS");
  near(e.margins.find((m) => /shove/.test(m.check)).demand, 0.9, 1e-9, "push ratio");
  const tips = run(block({ base: "B", pushes: [{ name: "shove", at: [0, 0, "400 mm"], force: [pushN * 1.1, 0, 0] }] }), edges)("stability.tipping", "A");
  assert.equal(tips.status, "FAIL");
});

test("tipping: a lamp's real parts move its CG; reaching the arm out lowers the tip angle", () => {
  const lamp = (armX) => [
    { id: "L", kind: "Assembly", name: "lamp", props: { tipping: { base: "BASE", masses: [{ name: "shade", mass: "600 g", at: [armX, 0, "450 mm"] }] } } },
    { id: "BASE", kind: "Part", name: "base", material: "steel-a36", position: { x: 0, y: 0, z: "4 mm" }, geometry: { shape: "plate", length: "180 mm", width: "180 mm", thickness: "8 mm" } },
    { id: "POST", kind: "Part", name: "post", material: "aluminum-6061-t6", position: { x: 0, y: 0, z: "233 mm" }, props: { axis: "z" }, geometry: { shape: "round-tube", length: "450 mm", outerDiameter: "12 mm", wall: "1 mm" } },
  ];
  const edges = [{ from: "L", to: "BASE", type: "CONTAINS" }, { from: "L", to: "POST", type: "CONTAINS" }];
  const near0 = run(lamp("0 mm"), edges)("stability.tipping", "L").outputs.tipAngle.value;
  const out = run(lamp("300 mm"), edges)("stability.tipping", "L").outputs;
  // hand: base 2.035 kg at z 4 mm, post (π/4)(12²−10²)·450 mm³ × 2.7 g/cm³ at 233 mm, shade 0.6 kg at (0.3, 0, 0.45)
  const mb = 0.18 * 0.18 * 0.008 * 7850, mp = (Math.PI / 4) * (0.012 ** 2 - 0.010 ** 2) * 0.45 * 2700, ms = 0.6;
  const M = mb + mp + ms, x = (ms * 0.3) / M, z = (mb * 0.004 + mp * 0.233 + ms * 0.45) / M;
  near(out.cg.value[0], x, 1e-9, "cg x");
  near(out.cg.value[2], z, 1e-9, "cg z");
  assert.ok(out.tipAngle.value < near0, "reaching out makes it easier to tip");
  near(out.tipAngle.value, (Math.atan2(0.09 - x, z) * 180) / Math.PI, 1e-9, "tip angle toward the arm");
  assert.equal(convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]).length, 4);
});

test("a hot drink cools: lid slows it, a thicker or less conductive wall keeps the outside cooler; missing data refused", () => {
  const mug = (cooling, wall = "4 mm") => [{ id: "M", kind: "Part", name: "mug", material: "stoneware", geometry: { shape: "revolve", outline: [[0, 0], ["40 mm", 0], ["40 mm", "100 mm"]], wall }, props: { cooling } }];
  const mats = { stoneware: { density: { value: "2.3 g/cm3", source: "CRC" }, conductivity: { value: "1.5 W/(m·K)", source: "Incropera Table A.3 (stoneware clay)" } } };
  const base = {
    startTemperature: "90 °C", targetTemperature: "60 °C", fill: 0.9,
    liquid: { density: { value: "965 kg/m3", source: "water at 90 °C, Incropera Table A.6" }, specificHeat: { value: "4.21 kJ/(kg·K)", source: "Incropera Table A.6" } },
    ambient: { temperature: "22 °C", conductivity: { value: "0.0282 W/(m·K)", source: "air at 330 K, Incropera Table A.4" }, kinematicViscosity: { value: "1.89e-5 m^2/s", source: "Incropera Table A.4" }, prandtl: { value: 0.703, source: "Incropera Table A.4" } },
    emissivity: { value: 0.9, source: "glazed ceramic, Incropera Table A.11" },
    maxOuterTemperature: { value: "70 °C", source: "the person" },
  };
  const open = run(mug(base), [], mats)("thermal.vessel-cooling", "M");
  assert.notEqual(open.status, "NOT_COMPUTED", open.reason);
  const t = open.outputs.timeToTarget.value;
  assert.ok(t > 15 * 60 && t < 90 * 60, `90 → 60 °C in ${t / 60} min (no evaporation)`);
  assert.match(open.warnings.join(" "), /evaporation/);
  const lid = run(mug({ ...base, lid: true }), [], mats)("thermal.vessel-cooling", "M");
  assert.ok(lid.outputs.timeToTarget.value > t, "a lid slows it");
  const thick = run(mug(base, "8 mm"), [], mats)("thermal.vessel-cooling", "M");
  assert.ok(thick.outputs.startOuterTemperature.value < open.outputs.startOuterTemperature.value, "a thicker wall is cooler outside");
  // energy balance: the first step's cooling rate is the heat loss over m·c
  assert.ok(open.outputs.startHeatLoss.value > 0);
  const miss = run(mug({ ...base, emissivity: undefined }), [], mats)("thermal.vessel-cooling", "M");
  assert.equal(miss.status, "NOT_COMPUTED");
  assert.match(miss.reason, /emissivity/);
});

test("the conditions are editable: flying slower drops the lift by the square of the speed", async () => {
  const { listParameters, applyEdits } = await import("../lib/conkay/build/edit.js");
  const { FAMILIES } = await import("../lib/conkay/build/catalogue.js");
  const ir = { design: { id: "w", name: "w" }, loadCases: [], requirements: [], edges: [], ...JSON.parse(JSON.stringify(FAMILIES.find((f) => f.id === "wing").example)) };
  const sp = listParameters(ir).find((p) => p.label === "flight speed");
  assert.equal(sp.value, "35 m/s");
  const lift = (x) => openDesign(x).session.results().find((e) => e.solver.id === "aero.lifting-line").outputs.lift.value;
  const before = lift(ir);
  const ed = applyEdits(ir, [{ id: sp.id, value: "50 mph" }]);
  assert.equal(ed.ok, true, JSON.stringify(ed.errors));
  near(lift(ed.ir), before * (22.352 / 35) ** 2, 1e-9, "L ∝ V²");
  assert.equal(applyEdits(ir, [{ id: sp.id, value: "5 kg" }]).ok, false);
  const stab = { design: { id: "s", name: "s" }, loadCases: [], requirements: [], ...JSON.parse(JSON.stringify(FAMILIES.find((f) => f.id === "stability").example)) };
  assert.ok(listParameters(stab).some((p) => p.label === "shade (mass)" && p.value === "600 g"));
});
