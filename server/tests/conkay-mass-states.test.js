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
import { CRITICAL_VEHICLE_COMPONENTS, ACCEPTANCE_VERDICT } from "../lib/conkay/physics/solvers/vehicle-acceptance.js";
import { buildCarFromLibrary, carAcceptance, designSpeedLimiter, SPEED_LIMITER_OVERSHOOT_KMH } from "../lib/conkay/compiler/car-from-library.js";
import { GEAR_LIMIT_STATUS } from "../lib/conkay/physics/solvers/powertrain.js";
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
  it("every critical component real, tyre and requirement fine: credible with caveats (WARN), never a bare pass", () => {
    const s = open(fullVehicle({ kw: 230 }));
    const ts = s.result("vehicle.top-speed@V").outputs.topSpeed.value;
    assert.ok(ts > 180 * 0.44704 && ts < 300 / 3.6, `top speed ${ts * 3.6} km/h should sit between the requirement and the Y rating`);
    const e = s.result("vehicle.acceptance@V");
    assert.equal(e.status, "WARN", JSON.stringify(e.failures));
    assert.equal(e.outputs.verdict.value, ACCEPTANCE_VERDICT.CREDIBLE_WITH_CAVEATS);
    assert.ok(e.outputs.caveats.value.some((c) => /model output/.test(c)));
    assert.ok(e.warnings.some((w) => /^caveat: The top speed is a model output/.test(w)), "the caveats are the WARN's warnings");
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

  // Gearing on the 230 kW car (drag-limited ≈ 295 km/h): one tall gear, a
  // 0.33 m tyre and a redline that runs out first or doesn't.
  const geared = ({ redline, finalDrive = 3.0, box = null, range = null }) => {
    const ir = fullVehicle({ kw: 230 });
    Object.assign(ir.nodes[0].props.vehicle, { gearRatios: [2.0, 1.0], finalDrive, tireRadius: "0.33 m" });
    const eng = ir.nodes.find((n) => n.id === "ENGINE_OR_MOTOR");
    Object.assign(eng.props, { redlineRpm: redline, redlineBasis: "estimated: test", ...(range ? { redlineRange: range } : {}) });
    if (box) ir.nodes.find((n) => n.id === "TRANSMISSION").props.maxInputRpm = box;
    return open(ir);
  };
  const atRpm = (rpm, fd = 3.0) => (rpm * (2 * Math.PI / 60) * 0.33) / (1.0 * fd);

  it("gear-limited below the drag limit: the model's top speed is the gear limit, labelled", () => {
    const s = geared({ redline: 6000 });
    const ts = s.result("vehicle.top-speed@V").outputs;
    assert.ok(close(ts.gearLimitedTopSpeed.value, atRpm(6000)));
    assert.ok(ts.gearLimitedTopSpeed.value < ts.dragLimitedTopSpeed.value);
    assert.ok(close(ts.topSpeed.value, ts.gearLimitedTopSpeed.value));
    assert.equal(ts.limitedBy.value, "gear (rev limit in top gear)");
    assert.equal(ts.topSpeed.status, "model_output_unvalidated");
    const g = s.result("vehicle.gearing@V").outputs;
    assert.equal(g.gearLimitStatus.value, GEAR_LIMIT_STATUS.GEAR_LIMITED);
    assert.ok(close(g.effectiveTopSpeed.value, atRpm(6000)));
    // The requirement is judged on the lower value: 69 m/s is under 180 mph.
    assert.equal(s.result("requirement.check@VMAX").status, "FAIL");
    const claim = s.result("vehicle.acceptance@V").outputs.performanceClaims.value[0];
    assert.equal(claim.gearLimitStatus, "gear_limited");
    assert.ok(close(claim.value, atRpm(6000)));
  });

  it("a redline above the drag limit leaves the drag-limited speed; the transmission's rated rpm caps the redline", () => {
    const free = geared({ redline: 9000 });
    const ts = free.result("vehicle.top-speed@V").outputs;
    assert.ok(close(ts.topSpeed.value, ts.dragLimitedTopSpeed.value));
    assert.equal(ts.limitedBy.value, "drag (power-limited)");
    assert.equal(free.result("vehicle.gearing@V").outputs.gearLimitStatus.value, GEAR_LIMIT_STATUS.NOT_GEAR_LIMITED);
    const capped = geared({ redline: 9000, box: 6000 }).result("vehicle.gearing@V").outputs;
    assert.equal(capped.revLimitRpm.value, 6000);
    assert.match(capped.revLimitRpm.source, /TRANSMISSION max input speed/);
    assert.equal(capped.gearLimitStatus.value, GEAR_LIMIT_STATUS.GEAR_LIMITED);
  });

  it("an estimated redline range gives the gear limit across the range and says when the verdict depends on it", () => {
    const s = geared({ redline: 9000, range: { low: 6000, high: 9000 } });
    const g = s.result("vehicle.gearing@V");
    assert.ok(close(g.outputs.gearLimitedTopSpeedRange.value.low, atRpm(6000)));
    assert.match(g.warnings.join(), /depends on the estimated redline/);
    assert.ok(s.result("vehicle.acceptance@V").outputs.caveats.value.some((c) => /estimated redline/.test(c)));
  });
});

describe("Speed limiter: a design choice that caps the top speed", () => {
  const limited = (lim, kw = 300) => {
    const ir = fullVehicle({ kw, rating: "Y" });
    ir.nodes[0].props.vehicle.speedLimiter = lim;
    return open(ir);
  };
  it("caps the top speed; the tyre is checked against the limited speed with the limiter as the reason; the unlimited output stays", () => {
    const s = limited({ setKmh: 295, overshootAllowanceKmh: 5, basis: "test" });
    const ts = s.result("vehicle.top-speed@V").outputs;
    assert.ok(ts.unlimitedTopSpeed.value > 300 / 3.6);
    assert.ok(close(ts.topSpeed.value, 295 / 3.6));
    assert.equal(ts.limitedBy.value, "speed limiter (design choice)");
    assert.equal(ts.speedLimiter.status, "design_choice_unverified");
    assert.ok(ts.topSpeed.unverifiedDependencies.includes("speed_limiter"));
    const tyre = s.result("tire.speed-rating@V");
    assert.equal(tyre.status, "PASS");
    assert.equal(tyre.outputs.demandBasis.value, "speed limiter (design choice)");
    assert.ok(tyre.inputs.unlimitedModelTopSpeed.value > 300 / 3.6);
    assert.ok(tyre.margins.filter((m) => !m.hard).every((m) => /speed limiter/.test(m.reason)));
    assert.equal(s.result("requirement.check@VMAX").status, "PASS", "180 mph passes against the limited 295 km/h");
    const acc = s.result("vehicle.acceptance@V");
    assert.equal(acc.outputs.verdict.value, ACCEPTANCE_VERDICT.CREDIBLE_WITH_CAVEATS);
    assert.ok(acc.outputs.caveats.value.some((c) => /speed limiter that is a design choice/.test(c)));
    const claim = acc.outputs.performanceClaims.value[0];
    assert.ok(claim.unlimitedMph > claim.mph);
    assert.equal(claim.speedLimiter.binding, true);
  });
  it("a set point below the requirement fails the requirement; set point + allowance above the tyre fails the tyre", () => {
    assert.equal(limited({ setKmh: 280, overshootAllowanceKmh: 5 }).result("requirement.check@VMAX").status, "FAIL");
    const s = limited({ setKmh: 298, overshootAllowanceKmh: 5 });
    assert.equal(s.result("tire.speed-rating@V").status, "FAIL");
    assert.match(s.result("vehicle.acceptance@V").failures.join(), /overshoot allowance .* fails \(300 km\/h established vs 303 km\/h speed limiter set point \+ design overshoot allowance\)/);
  });
  it("a limiter set above the unlimited speed doesn't bind: the model output stays the demand", () => {
    const s = limited({ setKmh: 400, overshootAllowanceKmh: 5 }, 230);
    const ts = s.result("vehicle.top-speed@V").outputs;
    assert.equal(ts.speedLimiter.value.binding, false);
    assert.ok(close(ts.topSpeed.value, ts.unlimitedTopSpeed.value));
    assert.equal(s.result("tire.speed-rating@V").outputs.demandBasis.value, "model top speed (model output, unvalidated)");
    assert.match(limited({ setKmh: -1 }).result("vehicle.top-speed@V").reason, /setKmh must be a positive number/);
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

  it("covers every critical vehicle category", () => {
    const cats = new Set(loadLibrary().components.map((c) => c.category));
    for (const c of CRITICAL_VEHICLE_COMPONENTS.map((x) => x.id)) assert.ok(cats.has(c), c);
    assert.ok(loadLibrary().components.filter((c) => c.category === "engine_or_motor").length >= 2);
    const brakes = loadLibrary().components.filter((c) => c.category === "brakes");
    assert.ok(brakes.some((c) => c.applicability.axle === "front") && brakes.some((c) => c.applicability.axle === "rear"));
  });

  it("a package (shipping) weight is never a sourced mass: estimated, nominal at the package weight, with the allowance stated", () => {
    const pkg = loadLibrary().components.filter((c) => /package weight/i.test(c.mass.published) || (/package/i.test(c.mass.massState.method || "") && /upper bound/i.test(c.mass.massState.method || "")));
    assert.ok(pkg.length >= 3, pkg.map((c) => c.id).join());
    for (const c of pkg) {
      const ms = c.mass.massState;
      assert.equal(ms.state, "estimated", c.id);
      assert.match(ms.method, /package|shipping/i, c.id);
      assert.ok(close(ms.uncertainty.highKg, c.mass.kg, 1e-6), `${c.id}: nominal is the upper bound`);
    }
  });

  it("a third-party measurement says so (sourceKind), and every differential carries its final-drive options with a source", () => {
    const measured = loadLibrary().components.filter((c) => /mustang6g\.com/.test(c.mass.massState.source.url));
    assert.ok(measured.length >= 5);
    for (const c of measured) assert.match(c.mass.massState.sourceKind, /third-party scale measurement/, c.id);
    for (const d of loadLibrary().components.filter((c) => c.category === "differential")) {
      assert.ok(Number.isFinite(d.ratings.finalDrive.value), d.id);
      assert.ok(d.ratings.finalDriveOptions.values.includes(d.ratings.finalDrive.value), d.id);
      assert.ok(d.ratings.finalDriveOptions.sources.every((x) => /^https:\/\//.test(x.url) && x.retrieved), d.id);
    }
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

  it("parts are checked against each other: spindle, engine, rear suspension; an unrated capacity is listed, not assumed", () => {
    const dropSpindleKit = getComponent("brakes.wilwood.fnsl6r.140-14277");
    const s550 = { spindle: "Ford S550 Mustang front spindle (2015-2023)", boltPattern: "5x114.3", wheelDiameterIn: 18 };
    assert.deepEqual(checkApplicability(dropSpindleKit, s550).mismatches.map((m) => m.field), ["spindle"]);
    assert.equal(checkApplicability(getComponent("brakes.wilwood.aero6.140-13886"), s550).ok, true);
    const pack = getComponent("wiring.ford.control-pack.m-6017-m50d");
    assert.deepEqual(checkApplicability(pack, { engineId: "engine.ford.coyote-gen4x.m-6007-m50h", transmissionType: "manual" }).mismatches.map((m) => m.field), ["engineId"]);
    const diff = getComponent("differential.ford.super-8.8-irs.m-4001-88355b");
    assert.equal(checkApplicability(diff, { drivetrain: "RWD", rearSuspension: "solid axle" }).ok, false);
    const ok = checkApplicability(diff, { drivetrain: "RWD", rearSuspension: "Ford S550 IRS (2015-2023 Mustang)" });
    assert.equal(ok.ok, true);
    assert.ok(ok.unchecked.some((u) => u.field === "engineTorqueNm" && /not rated/.test(u.reason)));
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
    // The front seat must take the widest checked occupant's hips (seatHipBreadthM), which rules the Pole Position out.
    const b = buildCarFromLibrary(BRIEF, { cadBody: false });
    const chosen = Object.fromEntries(Object.entries(b.selection).map(([k, v]) => [k, v.chosen]));
    assert.deepEqual(chosen, {
      engine_or_motor: "engine.ford.coyote-gen4x.m-6007-m50h",
      wiring: "wiring.ford.control-pack.m-6017-m50hm",
      transmission: "transmission.tremec.tkx.tcet18085",
      differential: "differential.ford.super-8.8-irs.m-4001-88355b",
      suspension_front: "suspension.ford.s550-front.oem",
      suspension_rear: "suspension.ford.s550-irs-rear.oem",
      steering: "steering.ford.s550-epas",
      wheels: "wheel.enkei.rpf1.3798906535sp",
      tyres: "tyre.michelin.pilot-sport-4s.245-40zr18-97y-xl",
      brakes_front: "brakes.wilwood.aero6.140-13886",
      brakes_rear: "brakes.wilwood.aero4-mc4.140-13888",
      cooling: "cooling.coldcase.lmm570-5k",
      exhaust: "exhaust.s550-gt.oem-lh-manifold-midpipe.bassani-xpipe-catback",
      fuel_or_battery: "fuel.atl.saver-cell.sa-aa-070",
      seats_front: "seat.recaro.sportster-gt",
      seats_rear: "seat.ford.s550-rear.oem",
    });
    // The drop-spindle front kit no longer fits once the S550 front suspension provides the spindle.
    assert.deepEqual(b.selection.brakes_front.candidates.find((c) => c.id === "brakes.wilwood.fnsl6r.140-14277").mismatches.map((m) => m.field), ["spindle"]);
    const engine = b.ir.nodes.find((n) => n.id === "ENGINE");
    assert.equal(engine.props.massState.state, "sourced");
    assert.match(engine.props.massState.source.url, /ford\.com/);
    assert.match(engine.props.redlineBasis, /^estimated/);
    const veh = b.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    assert.equal(veh.finalDrive, 3.55);
    assert.match(veh.finalDriveSource, /M-4209-88355A/);
    // Rear seats share the measured bench: half each.
    const s3 = b.ir.nodes.find((n) => n.id === "SEAT_3");
    assert.ok(close(parseFloat(s3.props.mass), getComponent("seat.ford.s550-rear.oem").mass.kg / 2, 1e-9));
    // An exclusion another selected part supplies is not missing mass.
    assert.ok(engine.props.massCoveredElsewhere.some((x) => /M-6017-M50HM/.test(x)));
    assert.ok(!engine.props.massExcludes.some((x) => /M-6017-M50HM/.test(x)));
  });

  it("every critical component is real now; without the package layout (packaging: false) nothing fails and the pass rests on caveats", () => {
    // The occupant-fit and interference checks are in conkay-packaging.test.js; here the
    // mass, top speed, limiter and tyre are judged on their own.
    const r = carAcceptance(BRIEF, { packaging: false });
    assert.equal(r.ok, true, r.error);
    const rep = r.report;
    for (const c of rep.criticalComponents) assert.equal(c.status, "real", c.category);
    // With the speed limiter (a design choice) nothing fails; the pass rests on caveats.
    assert.equal(rep.verdict, "credible_with_caveats");
    assert.equal(rep.status, "WARN");
    assert.deepEqual(rep.failures, []);
    // Mass by state: no placeholders left; a lower bound under the 2,500 lb target.
    const mb = rep.massBreakdown;
    assert.ok(Math.abs(mb.pct.sourced + mb.pct.estimated + mb.pct.computed + mb.pct.placeholder - 100) < 0.2);
    assert.equal(mb.pct.placeholder, 0);
    assert.equal(mb.kg.placeholder, 0);
    assert.ok(mb.pct.sourced > 50 && mb.pct.estimated > 0 && mb.pct.computed > 0);
    assert.ok(mb.uncertaintyKg[0] < mb.totalKg && mb.uncertaintyKg[1] >= mb.totalKg);
    assert.equal(mb.lowerBound, true);
    assert.ok(mb.notIncluded.some((x) => /rear knuckles/.test(x)));
    assert.equal(mb.vsTarget.targetLb, 2500);
    assert.ok(mb.vsTarget.totalKg < mb.vsTarget.targetKg);
    assert.ok(mb.sourcedKgBySourceKind.thirdPartyMeasurement > 0 && mb.sourcedKgBySourceKind.manufacturerSpec > 0);
    // Top speed: capped by the limiter at 295 km/h; the unlimited speed is the
    // lower of drag- and gear-limited, still a model output.
    const t = rep.topSpeed;
    assert.equal(t.status, "model_output_unvalidated");
    assert.equal(t.kmh, 295);
    assert.equal(t.limitedBy, "speed limiter (design choice)");
    assert.equal(t.speedLimiter.setKmh, 295);
    assert.equal(t.speedLimiter.status, "design_choice_unverified");
    assert.equal(t.unlimitedStatus, "model_output_unvalidated");
    assert.ok(close(t.unlimitedMph, Math.min(t.dragLimitedMph, t.gearLimitedMph), 1e-3));
    assert.ok(t.unlimitedKmh > 300, "unlimited, the model is above the tyre's 300 km/h");
    assert.equal(t.gearLimitStatus, t.gearLimitedMph < t.dragLimitedMph ? "gear_limited" : "not_gear_limited");
    assert.equal(t.revLimit.rpm, 7500);
    assert.equal(t.finalDrive.value, 3.55);
    assert.deepEqual(t.gearLimitedMphRange.rpm, { low: 7000, high: 7500 });
    assert.equal(t.unverifiedDependencies.length, 7);
    assert.ok(t.unverifiedDependencies.some((d) => d.id === "speed_limiter"));
    assert.match(t.unverifiedDependencies.find((d) => d.id === "gearing").evidence, /final drive 3\.55/);
    // Y meets the 180 mph requirement and the limited speed; the receipt names the limiter.
    assert.equal(rep.tyreSpeed.status, "PASS");
    assert.equal(rep.tyreSpeed.demandBasis, "speed limiter (design choice)");
    assert.ok(rep.tyreSpeed.margins.filter((m) => /required/.test(m.check)).every((m) => m.pass));
    const limited = rep.tyreSpeed.margins.filter((m) => /limited top speed/.test(m.check));
    assert.equal(limited.length, 4);
    assert.ok(limited.every((m) => m.pass && m.demandKmh === 295 && /speed limiter/.test(m.reason)));
    assert.ok(rep.tyreSpeed.margins.filter((m) => /overshoot allowance/.test(m.check)).every((m) => m.pass && m.demandKmh === 300));
    assert.ok(!rep.tyreSpeed.margins.some((m) => /model top speed/.test(m.check)), "the unlimited model output is not the tyre's demand while the limiter caps it");
    assert.ok(rep.requirements.every((r) => r.status === "PASS"));
    // Options, without changing the physics: no available final drive keeps the gear limit within 300 km/h.
    const gearOpt = rep.tyreOptions.options.find((o) => /final drive/.test(o.option));
    assert.deepEqual(gearOpt.perRatio.map((x) => x.finalDrive), [3.31, 3.55, 3.73, 4.09]);
    assert.ok(gearOpt.perRatio.every((x) => !x.withinTyre));
    assert.match(rep.tyreOptions.options[0].finding, /No published manufacturer rating above 300 km\/h/);
    assert.equal(rep.tyreOptions.highSpeedLoad.forSpeedKmh, 295);
    assert.equal(rep.tyreOptions.highSpeedLoad.atMph, 186, "the first Michelin row at or above 183.3 mph");
    assert.equal(rep.tyreOptions.highSpeedLoad.loadCapacityPct, 85);
    assert.equal(rep.tyreOptions.highSpeedLoad.pass, true);
    assert.equal(rep.tyreOptions.options.find((o) => /speed limit/.test(o.option)).applied, true);
    assert.ok(rep.caveats.some((c) => /REQ_topSpeed passes on a model output/.test(c)));
    assert.ok(rep.caveats.some((c) => /REQ_mass passes on a lower-bound mass/.test(c)));
    assert.ok(rep.caveats.some((c) => /estimated redline/.test(c)));
    // The caveats a pass rests on stay prominent.
    assert.ok(rep.caveats.some((c) => /speed limiter that is a design choice/.test(c) && /355\.\d km\/h/.test(c)));
    assert.ok(rep.caveats.some((c) => /Cd 0\.28 is unvalidated/.test(c)));
    assert.ok(rep.caveats.some((c) => /item\(s\) the parts' published masses exclude/.test(c)));
    assert.ok(rep.caveats.some((c) => /Occupant fit and packaging are not checked/.test(c)), "no layout is a caveat, not a silent pass");
    for (const c of rep.components) assert.match(c.source, /^https:\/\//, c.node);
  });

  it("without the speed limiter the same car fails on the tyre against the unlimited model output (the physics is unchanged)", () => {
    const rep = carAcceptance(BRIEF, { speedLimiter: false, packaging: false }).report;
    assert.equal(rep.verdict, "not_physically_credible");
    assert.equal(rep.failures.length, 4);
    for (const f of rep.failures) assert.match(f, /TIRE_(FL|FR|RL|RR) established speed ≥ model top speed .* fails \(300 km\/h established vs \d+ km\/h model output\)/);
    assert.equal(rep.topSpeed.speedLimiter, null);
    assert.ok(close(rep.topSpeed.mph, rep.topSpeed.unlimitedMph, 1e-9));
    assert.equal(rep.tyreOptions.options.find((o) => /speed limit/.test(o.option)).applied, false);
  });

  it("the limiter set point is derived, not picked: tyre established speed − overshoot allowance, at or above the requirement", () => {
    const d = designSpeedLimiter({ requiredKmh: 180 * 1.609344, tyreEstablishedKmh: 300 });
    assert.equal(d.setKmh, 295);
    assert.equal(d.overshootAllowanceKmh, SPEED_LIMITER_OVERSHOOT_KMH);
    assert.match(d.basis, /5\.3 km\/h \(1\.8%\) above the required 289\.7 km\/h/);
    assert.match(d.sources[0].url, /^https:\/\/www\.legislation\.gov\.uk\//);
    assert.match(designSpeedLimiter({ requiredKmh: 180 * 1.609344, tyreEstablishedKmh: 290 }).error, /no set point fits/);
  });

  it("the Realization Package carries the mass breakdown and the acceptance result", () => {
    const pkg = carAcceptance(BRIEF, { packaging: false }).session.realizationPackage().files;
    assert.ok(pkg["engineering/mass-breakdown.json"]);
    assert.ok(pkg["engineering/acceptance.json"]);
    assert.match(pkg["README.md"], /## Mass by state/);
    assert.match(pkg["README.md"], /credible_with_caveats/);
    assert.match(pkg["README.md"], /caveat: The vehicle top speed/);
    assert.match(pkg["README.md"], /limited by a speed limiter at 295 km\/h, a design choice; unlimited model output 220\.\d mph/);
    assert.match(pkg["README.md"], /model_output_unvalidated/);
  });

  it("the tyres' static loads are within load index 97", () => {
    const e = carAcceptance(BRIEF, { cadBody: false }).session.result("tire.load-index@VEH");
    assert.equal(e.status, "PASS", e.reason);
    assert.equal(e.margins.length, 4);
    assert.ok(e.margins.every((m) => close(m.capacity, 730 * 9.80665)));
  });
});
