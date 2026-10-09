// server/lib/conkay/compiler/car-from-library.js
//
// The car brief, built from real parts. The brief compiles to the
// road-vehicle system tree (architectures.js); then every critical component
// is picked from the library by applicability (the lightest entry that fits
// the configuration, per axle or seat position where that matters) and
// placed in the tree with its published mass, mass state, source and what
// the published mass excludes. The running gear is a family with published
// fitment (S550 Mustang suspension, steering, brakes and Super 8.8 IRS), so
// one part's fit can be checked against the others. The body and chassis
// keep their designed geometry (mass computed from geometry × density).
// What the library can't settle (a tyre established below the model's top
// speed, an unrated torque capacity) stays visible in the acceptance result.

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
    transmissionType: "manual",
    frontSuspension: "Ford S550 Mustang front (2015-2023)",
    rearSuspension: "Ford S550 IRS (2015-2023 Mustang)",
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
    transmissionType: overrides.transmissionType ? "given" : "design choice (manual: Coyote V8 + TREMEC manual)",
    frontSuspension: overrides.frontSuspension ? "given" : "design choice: S550 Mustang running gear, so suspension, steering, brakes and axle have published fitment to each other",
    rearSuspension: overrides.rearSuspension ? "given" : "design choice: S550 Mustang IRS (see frontSuspension)",
    boltPattern: overrides.boltPattern ? "given" : "design choice (5x114.3 hub pattern)",
    wheelDiameterIn: overrides.wheelDiameterIn ? "given" : "design choice (18 in wheels)",
    vehicleMassKg: "brief: mass target (max)",
    requiredTopSpeedKmh: "brief: top-speed target (min)",
    loadPerTyreKg: `(mass target + ${seats ?? "?"} occupants × ${OCCUPANT_KG} kg) / 4, static, even split (screening)`,
  };
  return { config, sources };
}

function pick(category, config, selection, { key = category, where, extra } = {}) {
  const r = selectComponent(category, config, { extra, where });
  selection[key] = { chosen: r.chosen?.id || null, candidates: r.candidates };
  return r.chosen;
}

const at = (x, z, y = 0) => ({ x: metres(x), y: metres(y), z: metres(z) });

function libraryNode(entry, { id, kind, critical, config, position, share = 1, props = {} }) {
  const ms = massStateOf(entry);
  const kg = entry.mass.kg * share;
  if (share !== 1) {
    // One seat position of a multi-position part: its share of the measured mass.
    ms.variant = `${ms.variant || entry.variant} (one of ${Math.round(1 / share)} positions: ${share === 0.5 ? "half" : `${share} ×`} the published ${entry.mass.kg} kg)`;
    if (ms.uncertainty?.lowKg != null) ms.uncertainty = { lowKg: ms.uncertainty.lowKg * share, highKg: ms.uncertainty.highKg * share };
  }
  return {
    id, kind, name: `${entry.manufacturer} ${entry.model} (${entry.variant})`,
    position,
    props: {
      critical,
      component: entry.id,
      mass: `${kg} kg`,
      massState: ms,
      massExcludes: entry.mass.excludes || [],
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
    config.engineId = engine.id;
    config.engineTorqueNm = engine.ratings.peakTorqueNm?.value ?? null;
    config.enginePattern = engine.applicability.transmissionPattern ?? null;
    config.engineMaxRpm = engine.ratings.redlineRpm?.value ?? engine.ratings.maxSpeedRpm?.value ?? null;
    const rl = engine.ratings.redlineRpm;
    replace(libraryNode(engine, {
      id: "ENGINE", kind: "Actuator", critical: "engine_or_motor", config, position: at(3.3, 0.5),
      props: {
        maxPower: `${engine.ratings.peakPowerW.value} W`,
        maxPowerSource: `${engine.ratings.peakPowerW.published} (${engine.mass.massState.source.title})`,
        ...(Number.isFinite(engine.ratings.peakPowerW.rpm) ? { peakPowerRpm: engine.ratings.peakPowerW.rpm } : {}),
        ...(Number.isFinite(rl?.value) ? {
          redlineRpm: rl.value,
          redlineBasis: rl.state === "estimated" ? `estimated: ${rl.method}` : `published: ${rl.published || ""}`,
          ...(rl.range ? { redlineRange: rl.range } : {}),
        } : {}),
      },
    }));
  }
  // Engine wiring: the control pack made for this engine.
  const wiring = pick("wiring", config, selection);
  if (wiring) add("ELECTRICAL", libraryNode(wiring, { id: "CONTROL_PACK", kind: "Part", critical: "wiring", config, position: at(2.6, 0.6) }));
  // Transmission (must take the engine's torque and bolt to its pattern).
  const gearbox = pick("transmission", config, selection);
  if (gearbox) {
    add("DRIVELINE", libraryNode(gearbox, {
      id: "TRANSMISSION", kind: "Part", critical: "transmission", config, position: at(3.7, 0.35),
      props: Number.isFinite(gearbox.ratings.maxInputRpm?.value) ? { maxInputRpm: gearbox.ratings.maxInputRpm.value } : {},
    }));
  }
  // Differential and rear axle: must fit the rear suspension.
  const diff = pick("differential", config, selection);
  if (diff) add("DRIVELINE", libraryNode(diff, { id: "DIFFERENTIAL", kind: "Part", critical: "differential", config, position: at(3.7, 0.33) }));
  // Suspension, front and rear; the front one provides the spindle the brakes bolt to.
  const suspF = pick("suspension", config, selection, { key: "suspension_front", where: (c) => c.applicability.axle === "front" });
  if (suspF) {
    if (suspF.applicability.provides?.spindle) config.spindle = suspF.applicability.provides.spindle;
    add("SUSPENSION", libraryNode(suspF, { id: "SUSPENSION_FRONT", kind: "Part", critical: "suspension", config, position: at(1.0, 0.35), props: { axle: "front" } }));
  }
  const suspR = pick("suspension", config, selection, { key: "suspension_rear", where: (c) => c.applicability.axle === "rear" });
  if (suspR) add("SUSPENSION", libraryNode(suspR, { id: "SUSPENSION_REAR", kind: "Part", critical: "suspension", config, position: at(3.7, 0.35), props: { axle: "rear" } }));
  const steering = pick("steering", config, selection);
  if (steering) add("SUSPENSION", libraryNode(steering, { id: "STEERING_RACK", kind: "Part", critical: "steering", config, position: at(1.1, 0.3) }));
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
  // Brakes, one kit per axle.
  for (const [axle, x] of [["front", 1.0], ["rear", 3.7]]) {
    const kit = pick("brakes", config, selection, { key: `brakes_${axle}`, where: (c) => c.applicability.axle === axle });
    if (kit) add("BRAKES", libraryNode(kit, { id: `BRAKES_${axle.toUpperCase()}`, kind: "Part", critical: "brakes", config, position: at(x, 0.33), props: { axle } }));
  }
  // Cooling, exhaust (combustion only) and fuel.
  const cooling = pick("cooling", config, selection);
  if (cooling) add("POWERTRAIN", libraryNode(cooling, { id: "RADIATOR", kind: "Part", critical: "cooling", config, position: at(0.6, 0.45) }));
  if (config.fuelType !== "electric") {
    const exhaust = pick("exhaust", config, selection);
    if (exhaust) add("POWERTRAIN", libraryNode(exhaust, { id: "EXHAUST", kind: "Part", critical: "exhaust", config, position: at(3.0, 0.2) }));
  }
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

  // Seats: front positions and rear positions from the library.
  const seatF = pick("interior_seats", config, selection, { key: "seats_front", where: (c) => c.applicability.seatPosition === "front" });
  const seatR = pick("interior_seats", config, selection, { key: "seats_rear", where: (c) => c.applicability.seatPosition === "rear" });
  for (let i = 1; byId.has(`SEAT_${i}`); i++) {
    const entry = i <= 2 ? seatF : seatR;
    const old = byId.get(`SEAT_${i}`);
    if (!entry) { replace({ ...old, props: { ...old.props, massState: { state: "placeholder", note: "no library seat for this position" } } }); continue; }
    const share = 1 / (entry.applicability.positions || 1);
    replace({ ...libraryNode(entry, { id: `SEAT_${i}`, kind: "Seat", critical: "interior_seats", config, share, position: at(i <= 2 ? 2.0 : 2.9, 0.45) }), name: `Seat ${i}: ${entry.manufacturer} ${entry.model}` });
  }
  for (let i = 1; byId.has(`OCCUPANT_${i}`); i++) {
    const o = byId.get(`OCCUPANT_${i}`);
    replace({ ...o, position: at(i <= 2 ? 2.0 : 2.9, 0.6) });
  }
  // A part's listing may exclude something another selected part supplies
  // (the engine's control pack, hoses that come with it): that is not missing
  // mass, so it moves to massCoveredElsewhere.
  const chosen = ir.nodes.filter((n) => n.props?.component).map((n) => getComponent(n.props.component));
  const supplied = (x) => {
    if (/\b(counted with|comes? with|included with)\b/i.test(x)) return true;
    const pns = x.match(/\bM-\d{4}-[A-Z0-9]+\b/gi) || [];
    return pns.some((pn) => chosen.some((c) => c.id.toLowerCase().includes(pn.toLowerCase())));
  };
  for (const n of ir.nodes.filter((x) => Array.isArray(x.props?.massExcludes))) {
    const ex = n.props.massExcludes;
    n.props.massExcludes = ex.filter((x) => !supplied(x));
    const covered = ex.filter(supplied);
    if (covered.length) n.props.massCoveredElsewhere = covered;
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
      ...(Number.isFinite(diff?.ratings?.finalDrive?.value) ? {
        finalDrive: diff.ratings.finalDrive.value,
        finalDriveSource: `${diff.id}: ${diff.ratings.finalDrive.published}`,
      } : {}),
    },
  };
  return { ir, configuration: { config, sources }, selection, parsed: c.parsed };
}

const kgOf = (m) => (typeof m === "number" ? m : parseFloat(String(m)));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);

/**
 * What could resolve a tyre established below the model's top speed, without
 * changing the physics: the facts for each option, cited where they come from.
 */
function tyreOptions({ b, gear, tyreEntry, load, s }) {
  if (!tyreEntry) return null;
  const est = tyreEntry.applicability.establishedMaxSpeedKmh;
  const out = { establishedKmh: est, explicitRatingAbove300: tyreEntry.ratings.explicitMaxSpeedKmh ?? null, options: [] };
  out.options.push({
    option: "a tyre with the manufacturer's explicit rating above the top speed",
    finding: tyreEntry.ratings.highSpeedNote || "no explicit manufacturer rating above 300 km/h is recorded for this tyre",
  });
  const diff = getComponent(s.graph.node("DIFFERENTIAL")?.props?.component || "");
  const ratios = b.ir.nodes.find((n) => n.id === "VEH")?.props?.vehicle?.gearRatios;
  const r = gear?.inputs?.tireRadius?.value;
  const rpm = gear?.outputs?.revLimitRpm?.value;
  if (diff?.ratings?.finalDriveOptions && Array.isArray(ratios) && Number.isFinite(r) && Number.isFinite(rpm)) {
    const top = Math.min(...ratios);
    const perRatio = diff.ratings.finalDriveOptions.values.map((fd) => {
      const kmh = (rpm * ((2 * Math.PI) / 60) * r) / (top * fd) * 3.6;
      return { finalDrive: fd, gearLimitedKmh: r1(kmh), gearLimitedMph: r1(kmh / 1.609344), withinTyre: kmh <= est };
    });
    out.options.push({
      option: "gearing: a shorter final drive so top gear runs out of revs below the tyre's established speed",
      finding: perRatio.some((x) => x.withinTyre)
        ? `available final drives that keep the gear limit within ${est} km/h: ${perRatio.filter((x) => x.withinTyre).map((x) => x.finalDrive).join(", ")}`
        : `no available final drive does: the shortest (${Math.max(...perRatio.map((x) => x.finalDrive))}) still allows ${r1(Math.min(...perRatio.map((x) => x.gearLimitedKmh)))} km/h at ${rpm} rpm in top gear (${top})`,
      perRatio,
      basis: `${diff.ratings.finalDriveOptions.published} Rev limit ${rpm} rpm (${gear.outputs.revLimitRpm.source}).`,
    });
  }
  out.options.push({ option: "an electronic speed limit at or below the tyre's established speed", finding: "a design decision, not applied here; it would make the required top speed the limit to verify instead" });
  out.options.push({ option: "more drag (a higher Cd or frontal area)", finding: "Cd 0.28 is a design target, not a measurement; a measured Cd would move the drag-limited speed either way" });
  const derate = tyreEntry.ratings.highSpeedLoadDerating;
  if (derate && load?.margins?.length) {
    const vReqKmh = b.configuration.config.requiredTopSpeedKmh;
    const row = derate.table.filter((x) => x.mph * 1.609344 <= (vReqKmh ?? 0) + 1e-6).at(-1);
    if (row) {
      const capKg = (row.loadPct / 100) * tyreEntry.applicability.maxLoadKg;
      const worst = Math.max(...load.margins.map((m) => m.demand / 9.80665));
      out.highSpeedLoad = {
        atMph: row.mph, inflationIncreasePsi: row.psi, loadCapacityPct: row.loadPct, capacityKg: r1(capKg), worstStaticLoadKg: r1(worst), pass: worst <= capKg,
        source: derate.source.url,
        note: "Michelin's Y-speed-rated load/inflation table at the required top speed; static loads, no downforce or load transfer",
      };
    }
  }
  return out;
}

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
  const gear = s.result("vehicle.gearing@VEH");
  const load = s.result("tire.load-index@VEH");
  const claim = acc.outputs.performanceClaims.value[0];
  const components = [...s.graph.nodes.values()].filter((n) => n.props?.component).map((n) => {
    const ms = n.props.massState;
    const entry = getComponent(n.props.component);
    return {
      node: n.id, componentId: n.props.component, name: n.name, massKg: kgOf(n.props.mass), entryMassKg: entry.mass.kg, published: entry.mass.published, state: ms.state,
      ...(ms.sourceKind ? { sourceKind: ms.sourceKind } : {}),
      source: ms.source?.url || null, sourceTitle: ms.source?.title || null, ...(ms.uncertainty ? { uncertainty: ms.uncertainty, method: ms.method } : {}),
      excludes: entry.mass.excludes || [], applicability: n.props.applicability,
    };
  });
  const sourcedBy = { manufacturer: 0, measured: 0 };
  for (const c of components.filter((x) => x.state === "sourced")) sourcedBy[c.sourceKind ? "measured" : "manufacturer"] += c.massKg;
  const targetKg = b.configuration.config.vehicleMassKg;
  const totalKg = bd.outputs.totalMass.value;
  const tyreEntry = getComponent(components.find((c) => c.node === "TIRE_FL")?.componentId || "");
  const report_tyreOptions = tyreOptions({ b, gear, tyreEntry, load, s });
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
        vsTarget: Number.isFinite(targetKg) ? { targetKg: r1(targetKg), targetLb: r1(targetKg / 0.45359237), totalKg: r1(totalKg), totalLb: r1(totalKg / 0.45359237), marginKg: r1(targetKg - totalKg), note: "the total is a lower bound (see notIncluded), so the margin is an upper bound" } : null,
        sourcedKgBySourceKind: { manufacturerSpec: r1(sourcedBy.manufacturer), thirdPartyMeasurement: r1(sourcedBy.measured) },
        notIncluded: ["fuel load", "fluids", ...(acc.outputs.massBreakdown.value?.excluded || [])],
      },
      caveats: acc.outputs.caveats.value,
      criticalComponents: acc.outputs.criticalComponents.value.map((c) => ({ category: c.category, status: c.status, parts: (c.parts || []).map((p) => `${p.id}:${p.state}`), ...(c.reason ? { reason: c.reason } : {}) })),
      tyreSpeed: { status: tyre?.status ?? "not run", failures: tyre?.failures || [], margins: (tyre?.margins || []).map((m) => ({ check: m.check, demandKmh: r1(m.demand * 3.6), establishedKmh: r1(m.capacity * 3.6), pass: m.utilization <= 1 })) },
      topSpeed: {
        mph: r1(claim.mph), kmh: r1(claim.value * 3.6), status: claim.status, basis: claim.basis,
        dragLimitedMph: r1(claim.dragLimitedMph), gearLimitedMph: r1(claim.gearLimitedMph),
        ...(claim.gearLimitedMphRange ? { gearLimitedMphRange: { low: r1(claim.gearLimitedMphRange.low), high: r1(claim.gearLimitedMphRange.high), rpm: claim.gearLimitedMphRange.rpm } } : {}),
        gearLimitStatus: claim.gearLimitStatus, revLimit: claim.revLimit,
        finalDrive: gear?.inputs?.finalDrive ?? null, topGearRatio: gear?.inputs?.gearRatios?.value?.at(-1) ?? null,
        warnings: gear?.warnings || [],
        unverifiedDependencies: claim.unverifiedDependencies,
      },
      tyreOptions: report_tyreOptions,
      requirements: s.graph.requirements.map((r) => ({ id: r.id, label: r.label, status: s.result(`requirement.check@${r.id}`)?.status })),
      components,
    },
  };
}
