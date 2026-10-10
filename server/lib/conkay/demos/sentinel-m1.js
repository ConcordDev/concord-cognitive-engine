// server/lib/conkay/demos/sentinel-m1.js
//
// Sentinel Milestone 1 (Sentinel/RAM spec rev 1.0, sections 4 and 10) as a
// ConKay design, run through the generic iterate-to-physical loop.
//
// Every number is one of:
//   sourced     read from the datasheet / standard / catalogue in
//               northstar/sources.js (id in `source`),
//   computed    by a solver from sourced inputs,
//   estimated   an explicit approximation with a basis and a range,
//   requirement a user requirement (locked: the loop may not change it),
//   unknown     listed as a gap, never zeroed.
// The two deliberate faults the spec asks for are built in: the payload
// hard-point bracket starts as 3/4" × 0.049" tube (over its allowable) and
// the battery starts as 13S2P Molicel P45B (below the load list).

import { SOURCES } from "../northstar/sources.js";
import { iterateToPhysical } from "../iterate/loop.js";
import { acceptanceGate } from "../iterate/gate.js";
import { rectTubeSection } from "../physics/solvers/tube-actuation.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IN = 0.0254;
const r6 = (v) => +v.toFixed(6);
const LB_PER_FT_TO_KG_PER_M = 0.45359237 / 0.3048;
const m = (v) => `${+v.toFixed(6)} m`;
const pos = (x, y, z) => ({ x: m(x), y: m(y), z: m(z) });

// Stocked 6061-T6 square tube (Aircraft Spruce list): outside size, wall, catalogue lb/ft.
export const TUBE_CATALOG = [
  { id: "sq-0.5x0.058", size: 0.5, wall: 0.058, lbPerFt: 0.156 },
  { id: "sq-0.75x0.049", size: 0.75, wall: 0.049, lbPerFt: 0.217 },
  { id: "sq-1x0.065", size: 1, wall: 0.065, lbPerFt: 0.3 },
  { id: "sq-2x0.125", size: 2, wall: 0.125, lbPerFt: 1.12 },
  { id: "sq-2x0.190", size: 2, wall: 0.19, lbPerFt: 1.42, note: "6061-T6511 per the list" },
].map((t) => ({ ...t, source: "aircraft-spruce-6061-square-tube", geometry: { width: r6(t.size * IN), height: r6(t.size * IN), wall: r6(t.wall * IN) } }));

/** Catalogue weight vs weight computed from the listed size and wall (sharp corners, 2700 kg/m³). */
export function catalogCrossCheck() {
  return TUBE_CATALOG.map((t) => {
    const computed = rectTubeSection(t.geometry).A * 2700;
    const listed = t.lbPerFt * LB_PER_FT_TO_KG_PER_M;
    const d = (computed - listed) / listed;
    return { id: t.id, listedKgPerM: listed, computedKgPerM: computed, deltaPct: d * 100, flag: Math.abs(d) > 0.1 ? "catalogue weight and listed wall disagree by >10 %: one of them is wrong; use measured stock" : null };
  });
}

const tube = (id) => {
  const t = TUBE_CATALOG.find((x) => x.id === id);
  return { shape: "rect-tube", width: m(t.geometry.width), height: m(t.geometry.height), wall: m(t.geometry.wall) };
};

// Datasheet records (values transcribed from SOURCES excerpts).
export const ACTUATOR = { model: "CubeMars AK80-64 KV80", ratedTorqueNm: 48, peakTorqueNm: 120, ratedSpeedRpm48V: 48, voltageV: 48, ratedCurrentA: 7, peakCurrentA: 19, massKg: 0.85, envelope: { x: 0.098, y: 0.0619, z: 0.098 }, source: "cubemars-ak80-64" };
export const CELL = { model: "Molicel INR-21700-P45B", nominalV: 3.6, maxV: 4.2, minV: 2.5, capacityAh: 4.5, energyWh: 16.2, maxContinuousA: 45, massKg: 0.07, diameterM: 0.02155, heightM: 0.07015, source: "molicel-p45b" };
export const PANEL = { model: "Renogy RNG-100D-SS", nameplateW: 100, efficiency: 0.178, lengthM: 1.062, widthM: 0.53, depthM: 0.035, massKg: 6.4, noctC: 47, tempCoeffPctPerC: -0.37, source: "renogy-rng-100d-ss" };
export const COMPUTE = { model: "NVIDIA Jetson AGX Orin 64GB module", modeW: 30, maxW: 60, envelope: { x: 0.016, y: 0.1, z: 0.087 }, massKg: null, source: "nvidia-jetson-agx-orin" };
export const LIDAR = { model: "Velodyne VLP-16 Puck", typicalW: 8, massKg: 0.83, diameterM: 0.103, heightM: 0.072, source: "velodyne-vlp16" };

// Mass records in the #1037 mass-state schema (verification/mass-state.js).
// A datasheet mass is "sourced" with the datasheet URL and the exact variant;
// a mass no source states is a "placeholder" with NO mass value, so it stays
// on the unknown list and is never counted as zero.
const sourcedMass = (kg, sourceId, variant) => ({
  mass: `${kg} kg`,
  massState: { state: "sourced", sourceKind: "manufacturer published spec", source: { url: SOURCES[sourceId].url, title: SOURCES[sourceId].title, sourceId }, variant },
});
const unknownMass = (note) => ({ massState: { state: "placeholder", note } });

const PVW = JSON.parse(readFileSync(fileURLToPath(new URL("../northstar/fixtures/pvwatts-nyc-tilt90-south.json", import.meta.url)), "utf8"));

const FRAME = "aluminum-6061-t6-b221";
const BIG = "sq-2x0.125";

/** The Milestone 1 design IR. Options select the deliberate-fault start or any other point. */
export function buildSentinelM1IR({ batteryParallel = 2, bracket = "sq-0.75x0.049" } = {}) {
  const nodes = [];
  const edges = [];
  const add = (n) => { nodes.push(n); edges.push({ type: "CONTAINS", from: "sentinel", to: n.id }); return n; };
  const mate = (a, b) => edges.push({ type: "MATED_TO", from: a, to: b });
  nodes.push({
    id: "sentinel", kind: "Assembly", name: "Sentinel M1 ground prototype",
    props: {
      massBudget: true,
      clearance: { tolerance: 0.001 },
      // Stance leg in single support as a 3D frame (structure.frame): shin and thigh are
      // the shin-l / thigh-l parts (section + material from the graph), joint centre to
      // joint centre; ankle fixed (foot flat, actuators holding the pose).
      frameModel: {
        nodes: [{ id: "ankle", x: 0, y: 0.2, z: 0.061 }, { id: "knee", x: 0, y: 0.2, z: 0.939 }, { id: "hip", x: 0, y: 0.2, z: 1.817 }],
        members: [{ id: "shin", i: "ankle", j: "knee", part: "shin-l" }, { id: "thigh", i: "knee", j: "hip", part: "thigh-l" }],
        supports: [{ node: "ankle", fix: "fixed" }],
        loadCases: [{
          id: "single-support",
          weight: [{ from: { solver: "mass.budget", target: "sentinel", output: "knownMass" }, factor: { value: 2, state: "estimated", basis: "walking/stop-start load amplification, as the bracket; no measured load spectrum" },
            dir: [0, 0, -1], node: "hip", lever: [0, -0.05, 0] }],
        }],
        buckling: { cases: ["single-support"], requiredFactor: { value: 2, state: "design rule", basis: "screening factor on the elastic buckling load; not a code check" } },
        factorOfSafety: { value: 2, state: "design rule", basis: "screening factor on specified-minimum yield; not a code check" },
        assumptions: [
          "Body weight acts at the hip 50 mm inboard (estimated lever, as the joint holding torques); single support on the left leg.",
          "Joints rigid: the actuators hold the pose; actuator compliance and backlash are not modelled. Fixed at the ankle (foot flat).",
        ],
      },
      stability: { contacts: ["foot-l", "foot-r"], pose: "standing, both feet flat, payload on the chest hard-point" },
      electrical: {
        battery: "battery", solarPanel: "solar",
        dcdcEfficiency: { value: 0.92, state: "estimated", range: [0.88, 0.95], basis: "typical isolated DC-DC converter; no converter selected yet" },
        policy: { maxSimultaneousPeak: { value: 3, state: "estimated", range: [2, 6], basis: "controller limits peak current to one leg's three joints at a time (policy to be implemented and logged)" } },
        profile: {
          walkFraction: { value: 0.3, state: "estimated", range: [0.1, 0.6], basis: "mission: stand/sense 70 %, walk 30 %; no gait log exists (spec 9 gap 1)" },
          walkLoadFactor: { value: 0.5, state: "estimated", range: [0.3, 0.8], basis: "fraction of rated electrical power while walking; unmeasured" },
          standLoadFactor: { value: 0.15, state: "estimated", range: [0.05, 0.3], basis: "holding current fraction while standing; unmeasured" },
        },
        operatingHoursPerDay: 1,
      },
    },
  });
  // Legs: foot plate, ankle, shin, knee, thigh, hip — left (y +0.20) and right (y −0.20).
  for (const [s, y] of [["l", 0.2], ["r", -0.2]]) {
    add({ id: `foot-${s}`, kind: "Plate", name: `foot ${s}`, material: FRAME, geometry: { shape: "plate", length: "0.36 m", width: "0.18 m", thickness: "0.012 m" }, position: pos(0, y, 0.006) });
    const act = (j, z) => add({ id: `${j}-${s}`, kind: "Actuator", name: `${j} ${s} (${ACTUATOR.model})`, position: pos(0, y, z),
      props: { envelope: ACTUATOR.envelope, ...sourcedMass(ACTUATOR.massKg, ACTUATOR.source, ACTUATOR.model), actuator: ACTUATOR,
        load: { rail: "actuators", voltageV: ACTUATOR.voltageV, ratedCurrentA: ACTUATOR.ratedCurrentA, peakCurrentA: ACTUATOR.peakCurrentA, source: ACTUATOR.source } } });
    act("ankle", 0.061);
    add({ id: `shin-${s}`, kind: "Beam", name: `shin ${s}`, material: FRAME, geometry: { ...tube(BIG), length: "0.78 m" }, position: pos(0, y, 0.5), props: { axis: "z", section: BIG } });
    act("knee", 0.939);
    add({ id: `thigh-${s}`, kind: "Beam", name: `thigh ${s}`, material: FRAME, geometry: { ...tube(BIG), length: "0.78 m" }, position: pos(0, y, 1.378), props: { axis: "z", section: BIG } });
    act("hip", 1.817);
    mate(`foot-${s}`, `ankle-${s}`); mate(`ankle-${s}`, `shin-${s}`); mate(`shin-${s}`, `knee-${s}`); mate(`knee-${s}`, `thigh-${s}`); mate(`thigh-${s}`, `hip-${s}`); mate(`hip-${s}`, "pelvis");
  }
  add({ id: "pelvis", kind: "Beam", name: "pelvis beam", material: FRAME, geometry: { ...tube(BIG), length: "0.56 m" }, position: pos(0, 0, 1.8914), props: { axis: "y", section: BIG } });
  for (const [s, y] of [["l", 0.12], ["r", -0.12]]) {
    add({ id: `torso-${s}`, kind: "Beam", name: `torso upright ${s}`, material: FRAME, geometry: { ...tube(BIG), length: "0.80 m" }, position: pos(0, y, 2.3168), props: { axis: "z", section: BIG } });
    mate(`torso-${s}`, "pelvis"); mate(`torso-${s}`, "shoulder");
  }
  add({ id: "shoulder", kind: "Beam", name: "shoulder beam", material: FRAME, geometry: { ...tube(BIG), length: "0.56 m" }, position: pos(0, 0, 2.7422), props: { axis: "y", section: BIG } });
  add({ id: "mast", kind: "Beam", name: "sensor mast", material: FRAME, geometry: { ...tube("sq-1x0.065"), length: "0.2104 m" }, position: pos(0, 0, 2.8728), props: { axis: "z", section: "sq-1x0.065" } });
  add({ id: "lidar", kind: "Sensor", name: LIDAR.model, position: pos(0, 0, 3.014),
    props: { envelope: { x: LIDAR.diameterM, y: LIDAR.diameterM, z: LIDAR.heightM }, ...sourcedMass(LIDAR.massKg, LIDAR.source, LIDAR.model), load: { rail: "sensors", typicalW: { value: LIDAR.typicalW, state: "sourced", source: LIDAR.source } } } });
  mate("shoulder", "mast"); mate("mast", "lidar");
  add({ id: "compute", kind: "Part", name: COMPUTE.model, position: pos(0, 0, 2.4),
    props: { envelope: COMPUTE.envelope, ...unknownMass(`module mass not stated in the NVIDIA data sheet read (${COMPUTE.source})`), serviceAccess: { face: "+x", depth: 0.05 },
      load: { rail: "compute", typicalW: { value: COMPUTE.modeW, state: "sourced", source: COMPUTE.source }, peakW: { value: COMPUTE.maxW, state: "sourced", source: COMPUTE.source } } } });
  add({ id: "sensors-misc", kind: "Sensor", name: "IMU + cameras (not selected)", props: { ...unknownMass("no part selected"), load: { rail: "sensors", typicalW: { value: 10, state: "estimated", range: [5, 20], basis: "placeholder until parts are chosen" } } } });
  add({ id: "fans", kind: "Part", name: "controller/driver cooling fans (not selected)", props: { ...unknownMass("no part selected"), load: { rail: "thermal", typicalW: { value: 12, state: "estimated", range: [5, 25], basis: "placeholder until thermal design" } } } });
  add({ id: "battery", kind: "Part", name: `battery 13S${batteryParallel}P ${CELL.model}`, position: pos(-0.1, 0, 2.05),
    props: { battery: { series: 13, parallel: batteryParallel, cell: CELL, usableFraction: { value: 0.8, state: "estimated", range: [0.7, 0.9], basis: "usable window not in the cell datasheet; to be measured by rundown (spec 3.2)" }, reserveFraction: { value: 0.15, state: "requirement", basis: "reserve held back for safe-stop (not available to the mission)" } },
      serviceAccess: { face: "+z", depth: 0.05 } } });
  mate("battery", "torso-l"); mate("battery", "torso-r");
  add({ id: "solar", kind: "Part", name: `${PANEL.model} (back-mounted, vertical, facing south when parked)`, position: pos(-0.2, 0, 2.3),
    props: { envelope: { x: PANEL.depthM, y: PANEL.widthM, z: PANEL.lengthM }, ...sourcedMass(PANEL.massKg, PANEL.source, PANEL.model),
      solar: {
        panel: PANEL,
        irradianceDaily: { value: +PVW.outputs.solrad_annual.toFixed(3), state: "estimated", basis: "NREL/NLR PVWatts v8 TMY annual mean, tilt 90° south, NYC (lat 40.71, lon −74.01); not a site measurement", source: "pvwatts-v8-nyc", monthlyMin: Math.min(...PVW.outputs.solrad_monthly) },
        systemLosses: { value: 0.14, state: "estimated", source: "pvwatts-v5-manual" },
        controllerEfficiency: { value: 0.96, state: "estimated", range: [0.93, 0.98], basis: "MPPT controller not selected" },
      } } });
  add({ id: "bracket", kind: "Beam", name: "payload hard-point bracket (cantilever)", material: FRAME, geometry: { ...tube(bracket), length: "0.40 m" }, position: pos(0.0254 + 0.2, 0, 2.2),
    props: { axis: "x", section: bracket, bending: { tipMassFrom: "payload", rootAt: 0.0254, dynamicFactor: { value: 2, state: "estimated", basis: "walking/stop-start load amplification; no measured load spectrum" }, factorOfSafety: { value: 2, state: "design rule", basis: "screening factor on specified-minimum yield; not a code check" } } } });
  add({ id: "payload", kind: "Part", name: "payload (user requirement)", position: pos(0.3, 0, 2.0496), props: { envelope: { x: 0.25, y: 0.3, z: 0.25 }, mass: "20 kg", massSource: "Milestone 1 demo requirement: carry a stated 20 kg payload",
    // A required mass is not a mass state (#1037: not sourced, estimated or computed); mass.budget
    // counts it as "requirement" and the loop may not change it (locked below).
    massRequirement: true } });
  mate("torso-l", "bracket"); mate("torso-r", "bracket"); mate("bracket", "payload");
  for (const [id, name] of [
    ["wiring", "wiring harness"], ["fasteners", "fasteners, joint brackets, actuator mounts"], ["bms", "battery BMS, enclosure, interconnects"],
    ["compute-carrier", "Jetson carrier board and thermal solution"], ["panel-mount", "solar panel mount"], ["armor", "armor cage (spec 4.2: unknown, a component line)"],
  ]) add({ id, kind: "Part", name, props: unknownMass("not designed / not in any datasheet") });
  // Single-support holding torques, left leg in stance (right is symmetric).
  const below = { ankle: ["foot-l"], knee: ["foot-l", "ankle-l", "shin-l"], hip: ["foot-l", "ankle-l", "shin-l", "knee-l", "thigh-l"] };
  for (const j of ["ankle", "knee", "hip"]) {
    nodes.find((n) => n.id === `${j}-l`).props.holding = { assembly: "sentinel", excludeBelow: below[j], share: 1, lever: { value: 0.05, state: "estimated", basis: "pose: joint 50 mm off the load line in single support" }, pose: "single support on the left leg" };
  }
  return {
    design: { id: "sentinel-m1", name: "Sentinel Milestone 1 (ground prototype)" },
    nodes, edges,
    requirements: [
      { id: "R-height", label: "frame height 3.05 m ± 0.05 m", of: { solver: "geometry.clearance", target: "sentinel", output: "overallHeight" }, min: "3.0 m", max: "3.1 m" },
      { id: "R-duration", label: "operate ≥ 1 h on the battery at the average load", of: { solver: "electrical.budget", target: "sentinel", output: "operatingDuration" }, min: "1 h" },
      { id: "R-stability", label: "static stability margin ≥ 0.05 m", of: { solver: "stability.static", target: "sentinel", output: "stabilityMargin" }, min: "0.05 m" },
    ],
    locked: [{ node: "payload", path: "props.mass", reason: "user requirement: 20 kg payload" }],
  };
}

export const DESIGN_VARIABLES = [
  { id: "bracket.section", label: "payload bracket tube section (stocked sizes only)", node: "bracket",
    options: TUBE_CATALOG.map((t) => ({ label: `${t.size}" × ${t.wall}" 6061-T6`, set: { "geometry.width": t.geometry.width, "geometry.height": t.geometry.height, "geometry.wall": t.geometry.wall } })) },
  { id: "battery.parallel", label: "battery parallel strings (13S, P45B), bounded 2–8", node: "battery",
    options: [2, 3, 4, 5, 6, 7, 8].map((p) => ({ label: `13S${p}P`, set: { "props.battery.parallel": p } })) },
];

// Solvers that don't apply to a component-list design with unknown masses:
// mass.cg and mass.assembly stop (NOT_COMPUTED) while any body has no mass
// (the battery's mass is cells × cell mass, and nine parts are placeholders).
// mass.budget replaces them: the known mass and its CG, labelled so, with
// every unknown named.
export const EXCLUDED_SOLVERS = [
  { id: "mass.cg", reason: "not computed while any body lacks a mass (battery from cells, nine placeholder parts); mass.budget gives the known-mass CG and lists the unknowns" },
  { id: "mass.assembly", reason: "as mass.cg: no total while masses are unknown (mass.budget lists them)" },
  { id: "cost.part", reason: "no prices sourced; cost is a BOM output (spec 4.2), not computed here" },
  { id: "cost.assembly", reason: "as cost.part" },
];

export const PHYSICAL_TESTS = [
  "Measured component masses against the CAD mass budget (spec 4.5)",
  "Static tip-load or joint-torque test",
  "Logged walk at the accepted speed on the accepted surface (walking speed is not computed here)",
  "Battery rundown at the logged average load (replaces the estimated usable fraction and duty cycle)",
  "Thermal measurement at the controller and actuator drivers",
];

export function runSentinelM1({ claims = [], maxIterations = 8, ir = buildSentinelM1IR() } = {}) {
  const r = iterateToPhysical(ir, { designVariables: DESIGN_VARIABLES, excludeSolvers: EXCLUDED_SOLVERS, maxIterations, claims });
  if (!r.ok) return r;
  const gate = acceptanceGate({ report: r.report, inputClaims: claims.filter((c) => c.usedAsInput), physicalTests: PHYSICAL_TESTS });
  return { ok: true, report: r.report, gate, catalog: catalogCrossCheck(), sources: SOURCES };
}
