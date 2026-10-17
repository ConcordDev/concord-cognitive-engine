// server/tests/conkay-ev-car.test.js
//
// The electric car (Dutch 2026-10-15: the canonical ConKay car is an EV
// skateboard). Each value is pinned to its source:
//   - the Cascadia iM-225 / iM-375 motor modules: data sheets hashed in
//     components/library.json;
//   - the Molicel P45B cell: data sheet hashed in powertrain/ev-pack.js;
//   - pack electrical figures: series/parallel arithmetic (V = S × cell V,
//     R = S × R_dc / P, loss = (P / V)² R);
//   - direct-drive speed limit: v = rpm / 60 / final drive × 2π r;
//   - square packing: floor(inner / pitch) per axis.
// Then the compiler: the EV path selects the motor and pack, derives the
// package from the feet and the drive unit, places the pack in the tunnel,
// and repairs the motor when the top-speed requirement fails on power.
// A passing test here is not a physical validation of the car.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getComponent, validateEntry } from "../lib/conkay/components/index.js";
import { CELL_P45B, PACK_DESIGN_CHOICES, packElectrical, cellsInBox, placePack, enclosureMassKg } from "../lib/conkay/powertrain/ev-pack.js";
import { deriveEvFront } from "../lib/conkay/compiler/car-layout.js";
import { LAYOUT_DESIGN_CHOICES, EV_LAYOUT_CHOICES } from "../lib/conkay/compiler/car-layout.js";
import { buildCarFromLibrary, carAcceptance } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { FRONT_ENGINE_LANDMARKS, tubPositions, tubEnvelopeFit, tubLandmarks, TUB_DESIGN_CHOICES, TUB_FIREWALL_OFFSET_M } from "../lib/conkay/structural/car-tub.js";
import { ELECTRIC_BODY_CHOICES, CAD_BODY_DEFAULTS } from "../lib/conkay/cad/body-params.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const EV = { config: { fuelType: "electric" }, cadBody: false };

describe("Cascadia motor modules (library entries)", () => {
  for (const [id, peak, cont] of [["motor.cascadia.im-225-dz", null, null], ["motor.cascadia.im-375-dz", 400e3, 175e3]]) {
    it(`${id}: valid entry, hashed data sheet, 12,000 rpm`, () => {
      const m = getComponent(id);
      assert.ok(m, id);
      assert.deepEqual(validateEntry(m).errors || [], []);
      assert.match(m.mass.massState.source.sha256, /^[0-9a-f]{64}$/);
      assert.equal(m.ratings.maxSpeedRpm.value, 12000);
      if (peak) { assert.equal(m.ratings.peakPowerW.value, peak); assert.equal(m.ratings.continuousPowerW.value, cont); }
      assert.equal(m.dimensions.widthM ?? null, null, "width is not published: stays unknown");
    });
  }
  it("the iM-375's 850 V limit is above the 192S pack at full charge", () => {
    assert.ok(getComponent("motor.cascadia.im-375-dz").ratings.maxDcVoltageV.value >= 192 * CELL_P45B.maxV);
  });
});

describe("traction pack arithmetic (powertrain/ev-pack.js)", () => {
  const p = packElectrical({ series: 192, parallel: 10 });
  it("192S10P of P45B: voltages, current, resistance, energy", () => {
    near(p.voltage.maxV, 806.4, 1e-12, "full charge");
    near(p.voltage.nominalV, 691.2, 1e-12, "nominal");
    near(p.voltage.minV, 480, 1e-12, "discharge limit");
    assert.equal(p.continuousCurrentA, 450);
    near(p.dcResistanceOhm, 0.288, 1e-12, "S × 15 mΩ / P");
    near(p.energyWh.typical, 1920 * 16.2, 1e-12, "typical energy");
    near(p.continuousPowerW.atMinV, 216000, 1e-12, "450 A × 480 V");
  });
  it("conduction loss at the iM-375's 175 kW continuous: (175000 / 691.2)² × 0.288", () => {
    near(p.lossAtW(175000), (175000 / 691.2) ** 2 * 0.288, 1e-12, "I² R");
    near(p.lossAtW(175000), 18461, 1e-3, "≈ 18.5 kW");
  });
  it("rejects non-integer series/parallel", () => {
    assert.throws(() => packElectrical({ series: 1.5, parallel: 10 }));
  });
  it("square packing: a 100 mm cube holds 3 × 3 × 1 cells; a box under the clearances holds none", () => {
    // inner = 0.1 - 2 × (0.01 + 0.002) = 0.076; pitch 0.02255 → 3; length 0.07115 → 1
    assert.equal(cellsInBox({ lx: 0.1, ly: 0.1, lz: 0.1 }).count, 9);
    assert.equal(cellsInBox({ lx: 0.02, ly: 0.5, lz: 0.5 }).count, 0);
  });
  it("placePack fills the volumes in order and reports a shortfall", () => {
    const v = [{ id: "A", center: [0, 0, 0], size: [0.1, 0.1, 0.1] }, { id: "B", center: [1, 0, 0], size: [0.1, 0.1, 0.1] }];
    const all = placePack(12, v);
    assert.deepEqual(all.blocks.map((b) => [b.id, b.cells]), [["A", 9], ["B", 3]]);
    assert.equal(all.short, 0);
    const over = placePack(30, v);
    assert.equal(over.placed, 18);
    assert.equal(over.short, 12);
  });
  it("enclosure mass = box surface × sheet × 6061 density", () => {
    near(enclosureMassKg([{ size: [1, 1, 1] }]), 6 * PACK_DESIGN_CHOICES.enclosureSheetM.value * 2700, 1e-12, "1 m cube");
  });
});

describe("EV front package: the feet clear the steering sweep and the wheel wells", () => {
  const keys = ["F5", "F95", "M95"];
  const tyre = { diameterM: 0.6528, widthM: 0.275 };
  const base = { choices: { ...LAYOUT_DESIGN_CHOICES, ...EV_LAYOUT_CHOICES }, keys, frontAxleX: 1.0, track: 1.6, tyre, lockDeg: 35 };
  it("a skin-offset clearance to the wheel wells moves the heel point aft, never forward", () => {
    const a = deriveEvFront(base), b = deriveEvFront({ ...base, body: { archClearanceM: 0.03, skinOffsetM: 0.04 } });
    assert.ok(!a.error && !b.error, a.error || b.error);
    assert.ok(Number.isFinite(a.ahpX) && Number.isFinite(b.ahpX) && Number.isFinite(b.firewallX));
    assert.ok(b.ahpX >= a.ahpX, `${b.ahpX} vs ${a.ahpX}`);
    assert.match(b.method, /wheel wells/);
  });
  it("the tub's sill front stays the sweep clearance behind the steering sweep where it overlaps it across the car", () => {
    const structure = { sillFrontFromFirewallM: TUB_FIREWALL_OFFSET_M - TUB_DESIGN_CHOICES.firewallDepth.value / 2, sillYM: [0.66, 0.75], gridM: 0.005 };
    const r = deriveEvFront({ ...base, structure });
    assert.ok(r.sill, "the sill overlaps the sweep across the car");
    // the sweep's rear end: max over the lock of r cos(a) + w/2 sin(a)
    let ext = 0;
    for (let i = 0; i <= 90; i++) { const a = ((35 * Math.PI) / 180) * (i / 90); ext = Math.max(ext, tyre.diameterM / 2 * Math.cos(a) + tyre.widthM / 2 * Math.sin(a)); }
    assert.ok(r.firewallX + structure.sillFrontFromFirewallM >= 1.0 + ext + 0.025 - 1e-4, `${r.firewallX}`);
    const away = deriveEvFront({ ...base, structure: { ...structure, sillYM: [0.1, 0.2] } });
    assert.equal(away.sill, null, "a sill inboard of the sweep adds no constraint");
  });
});

describe("gasoline car tub positions are unchanged by the landmark-relative tub", () => {
  it("front-engine landmarks reproduce the tub's fixed stations on the 5 mm grid", () => {
    const t = tubPositions(FRONT_ENGINE_LANDMARKS);
    for (const [k, v] of Object.entries(t)) if (typeof v === "number") near(Math.round(v / 0.005) * 0.005, v, 1e-9, `${k} on the grid`);
  });
});

describe("compiler: the EV path", () => {
  const b = buildCarFromLibrary(BRIEF, EV);
  const node = (id) => b.ir.nodes.find((n) => n.id === id);
  it("direct drive into the Super 8.8, no gearbox, wiring or fuel cell", () => {
    const v = b.ir.nodes.find((n) => n.props?.vehicle).props.vehicle;
    assert.deepEqual(v.gearRatios, [1]);
    assert.equal(v.finalDrive, 3.55);
    assert.equal(b.configuration.config.transmissionType, "none");
    assert.equal(b.selection.transmission?.chosen ?? null, null);
  });
  it("the pack's cells are sourced mass (1920 × 70 g) and all placed in the tunnel", () => {
    const c = node("BATTERY_CELLS");
    assert.equal(c.props.massState.state, "sourced");
    near(parseFloat(c.props.mass), 1920 * 0.07, 1e-9, "cell mass");
    assert.equal(c.props.battery.placement.short, 0);
    assert.equal(c.props.battery.placement.blocks.reduce((s, x) => s + x.cells, 0), 1920);
    assert.ok(node("BATTERY_ENCLOSURE"), "enclosure (computed shell)");
  });
  it("the pack starts behind the tub's firewall sheet", () => {
    const L = tubLandmarks(b.ir), t = tubPositions(L);
    const front = b.ir.nodes.find((n) => n.props?.vehicle).props.vehicle.packaging.components.find((c) => c.id === "BATTERY_CELLS");
    const x0 = parseFloat(node("BATTERY_CELLS").position.x) - front.half[0];
    assert.ok(x0 >= t.firewallX + TUB_DESIGN_CHOICES.firewallDepth.value / 2 + TUB_DESIGN_CHOICES.sheet.value, `${x0}`);
  });
  it("no tub part cuts into a packaging envelope (the electric seat cross is split at the tunnel)", () => {
    assert.deepEqual(tubEnvelopeFit(b.ir).filter((x) => x.minClearanceM < 0), []);
    assert.ok(node("TUB_SEAT_CROSS_L") && node("TUB_SEAT_CROSS_R") && !node("TUB_SEAT_CROSS"));
    const gas = buildCarFromLibrary(BRIEF, { cadBody: false });
    assert.ok(gas.ir.nodes.some((n) => n.id === "TUB_SEAT_CROSS"), "the front-engine tub keeps its one-piece cross");
    assert.deepEqual(tubEnvelopeFit(gas.ir).filter((x) => x.minClearanceM < 0), []);
    assert.equal(gas.layoutRepairs, undefined, "the front-engine car needs no rear seat repair");
  });
  it("the electric body takes the longer tail, with its evidence", () => {
    assert.equal(ELECTRIC_BODY_CHOICES.tailExtensionM.value, 0.6);
    assert.match(ELECTRIC_BODY_CHOICES.tailExtensionM.basis, /12\.5 deg/);
    const withBody = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric" } });
    assert.equal(withBody.ir.nodes.find((n) => n.id === "BODY_SHELL").geometry.tailExtension, "600 mm");
    assert.notEqual(CAD_BODY_DEFAULTS.tailExtensionM, 0.6, "the default body is unchanged");
  });
});

describe("compiler: the B-post repair moves the rear seats inboard", () => {
  it("records the overlap and the new spacing; the posts then clear", () => {
    // rearSeating "full" = every checked occupant (incl. the 95th male) sits in the rear. The electric car is now a 2+2
    // (conkay-car-2plus2.test.js): its F5 rear occupants are narrower, so no repair is needed (asserted below).
    const b = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric" }, rearSeating: "full" });
    const [rep] = b.layoutRepairs || [];
    assert.ok(rep, "a repair ran");
    assert.equal(rep.variable, "rearSeatY");
    assert.ok(rep.after < rep.before);
    assert.match(rep.reason, /TUB_B_POST_.* cuts .* mm into SEAT_[34]/);
    assert.ok(!tubEnvelopeFit(b.ir).some((x) => /^TUB_B_POST_/.test(x.part) && x.minClearanceM < 0));
  });
  it("the 2+2 electric car needs no such repair: its F5 rear occupants clear the posts", () => {
    const b = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric" } });
    assert.equal(b.layoutRepairs, undefined);
    assert.ok(!tubEnvelopeFit(b.ir).some((x) => /^TUB_B_POST_/.test(x.part) && x.minClearanceM < 0));
  });
});

describe("acceptance: the speed rule, the motor repair and the pack against the motor", () => {
  const r = carAcceptance(BRIEF, EV);
  const rep = r.report;
  it("gear limit = 12,000 rpm / 60 / 3.55 × 2π r", () => {
    // the chosen tyre's own radius (20 in on the electric car since the stance pass: 275/35ZR20, 0.70104 m)
    const r_ = getComponent(rep.components.find((c) => c.node === "TIRE_FL").componentId).dimensions.overallDiameterM / 2;
    assert.equal(r_, 0.70104 / 2);
    const mph = ((12000 / 60 / 3.55) * 2 * Math.PI * r_) / 0.44704;
    near(rep.topSpeed.gearLimitedMph, mph, 2e-3, "direct-drive limit");
  });
  it("the iM-225 fails 180 mph on power; the repair moves to the iM-375 and records the reason", () => {
    assert.equal(rep.selection.engine_or_motor.chosen, "motor.cascadia.im-375-dz");
    const [step] = rep.repairs;
    assert.equal(step.variable, "motor");
    assert.equal(step.before, "motor.cascadia.im-225-dz");
    assert.equal(step.after, "motor.cascadia.im-375-dz");
    assert.match(step.reason, /power-limited/);
    assert.ok(["requirement met", "still failing"].includes(step.result));
  });
  it("motorRepair: false keeps the lightest motor", () => {
    const r0 = carAcceptance(BRIEF, { ...EV, motorRepair: false });
    assert.equal(r0.report.selection.engine_or_motor.chosen, "motor.cascadia.im-225-dz");
    assert.equal(r0.report.repairs, undefined);
  });
  it("a FAIL of a physical check (here the traction battery) fails the car, not only a caveat", () => {
    const b = buildCarFromLibrary(BRIEF, { ...EV, config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" } });
    b.ir.nodes.find((n) => n.id === "BATTERY_CELLS").props.battery.series = 300; // 1260 V at full charge, over the iM-375's 850 V
    const { session } = openDesign(b.ir);
    assert.equal(session.result("vehicle.traction-battery@VEH").status, "FAIL");
    const acc = session.result("vehicle.acceptance@VEH");
    assert.equal(acc.status, "FAIL");
    assert.ok(acc.failures.some((f) => /^traction battery fails \(vehicle\.traction-battery@VEH\): .*maximum DC voltage/.test(f)), JSON.stringify(acc.failures));
  });
  it("vehicle.traction-battery: voltage and continuous-power margins, pack heat is a WARN (no cooling designed)", () => {
    const tb = r.session.result("vehicle.traction-battery@VEH");
    assert.equal(tb.status, "WARN");
    const [volt, cont] = tb.margins;
    near(volt.demand, 806.4, 1e-9, "full-charge voltage");
    assert.equal(volt.capacity, 850);
    assert.equal(cont.demand, 175000);
    assert.equal(cont.capacity, 216000);
    assert.ok(tb.warnings.some((w) => /no pack cooling/.test(w)));
    assert.ok(tb.outputs.range.value.every((row) => row.rangeKm.low <= row.rangeKm.high));
  });
  it("transmission and wiring checks are not applicable to the electric car, with a reason", () => {
    const acc = r.session.result("vehicle.acceptance@VEH");
    const na = JSON.stringify(acc);
    assert.match(na, /not_applicable/);
  });
});
