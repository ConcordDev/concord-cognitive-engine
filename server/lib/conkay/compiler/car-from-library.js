// server/lib/conkay/compiler/car-from-library.js
//
// The car brief, built from real parts where the library has them. The
// brief compiles to the road-vehicle system tree (architectures.js); then
// each critical component the library covers is picked by applicability
// (lightest entry that fits the configuration) and placed in the tree with
// its published mass, mass state and source. The body and chassis keep
// their designed geometry (mass computed from geometry × density). Parts with
// only stand-in geometry are marked placeholders, and critical components
// with no library entry yet (differential, steering, cooling, exhaust, rear
// brakes) are left out, so the acceptance gate fails and says what's missing.
// That is the honest state of this design, not a defect.

import { compileBrief } from "./architectures.js";
import { openDesign } from "../index.js";
import { selectComponent, massStateOf, checkApplicability, getComponent } from "../components/index.js";

const OCCUPANT_KG = 77; // matches the architecture's occupant payload (assumption)
const metres = (n) => `${n} m`;

/** The configuration components are checked against, with where each value comes from. */
export function vehicleConfiguration(parsed, overrides = {}) {
  const req = Object.fromEntries((parsed.requirements || []).map((r) => [r.metric, r]));
  const massMax = req.mass?.max?.si ?? null;
  const vReq = req.topSpeed?.min?.si ?? null;
  const seats = req.seats?.min?.si ?? null;
  const config = {
    fuelType: "gasoline",
    drivetrain: "RWD",
    boltPattern: "5x114.3",
    wheelDiameterIn: 18,
    vehicleMassKg: massMax,
    requiredTopSpeedKmh: Number.isFinite(vReq) ? vReq * 3.6 : null,
    loadPerTyreKg: Number.isFinite(massMax) && Number.isFinite(seats) ? (massMax + seats * OCCUPANT_KG) / 4 : null,
    provides: [],
    ...overrides,
  };
  const sources = {
    fuelType: overrides.fuelType ? "given" : "design choice: the brief does not name an energy source",
    drivetrain: overrides.drivetrain ? "given" : "design choice (rear-wheel drive)",
    boltPattern: overrides.boltPattern ? "given" : "design choice (5x114.3 hub pattern)",
    wheelDiameterIn: overrides.wheelDiameterIn ? "given" : "design choice (18 in wheels)",
    vehicleMassKg: "brief: mass target (max)",
    requiredTopSpeedKmh: "brief: top-speed target (min)",
    loadPerTyreKg: `(mass target + ${seats ?? "?"} occupants × ${OCCUPANT_KG} kg) / 4, static, even split (screening)`,
  };
  return { config, sources };
}

function pick(category, config, selection, extra) {
  const r = selectComponent(category, config, { extra });
  selection[category] = { chosen: r.chosen?.id || null, candidates: r.candidates };
  return r.chosen;
}

const at = (x, z, y = 0) => ({ x: metres(x), y: metres(y), z: metres(z) });

function libraryNode(entry, { id, kind, critical, config, position, props = {} }) {
  return {
    id, kind, name: `${entry.manufacturer} ${entry.model} (${entry.variant})`,
    position,
    props: {
      critical,
      component: entry.id,
      mass: `${entry.mass.kg} kg`,
      massState: massStateOf(entry),
      applicability: checkApplicability(entry, config),
      ...props,
    },
  };
}

/**
 * Compile the brief, pick library components and return { ir, configuration,
 * selection } or { error }.
 */
export function buildCarFromLibrary(brief, { config: overrides } = {}) {
  const c = compileBrief(brief);
  if (c.error) return { error: c.error };
  if (c.architecture !== "road-vehicle") return { error: `no component flow for a ${c.architecture} yet` };
  const { config, sources } = vehicleConfiguration(c.parsed, overrides);
  const selection = {};
  const ir = c.ir;
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const edges = ir.edges;
  const add = (parent, node) => { ir.nodes.push(node); byId.set(node.id, node); edges.push({ type: "CONTAINS", from: parent, to: node.id }); };
  const replace = (node) => { const i = ir.nodes.findIndex((n) => n.id === node.id); ir.nodes[i] = node; byId.set(node.id, node); };

  // Engine or motor.
  const engine = pick("engine_or_motor", config, selection);
  if (engine) {
    config.engineTorqueNm = engine.ratings.peakTorqueNm?.value ?? null;
    config.enginePattern = engine.applicability.transmissionPattern ?? null;
    config.engineMaxRpm = engine.ratings.redlineRpm?.value ?? engine.ratings.maxSpeedRpm?.value ?? null;
    replace(libraryNode(engine, {
      id: "ENGINE", kind: "Actuator", critical: "engine_or_motor", config, position: at(3.3, 0.5),
      props: {
        maxPower: `${engine.ratings.peakPowerW.value} W`,
        maxPowerSource: `${engine.ratings.peakPowerW.published} (${engine.mass.massState.source.title})`,
        ...(Number.isFinite(engine.ratings.peakPowerW.rpm) ? { peakPowerRpm: engine.ratings.peakPowerW.rpm } : {}),
        ...(Number.isFinite(engine.ratings.redlineRpm?.value) ? { redlineRpm: engine.ratings.redlineRpm.value } : {}),
      },
    }));
  }
  // Transmission (must take the engine's torque and bolt to its pattern).
  const gearbox = pick("transmission", config, selection);
  if (gearbox) add("DRIVELINE", libraryNode(gearbox, { id: "TRANSMISSION", kind: "Part", critical: "transmission", config, position: at(3.7, 0.35) }));
  // Wheels, then tyres that fit them.
  const wheel = pick("wheels", config, selection);
  if (wheel) {
    config.wheelWidthIn = wheel.dimensions.widthIn;
    for (const [p, x] of [["FL", 1.0], ["FR", 1.0], ["RL", 3.7], ["RR", 3.7]]) {
      add("WHEELS", libraryNode(wheel, { id: `WHEEL_${p}`, kind: "Part", critical: "wheels", config, position: at(x, 0.33, p.endsWith("L") ? -0.8 : 0.8) }));
    }
  }
  const tyre = pick("tyres", config, selection);
  if (tyre) {
    for (const [p, x] of [["FL", 1.0], ["FR", 1.0], ["RL", 3.7], ["RR", 3.7]]) {
      replace(libraryNode(tyre, {
        id: `TIRE_${p}`, kind: "Tire", critical: "tyres", config, position: at(x, 0.33, p.endsWith("L") ? -0.8 : 0.8),
        props: { speedRating: tyre.ratings.speedSymbol, loadIndex: tyre.ratings.loadIndex },
      }));
    }
  }
  // Brakes: the library has a front kit only; the rear axle stays missing.
  const brakes = pick("brakes", config, selection);
  if (brakes) add("BRAKES", libraryNode(brakes, { id: "BRAKES_FRONT", kind: "Part", critical: "brakes", config, position: at(1.0, 0.33), props: { axle: brakes.applicability.axle || "both" } }));
  // Fuel system.
  const fuel = pick("fuel_or_battery", config, selection);
  if (fuel) add("POWERTRAIN", libraryNode(fuel, { id: "FUEL_CELL", kind: "Part", critical: "fuel_or_battery", config, position: at(2.9, 0.3) }));

  // Designed geometry: mass computed from geometry × density.
  const part = (id, material, geometry, x, z) => ({ id, kind: "Part", material, geometry, position: at(x, z) });
  const shell = (area, thickness) => ({ shape: "shell", area, thickness });
  add("BODY", part("BODY_SHELL", "cfrp-quasi-iso", { shape: "ellipsoid-shell", length: "4.4 m", width: "1.9 m", height: "1.2 m", thickness: "3 mm" }, 2.3, 0.7));
  add("BODY", part("GLAZING", "glass-soda-lime", shell("2.2 m2", "4 mm"), 2.0, 1.0));
  for (const side of ["L", "R"]) {
    add("CHASSIS", { ...part(`RAIL_${side}`, "aluminum-6061-t6", { shape: "i-beam", length: "3.6 m", height: "120 mm", flangeWidth: "80 mm", flangeThickness: "6 mm", webThickness: "4 mm" }, 2.3, 0.25), kind: "Beam", props: { role: "rail" } });
  }
  add("CHASSIS", part("TUB", "cfrp-quasi-iso", shell("6 m2", "5 mm"), 2.2, 0.35));

  // Stand-in geometry: not designed or sourced parts, so placeholders.
  const standIn = (note) => ({ state: "placeholder", note: `stand-in geometry, not a designed or sourced part: ${note}` });
  add("SUSPENSION", { ...part("ARMS", "steel-4140", shell("0.8 m2", "4 mm"), 2.3, 0.3), props: { critical: "suspension", massState: standIn("suspension arms as a steel sheet") } });
  add("ELECTRICAL", { ...part("HARNESS", "copper-c11000", shell("0.5 m2", "2 mm"), 2.0, 0.4), props: { critical: "wiring", massState: standIn("wiring as a copper sheet") } });
  for (let i = 1; byId.has(`SEAT_${i}`); i++) {
    replace({ id: `SEAT_${i}`, kind: "Seat", name: `Seat ${i}`, material: "cfrp-quasi-iso", geometry: shell("1.4 m2", "4 mm"), position: at(i <= 2 ? 2.0 : 2.9, 0.45), props: { critical: "interior_seats", massState: standIn("seat as a CFRP sheet") } });
  }
  for (let i = 1; byId.has(`OCCUPANT_${i}`); i++) {
    const o = byId.get(`OCCUPANT_${i}`);
    replace({ ...o, position: at(i <= 2 ? 2.0 : 2.9, 0.6) });
  }
  // The architecture tagged the assemblies; the parts above carry the tags now.
  for (const id of ["SUSPENSION", "BRAKES", "ELECTRICAL"]) {
    const { critical: _tag, ...rest } = byId.get(id).props || {};
    replace({ ...byId.get(id), props: rest });
  }

  // Vehicle inputs. Cd and losses are inputs, which is why the top speed is a model output.
  const veh = byId.get("VEH");
  veh.props = {
    ...veh.props,
    vehicle: {
      fuelType: config.fuelType,
      dragCoefficient: 0.28,
      dragCoefficientSource: "design target (not computed: no CFD or wind-tunnel value)",
      frontalAreaFrom: "BODY_SHELL",
      rollingResistance: 0.011,
      drivelineEfficiency: 0.9,
      frontAxleX: "1.0 m",
      rearAxleX: "3.7 m",
      ...(tyre ? { tireRadius: `${tyre.dimensions.overallDiameterM / 2} m` } : {}),
      ...(gearbox ? { gearRatios: gearbox.ratings.gearRatios } : {}),
      // No final drive: the differential is not designed or sourced yet.
    },
  };
  return { ir, configuration: { config, sources }, selection, parsed: c.parsed };
}

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);

/**
 * Open the library-built car and report its acceptance: verdict, failures,
 * mass breakdown, critical components, tyre and top-speed status, and the
 * components with their sources.
 */
export function carAcceptance(brief) {
  const b = buildCarFromLibrary(brief);
  if (b.error) return { ok: false, error: b.error };
  const opened = openDesign(b.ir);
  if (!opened.ok) return { ok: false, error: "the library-built design did not compile", errors: opened.errors };
  const s = opened.session;
  const acc = s.result("vehicle.acceptance@VEH");
  const bd = s.result("mass.breakdown@VEH");
  const tyre = s.result("tire.speed-rating@VEH");
  const ts = s.result("vehicle.top-speed@VEH");
  const components = [...s.graph.nodes.values()].filter((n) => n.props?.component).map((n) => {
    const ms = n.props.massState;
    const entry = getComponent(n.props.component);
    return {
      node: n.id, componentId: n.props.component, name: n.name, massKg: entry.mass.kg, published: entry.mass.published, state: ms.state,
      source: ms.source?.url || null, sourceTitle: ms.source?.title || null, ...(ms.uncertainty ? { uncertainty: ms.uncertainty, method: ms.method } : {}),
      excludes: entry.mass.excludes || [], applicability: n.props.applicability,
    };
  });
  return {
    ok: true,
    session: s,
    report: {
      brief,
      configuration: b.configuration,
      selection: b.selection,
      verdict: acc.outputs.verdict.value,
      status: acc.status,
      failures: acc.failures || [],
      massBreakdown: {
        totalKg: r1(bd.outputs.totalMass.value),
        note: bd.outputs.totalMass.note,
        pct: { sourced: r1(bd.outputs.sourcedPct.value), estimated: r1(bd.outputs.estimatedPct.value), computed: r1(bd.outputs.computedPct.value), placeholder: r1(bd.outputs.placeholderPct.value) },
        kg: Object.fromEntries(Object.entries(bd.outputs.byState.value).map(([k, v]) => [k, r1(v.kg)])),
        uncertaintyKg: [r1(bd.outputs.uncertaintyLow.value), r1(bd.outputs.uncertaintyHigh.value)],
        uncertaintyExcludes: bd.outputs.uncertainty.value.excludes,
        lowerBound: acc.outputs.massBreakdown.value?.lowerBound ?? null,
        notIncluded: ["fuel load", "fluids", "masses each sourced part's listing excludes (see components[].excludes)"],
      },
      caveats: acc.outputs.caveats.value,
      criticalComponents: acc.outputs.criticalComponents.value.map((c) => ({ category: c.category, status: c.status, parts: (c.parts || []).map((p) => `${p.id}:${p.state}`), ...(c.reason ? { reason: c.reason } : {}) })),
      tyreSpeed: { status: tyre?.status ?? "not run", failures: tyre?.failures || [], margins: (tyre?.margins || []).map((m) => ({ check: m.check, demandKmh: r1(m.demand * 3.6), establishedKmh: r1(m.capacity * 3.6), pass: m.utilization <= 1 })) },
      topSpeed: { mph: r1(ts?.outputs?.topSpeed?.value / 0.44704), status: ts?.outputs?.topSpeed?.status ?? "not computed", unverifiedDependencies: acc.outputs.performanceClaims.value[0].unverifiedDependencies },
      requirements: s.graph.requirements.map((r) => ({ id: r.id, label: r.label, status: s.result(`requirement.check@${r.id}`)?.status })),
      components,
    },
  };
}
