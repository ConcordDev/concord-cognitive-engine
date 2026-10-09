// ConKay: mass states (sourced / estimated / computed / placeholder), the
// critical-placeholder acceptance gate, tyre speed rating as a hard check,
// top speed as a model output, and the first sourced component library.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { compileDesignIR } from "../lib/conkay/compiler/design-ir.js";
import { validateMassState, summarizeMassStates } from "../lib/conkay/verification/mass-state.js";
import {
  loadLibrary, validateLibrary, validateEntry, checkApplicability, selectComponent, getComponent,
  tyreSpeedCapability, loadIndexKg,
} from "../lib/conkay/components/index.js";
import { CRITICAL_VEHICLE_COMPONENTS } from "../lib/conkay/physics/solvers/vehicle-acceptance.js";
import { buildCarFromLibrary, carAcceptance } from "../lib/conkay/compiler/car-from-library.js";
import { parseBrief } from "../lib/conkay/compiler/requirement-parser.js";

const open = (ir) => {
  const o = openDesign(ir);
  assert.equal(o.ok, true, JSON.stringify(o.errors));
  return o.session;
};
const SRC = { url: "https://example.com/spec.pdf", title: "test spec sheet", retrieved: "2026-10-09" };
const sourced = (variant = "TEST-1") => ({ state: "sourced", source: SRC, variant });
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe("Mass states: required fields", () => {
  it("sourced needs a source and the exact variant", () => {
    assert.deepEqual(validateMassState(sourced()), []);
    assert.match(validateMassState({ state: "sourced", variant: "X" }).join(), /source\.url or source\.document/);
    assert.match(validateMassState({ state: "sourced", source: SRC }).join(), /exact variant/);
    assert.match(validateMassState({ state: "sourced", source: { url: "ftp://x" }, variant: "X" }).join(), /http/);
    assert.deepEqual(validateMassState({ state: "sourced", source: { document: "Datasheet rev C, p. 4" }, variant: "X" }), []);
  });

  it("estimated needs a method and a range that contains the mass", () => {
    assert.deepEqual(validateMassState({ state: "estimated", method: "scaled from a similar part", uncertainty: { lowKg: 40, highKg: 60 } }, { massKg: 50 }), []);
    assert.deepEqual(validateMassState({ state: "estimated", method: "m", uncertainty: { pct: 15 } }), []);
    assert.match(validateMassState({ state: "estimated", uncertainty: { pct: 10 } }).join(), /method/);
    assert.match(validateMassState({ state: "estimated", method: "m" }).join(), /uncertainty range/);
    assert.match(validateMassState({ state: "estimated", method: "m", uncertainty: { lowKg: 60, highKg: 40 } }).join(), /lowKg ≤ highKg/);
    assert.match(validateMassState({ state: "estimated", method: "m", uncertainty: { lowKg: 40, highKg: 45 } }, { massKg: 50 }).join(), /outside its own range/);
  });

  it("computed needs the geometry and material it came from; placeholder needs a note", () => {
    assert.match(validateMassState({ state: "computed", materialRef: "steel" }).join(), /geometryRef/);
    assert.match(validateMassState({ state: "computed", geometryRef: "P.geometry" }).join(), /materialRef/);
    assert.match(validateMassState({ state: "placeholder" }).join(), /note/);
    assert.match(validateMassState({ state: "guess" }).join(), /must be one of/);
  });

  it("the Design IR validates massState on nodes, and a stated mass cannot claim 'computed'", () => {
    const bad = (props) => compileDesignIR({ nodes: [{ id: "E", kind: "Actuator", props }] });
    assert.equal(bad({ mass: "180 kg", massState: sourced() }).ok, true);
    assert.match(bad({ mass: "180 kg", massState: { state: "sourced", variant: "X" } }).errors.join(), /source\.url/);
    assert.match(bad({ mass: "180 kg", massState: { state: "estimated", method: "m", uncertainty: { lowKg: 100, highKg: 150 } } }).errors.join(), /outside its own range/);
    assert.match(bad({ mass: "180 kg", massState: { state: "computed", geometryRef: "g", materialRef: "m" } }).errors.join(), /cannot be "computed"/);
    assert.match(bad({ massState: sourced() }).errors.join(), /needs props\.mass/);
  });

  it("mass.part labels each mass: geometry → computed (with refs), a bare stated mass → placeholder, stand-in geometry → placeholder", () => {
    const s = open({ design: { id: "x" }, nodes: [
      { id: "A", kind: "Assembly" },
      { id: "G", kind: "Part", material: "steel-a36", geometry: { shape: "box", length: "1 m", width: "1 m", height: "0.01 m" } },
      { id: "S", kind: "Part", props: { mass: "10 kg", massSource: "a catalogue somewhere" } },
      { id: "P", kind: "Part", material: "steel-a36", geometry: { shape: "box", length: "1 m", width: "1 m", height: "0.01 m" }, props: { massState: { state: "placeholder", note: "stand-in plate" } } },
    ], edges: ["G", "S", "P"].map((to) => ({ type: "CONTAINS", from: "A", to })) });
    const g = s.result("mass.part@G").outputs.massState;
    assert.equal(g.value, "computed");
    assert.match(g.detail.geometryRef, /G\.geometry \(box\)/);
    assert.match(g.detail.materialRef, /steel-a36/);
    assert.equal(s.result("mass.part@S").outputs.massState.value, "placeholder");
    assert.match(s.result("mass.part@S").outputs.massState.detail.note, /no mass state/);
    const p = s.result("mass.part@P").outputs.massState;
    assert.equal(p.value, "placeholder");
    assert.equal(p.detail.computedFrom.state, "computed");
  });
});

describe("Mass roll-up by state, with the uncertainty band", () => {
  const vehicle = () => ({
    design: { id: "v" },
    nodes: [
      { id: "V", kind: "Assembly", props: { vehicle: {} } },
      { id: "SRC", kind: "Part", props: { mass: "100 kg", massState: sourced() } },
      { id: "EST", kind: "Part", props: { mass: "50 kg", massState: { state: "estimated", method: "scaled", uncertainty: { lowKg: 40, highKg: 60 } } } },
      { id: "PCT", kind: "Part", props: { mass: "20 kg", massState: { state: "estimated", method: "scaled", uncertainty: { pct: 10 } } } },
      // 1 m × 1 m × 0.01 m A36 (7850 kg/m³) = 78.5 kg, computed.
      { id: "CMP", kind: "Part", material: "steel-a36", geometry: { shape: "box", length: "1 m", width: "1 m", height: "0.01 m" } },
      { id: "PH", kind: "Part", props: { mass: "11.5 kg", massState: { state: "placeholder", note: "not designed yet" } } },
      { id: "O", kind: "Payload", props: { mass: "77 kg", massSource: "occupant (assumption)" } },
    ],
    edges: ["SRC", "EST", "PCT", "CMP", "PH", "O"].map((to) => ({ type: "CONTAINS", from: "V", to })),
  });

  it("kg and % per state are exact, payload is excluded, and the percentages sum to 100", () => {
    const e = open(vehicle()).result("mass.breakdown@V");
    const total = 100 + 50 + 20 + 78.5 + 11.5;
    assert.ok(close(e.outputs.totalMass.value, total));
    const by = e.outputs.byState.value;
    assert.ok(close(by.sourced.kg, 100) && close(by.estimated.kg, 70) && close(by.computed.kg, 78.5) && close(by.placeholder.kg, 11.5));
    assert.ok(close(e.outputs.sourcedPct.value, (100 / total) * 100));
    assert.ok(close(e.outputs.placeholderPct.value, (11.5 / total) * 100));
    const sum = ["sourced", "estimated", "computed", "placeholder"].reduce((a, k) => a + by[k].pct, 0);
    assert.ok(close(sum, 100));
    assert.equal(by.estimated.count, 2);
    assert.equal(e.status, "WARN", "a placeholder is a warning in the roll-up (the gate is what fails)");
  });

  it("the band sums the estimated ranges (absolute and ±%); placeholders are excluded and say so", () => {
    const e = open(vehicle()).result("mass.breakdown@V");
    assert.ok(close(e.outputs.uncertaintyLow.value, 100 + 40 + 18 + 78.5 + 11.5));
    assert.ok(close(e.outputs.uncertaintyHigh.value, 100 + 60 + 22 + 78.5 + 11.5));
    assert.match(e.outputs.uncertainty.value.excludes, /1 placeholder/);
  });

  it("summarizeMassStates reports a placeholder with no mass and makes the total a lower bound", () => {
    const r = summarizeMassStates([
      { id: "a", massKg: 10, massState: sourced() },
      { id: "b", massKg: null, massState: { state: "placeholder", note: "nothing yet" } },
    ]);
    assert.equal(r.totalKg, 10);
    assert.deepEqual(r.unmassed, ["b"]);
    assert.equal(r.byState.placeholder.count, 1);
    assert.equal(r.byState.sourced.pct, 100);
  });

  it("editing a part's mass state reruns the breakdown", () => {
    const s = open(vehicle());
    const r = s.edit([{ node: "PH", path: "props.massState", value: sourced("REAL-PART") }]);
    assert.equal(r.ok, true, r.error);
    assert.ok(r.rerun.includes("mass.breakdown@V"));
    assert.equal(s.result("mass.breakdown@V").outputs.placeholderPct.value, 0);
  });
});

// A vehicle with every critical component present and sourced, a Y tyre and
// a 180 mph requirement it can meet: everything passes. Then one component
// becomes a placeholder and the gate fails, listing it.
function fullVehicle({ placeholder = null, rating = "Y", fuelType = "electric", ratingProps = {}, kw = 120 } = {}) {
  const cats = CRITICAL_VEHICLE_COMPONENTS.map((c) => c.id).filter((c) => !(c === "exhaust" && fuelType === "electric"));
  const nodes = [{ id: "V", kind: "Assembly", props: { vehicle: { fuelType, dragCoefficient: 0.3, frontalArea: "2 m2", rollingResistance: 0.012, drivelineEfficiency: 0.9, frontAxleX: "1 m", rearAxleX: "3.6 m" } } }];
  for (const c of cats) {
    const id = c.toUpperCase();
    const isPh = c === placeholder;
    nodes.push({
      id, kind: c === "engine_or_motor" ? "Actuator" : c === "tyres" ? "Tire" : "Part",
      position: { x: "2.3 m", y: "0 m", z: "0.4 m" },
      props: {
        critical: c, mass: "40 kg",
        massState: isPh ? { state: "placeholder", note: "not chosen yet" } : sourced(`${c}-variant`),
        ...(c === "engine_or_motor" ? { maxPower: `${kw} kW` } : {}),
        ...(c === "tyres" ? { speedRating: rating, ...ratingProps } : {}),
      },
    });
  }
  return {
    design: { id: "full" },
    nodes,
    edges: nodes.slice(1).map((n) => ({ type: "CONTAINS", from: "V", to: n.id })),
    requirements: [{ id: "VMAX", label: "180 mph", of: { solver: "vehicle.top-speed", target: "V", output: "topSpeed" }, min: "180 mph" }],
  };
}

describe("Acceptance gate: a critical placeholder means not physically credible", () => {
  it("every critical component real, tyre and requirement fine: the gate passes (claims still unvalidated)", () => {
    const s = open(fullVehicle({ kw: 230 }));
    const ts = s.result("vehicle.top-speed@V").outputs.topSpeed.value;
    assert.ok(ts > 180 * 0.44704 && ts < 300 / 3.6, `top speed ${ts * 3.6} km/h should sit between the requirement and the Y rating`);
    const e = s.result("vehicle.acceptance@V");
    assert.equal(e.status, "PASS", JSON.stringify(e.failures));
    assert.equal(e.outputs.verdict.value, "screening_pass_claims_unvalidated");
    assert.ok(e.outputs.caveats.value.some((c) => /model output/.test(c)));
    assert.equal(e.outputs.criticalComponents.value.find((c) => c.category === "exhaust").status, "not_applicable");
  });

  it("one critical placeholder fails the gate even though every other check passes, and names it", () => {
    const s = open(fullVehicle({ kw: 230, placeholder: "steering" }));
    assert.equal(s.result("tire.speed-rating@V").status, "PASS");
    assert.equal(s.result("requirement.check@VMAX").status, "PASS");
    const e = s.result("vehicle.acceptance@V");
    assert.equal(e.status, "FAIL");
    assert.equal(e.outputs.verdict.value, "not_physically_credible");
    assert.equal(e.failures.length, 1);
    assert.match(e.failures[0], /not physically credible: .*steering \(STEERING\)/);
    assert.deepEqual(e.outputs.placeholders.value, ["steering"]);
  });

  it("a missing critical category (no node at all) fails too; exhaust applies to a combustion engine", () => {
    const ir = fullVehicle({ kw: 230, fuelType: "gasoline" });
    ir.nodes = ir.nodes.filter((n) => n.id !== "EXHAUST");
    ir.edges = ir.edges.filter((x) => x.to !== "EXHAUST");
    const e = open(ir).result("vehicle.acceptance@V");
    assert.equal(e.status, "FAIL");
    assert.match(e.failures[0], /exhaust \(missing\)/);
  });

  it("a front-only brake part leaves the rear axle as a placeholder", () => {
    const ir = fullVehicle({ kw: 230 });
    ir.nodes.find((n) => n.id === "BRAKES").props.axle = "front";
    const e = open(ir).result("vehicle.acceptance@V");
    assert.equal(e.status, "FAIL");
    assert.match(e.failures[0], /brakes \(rear axle\)/);
  });
});

describe("Tyre speed rating: hard failure below the required top speed", () => {
  it("a V tyre (240 km/h) fails a 180 mph (290 km/h) requirement, with the reason", () => {
    const s = open(fullVehicle({ kw: 230, rating: "V" }));
    const e = s.result("tire.speed-rating@V");
    assert.equal(e.status, "FAIL");
    const hard = e.margins.find((m) => m.hard);
    assert.ok(close(hard.capacity, 240 / 3.6) && close(hard.demand, 180 * 0.44704));
    assert.match(e.failures[0], /TYRES: V is established for 240 km\/h \(149 mph\), below the required 290 km\/h \(180 mph\)/);
    assert.match(s.result("vehicle.acceptance@V").failures.join(), /tyre speed rating \(hard\)/);
  });

  it("Y (300 km/h = 186 mph) meets 180 mph; the model's own top speed is checked separately", () => {
    const s = open(fullVehicle({ kw: 300, rating: "Y" }));
    const e = s.result("tire.speed-rating@V");
    const ts = s.result("vehicle.top-speed@V").outputs.topSpeed.value;
    assert.ok(ts > 300 / 3.6, "this car's model top speed is above Y");
    assert.equal(e.margins.find((m) => m.hard).utilization <= 1, true, "Y meets the requirement");
    assert.equal(e.status, "FAIL", "but not the model's top speed");
    assert.ok(!e.failures?.length, "the hard (requirement) check is not what failed");
  });

  it("(Y) counts above 300 km/h only with the manufacturer's explicit rating; ZR alone is 240", () => {
    assert.equal(tyreSpeedCapability("(Y)").kmh, 300);
    assert.match(tyreSpeedCapability("(Y)").basis, /only 300 km\/h/);
    assert.equal(tyreSpeedCapability("(Y)", { explicitMaxKmh: 330 }).kmh, 300, "a rating with no source does not count");
    assert.equal(tyreSpeedCapability("(Y)", { explicitMaxKmh: 330, explicitSource: "maker's data sheet" }).kmh, 330);
    assert.equal(tyreSpeedCapability("ZR").kmh, 240);
    assert.equal(tyreSpeedCapability("Y").kmh, 300);
    assert.equal(tyreSpeedCapability("H").kmh, 210);
    assert.match(tyreSpeedCapability("X").error, /unknown/);
    const s = open(fullVehicle({ kw: 300, rating: "(Y)", ratingProps: { tireMaxSpeedKmh: 360, tireMaxSpeedSource: "test: explicit rating" } }));
    assert.equal(s.result("tire.speed-rating@V").status, "PASS");
  });

  it("the speed and load tables are the cited reference tables", () => {
    const lib = loadLibrary();
    assert.equal(lib.references.speedSymbols.table.Y, 300);
    assert.equal(lib.references.speedSymbols.table.V, 240);
    assert.equal(loadIndexKg(97), 730);
    assert.equal(loadIndexKg(100), 800);
    for (const k of ["speedSymbols", "loadIndex"]) assert.ok(lib.references[k].sources.every((s) => /^https:\/\//.test(s.url) && s.retrieved));
  });
});

describe("Top speed is a model output", () => {
  it("vehicle.top-speed labels its result model_output_unvalidated with the unverified dependencies", () => {
    const o = open(fullVehicle({ kw: 230 })).result("vehicle.top-speed@V").outputs;
    assert.equal(o.topSpeed.status, "model_output_unvalidated");
    assert.deepEqual(o.topSpeed.unverifiedDependencies, ["drag_model", "drivetrain_losses", "gearing", "tyre_limits", "stability", "thermal"]);
    assert.equal(o.claimStatus.value, "model_output_unvalidated");
  });
});

describe("Component library", () => {
  it("validates, and every entry's mass has a source URL, title and retrieval date", () => {
    const lib = loadLibrary({ fresh: true });
    assert.deepEqual(validateLibrary(lib).errors, []);
    assert.ok(lib.components.length >= 9);
    for (const c of lib.components) {
      const ms = c.mass.massState;
      assert.ok(["sourced", "estimated"].includes(ms.state), `${c.id}: ${ms.state}`);
      assert.match(ms.source.url, /^https:\/\//, c.id);
      assert.ok(ms.source.title && /^\d{4}-\d{2}-\d{2}$/.test(ms.source.retrieved), c.id);
      if (ms.state === "sourced") assert.ok(ms.variant, `${c.id}: variant`);
      assert.ok(c.mass.published, `${c.id}: published figure kept verbatim`);
    }
  });

  it("covers the car brief's first critical parts", () => {
    const cats = new Set(loadLibrary().components.map((c) => c.category));
    for (const c of ["engine_or_motor", "transmission", "tyres", "wheels", "brakes", "fuel_or_battery"]) assert.ok(cats.has(c), c);
    assert.ok(loadLibrary().components.filter((c) => c.category === "engine_or_motor").length >= 2);
  });

  it("an entry without a source, or with an invented placeholder, is refused", () => {
    const e = structuredClone(getComponent("wheel.enkei.rpf1.3798906535sp"));
    delete e.mass.massState.source;
    assert.match(validateEntry(e).join(), /source\.url or source\.document/);
    const p = structuredClone(getComponent("wheel.enkei.rpf1.3798906535sp"));
    p.mass.massState = { state: "placeholder", note: "x" };
    assert.match(validateEntry(p).join(), /cannot be a placeholder/);
  });

  it("an internally inconsistent published mass is recorded as estimated, with the range spanning both figures", () => {
    const tkx = getComponent("transmission.tremec.tkx.tcet18085");
    assert.equal(tkx.mass.massState.state, "estimated");
    assert.ok(close(tkx.mass.massState.uncertainty.lowKg, 99 * 0.45359237, 1e-3));
    assert.equal(tkx.mass.massState.uncertainty.highKg, 50);
  });
});

describe("Applicability: a sourced part is right only for the configuration it fits", () => {
  it("flags mismatches, lists what it could not check, and never assumes", () => {
    const motor = getComponent("motor.ford.eluminator.m-9000-mache");
    const r = checkApplicability(motor, { fuelType: "gasoline" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.mismatches, [{ field: "fuelType", required: ["electric"], actual: "gasoline" }]);
    assert.deepEqual(r.needs, ["traction inverter", "high-voltage battery"]);
    const tkx = getComponent("transmission.tremec.tkx.tcet18085");
    assert.equal(checkApplicability(tkx, { engineTorqueNm: 900, enginePattern: "Ford 5.0L modular", drivetrain: "RWD" }).ok, false);
    const silent = checkApplicability(tkx, {});
    assert.equal(silent.ok, true);
    assert.ok(silent.unchecked.some((u) => u.field === "engineTorqueNm"));
  });

  it("selection skips a mismatched part; a mismatched part in a design is flagged in the breakdown and fails the gate", () => {
    const sel = selectComponent("engine_or_motor", { fuelType: "gasoline" });
    assert.notEqual(sel.chosen.id, "motor.ford.eluminator.m-9000-mache");
    assert.equal(sel.candidates.find((c) => c.id === "motor.ford.eluminator.m-9000-mache").ok, false);
    const ir = fullVehicle({ kw: 230 });
    const eng = ir.nodes.find((n) => n.id === "ENGINE_OR_MOTOR");
    eng.props.applicability = checkApplicability(getComponent("engine.ford.coyote-gen4.m-6007-m50d"), { fuelType: "electric" });
    const s = open(ir);
    assert.match(s.result("mass.breakdown@V").warnings.join(), /does not fit this configuration/);
    const acc = s.result("vehicle.acceptance@V");
    assert.equal(acc.status, "FAIL");
    assert.match(acc.failures.join(), /engine or motor: ENGINE_OR_MOTOR .* does not fit the configuration: fuelType/);
  });
});

describe("Car brief from the component library (acceptance)", () => {
  const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

  it("the BEFORE brief's 'can go 180 mph' is read as the top-speed target", () => {
    const by = Object.fromEntries(parseBrief(BRIEF).requirements.map((r) => [r.metric, r]));
    assert.ok(close(by.topSpeed.min.si, 180 * 0.44704));
  });

  it("real parts are picked by applicability and carry their sources", () => {
    const b = buildCarFromLibrary(BRIEF);
    assert.equal(b.selection.engine_or_motor.chosen, "engine.ford.coyote-gen4x.m-6007-m50h");
    assert.equal(b.selection.transmission.chosen, "transmission.tremec.tkx.tcet18085");
    assert.equal(b.selection.tyres.chosen, "tyre.michelin.pilot-sport-4s.245-40zr18-97y-xl");
    const engine = b.ir.nodes.find((n) => n.id === "ENGINE");
    assert.equal(engine.props.massState.state, "sourced");
    assert.match(engine.props.massState.source.url, /ford\.com/);
  });

  it("fails honestly as not physically credible, naming the placeholders, with mass by state and the top speed as a model output", () => {
    const r = carAcceptance(BRIEF);
    assert.equal(r.ok, true, r.error);
    const rep = r.report;
    assert.equal(rep.verdict, "not_physically_credible");
    assert.match(rep.failures[0], /not physically credible/);
    for (const c of ["differential", "steering", "cooling", "exhaust", "suspension", "wiring", "interior and seats", "rear axle"]) assert.match(rep.failures[0], new RegExp(c), c);
    for (const c of ["engine_or_motor", "transmission", "wheels", "tyres", "fuel_or_battery"]) assert.equal(rep.criticalComponents.find((x) => x.category === c).status, "real", c);
    const pct = rep.massBreakdown.pct;
    assert.ok(Math.abs(pct.sourced + pct.estimated + pct.computed + pct.placeholder - 100) < 0.2);
    assert.ok(pct.sourced > 0 && pct.placeholder > 0);
    assert.equal(rep.massBreakdown.lowerBound, true);
    assert.equal(rep.topSpeed.status, "model_output_unvalidated");
    assert.equal(rep.topSpeed.unverifiedDependencies.length, 6);
    assert.match(rep.topSpeed.unverifiedDependencies.find((d) => d.id === "gearing").evidence, /finalDrive/);
    // Y meets the 180 mph requirement but not the model's own top speed.
    assert.ok(rep.tyreSpeed.margins.filter((m) => /required/.test(m.check)).every((m) => m.pass));
    assert.ok(rep.tyreSpeed.margins.filter((m) => /model top speed/.test(m.check)).every((m) => !m.pass));
    assert.ok(rep.caveats.some((c) => /REQ_topSpeed passes on a model output/.test(c)));
    assert.ok(rep.caveats.some((c) => /REQ_mass passes on a lower-bound mass/.test(c)));
    for (const c of rep.components) assert.match(c.source, /^https:\/\//, c.node);
  });

  it("the Realization Package carries the mass breakdown and the acceptance result", () => {
    const pkg = carAcceptance(BRIEF).session.realizationPackage().files;
    assert.ok(pkg["engineering/mass-breakdown.json"]);
    assert.ok(pkg["engineering/acceptance.json"]);
    assert.match(pkg["README.md"], /## Mass by state/);
    assert.match(pkg["README.md"], /not_physically_credible/);
    assert.match(pkg["README.md"], /model_output_unvalidated/);
  });

  it("the tyres' static loads are within load index 97", () => {
    const e = carAcceptance(BRIEF).session.result("tire.load-index@VEH");
    assert.equal(e.status, "PASS", e.reason);
    assert.equal(e.margins.length, 4);
    assert.ok(e.margins.every((m) => close(m.capacity, 730 * 9.80665)));
  });
});
