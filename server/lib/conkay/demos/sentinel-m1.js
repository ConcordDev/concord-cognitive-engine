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
// The compute system: the Jetson AGX Orin 64GB in Advantech's fanless MIC-733-A06A1 (module, carrier and
// thermal solution in one sourced mass; the NVIDIA module data sheet states no mass). Mounted 230 mm along x,
// 87 mm along y (between the torso uprights) and 192 mm along z.
export const COMPUTE_SYSTEM = { model: "Advantech MIC-733-A06A1 (Jetson AGX Orin 64G, fanless)", massKg: 4.5, envelope: { x: 0.23, y: 0.087, z: 0.192 }, inputV: [9, 36], source: "advantech-mic-733-ao" };
export const CAMERA = { model: "RealSense D455", massKg: 0.116, tolerancePct: 10, maxW: 3.46147, envelope: { x: 0.026, y: 0.124, z: 0.029 }, source: "realsense-d400-datasheet" };
export const IMU = { model: "Xsens MTi-630 AHRS", massKg: 0.0089, maxW: 0.5, envelope: { x: 0.0315, y: 0.028, z: 0.013 }, source: "xsens-mti-630" };
export const FAN = { model: "Sanyo Denki San Ace 80 9GA0824P4H001 (24 V)", massKg: 0.11, ratedW: 2.4, envelope: { x: 0.025, y: 0.08, z: 0.08 }, source: "sanyo-san-ace-80-9ga" };
const COPPER = "copper-c11000";
const RHO_CU = 8960; // kg/m³, the library's copper-c11000 density (materials/index.js)
// ASTM B258 nominal diameters (in) of AWG 14 and 24 solid conductors: 0.0641 and 0.0201.
const AWG = { 14: 0.0641 * IN, 24: 0.0201 * IN };

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
      drawing: { number: "CK-GA-SENTINEL-M1" },
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
  add({ id: "compute", kind: "Part", name: `${COMPUTE_SYSTEM.model}: ${COMPUTE.model}`, position: pos(0, 0, 2.4),
    props: { envelope: COMPUTE_SYSTEM.envelope, ...sourcedMass(COMPUTE_SYSTEM.massKg, COMPUTE_SYSTEM.source, "MIC-733-A06A1 (AGX Orin 64G), core module without the MIC-75M10 iModule"),
      covers: ["Jetson AGX Orin 64GB module", "carrier board", "thermal solution (fanless)"], serviceAccess: { face: "+x", depth: 0.05 },
      load: { rail: "compute", typicalW: { value: COMPUTE.modeW, state: "sourced", source: COMPUTE.source }, peakW: { value: COMPUTE.maxW, state: "sourced", source: COMPUTE.source }, note: "module power (NVIDIA); the MIC-733 carrier and I/O draw is not stated in its data sheet: not included" } } });
  mate("compute", "torso-l"); mate("compute", "torso-r");
  add({ id: "camera", kind: "Sensor", name: CAMERA.model, position: pos(0.06, 0, 2.785),
    props: { envelope: CAMERA.envelope, mass: `${CAMERA.massKg} kg`, massState: { ...sourcedMass(CAMERA.massKg, CAMERA.source, "D455 (bulk, without the 2.3 g USB cap)").massState, uncertainty: { pct: CAMERA.tolerancePct }, tolerance: "the data sheet states ±10 % from the nominal" },
      load: { rail: "sensors", typicalW: { value: CAMERA.maxW, state: "sourced", source: CAMERA.source, basis: "all components at max operating mode (an upper bound for the typical draw)" } } } });
  mate("camera", "shoulder");
  add({ id: "imu", kind: "Sensor", name: IMU.model, position: pos(0, 0, 1.925),
    props: { envelope: IMU.envelope, ...sourcedMass(IMU.massKg, IMU.source, "MTi-630 module (28 × 31.5 × 13 mm)"),
      load: { rail: "sensors", typicalW: { value: IMU.maxW, state: "sourced", source: IMU.source, basis: "typical < 0.5 W: 0.5 W taken (upper bound)" } } } });
  mate("imu", "pelvis");
  for (const [i, y] of [[1, 0.045], [2, -0.045]]) {
    add({ id: `fan-${i}`, kind: "Part", name: `controller/driver bay fan ${i}: ${FAN.model}`, position: pos(-0.06, y, 1.96),
      props: { envelope: FAN.envelope, ...sourcedMass(FAN.massKg, FAN.source, "9GA0824P4H001, San Ace 80 9GA 80 × 80 × 25 mm"),
        load: { rail: "thermal", typicalW: { value: FAN.ratedW, state: "sourced", source: FAN.source, basis: "rated input at 100 % PWM (an upper bound); two fans is a design choice, airflow not yet sized by a thermal model" } } } });
    mate(`fan-${i}`, "pelvis");
  }
  add({ id: "battery", kind: "Part", name: `battery 13S${batteryParallel}P ${CELL.model}`, position: pos(-0.09, 0, 2.05),
    props: { battery: { series: 13, parallel: batteryParallel, cell: CELL,
      enclosure: { material: "aluminum-6061-t6", sheetM: 0.0015, gapM: 0.001, extraHeightM: 0.01, basis: "design choice: 1.5 mm 6061 sheet box around the 13S × nP cell grid (1 mm between cells, 10 mm above the cells for the interconnects and the BMS sense leads); mass computed, so it follows the battery's size" }, usableFraction: { value: 0.8, state: "estimated", range: [0.7, 0.9], basis: "usable window not in the cell datasheet; to be measured by rundown (spec 3.2)" }, reserveFraction: { value: 0.15, state: "requirement", basis: "reserve held back for safe-stop (not available to the mission)" } },
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
  // Battery management board and the cell interconnects: no part selected, no data-sheet mass retrieved.
  add({ id: "bms", kind: "Part", name: "battery BMS board (13S, ~60 A class) and cell interconnects (not selected)", position: pos(-0.12, 0, 1.97),
    props: { envelope: { x: 0.08, y: 0.06, z: 0.015 }, mass: "0.3 kg",
      massState: { state: "estimated", method: "engineering estimate: a 13S BMS board for ~60 A (one leg's three actuator peaks, 57 A) with its FET heatsink (~0.15-0.35 kg) plus nickel-strip interconnects for 65 cells (~0.5 g each); no part selected and no data-sheet mass retrieved, so the range is deliberately wide", uncertainty: { lowKg: 0.12, highKg: 0.6 } } } });
  mate("bms", "battery");
  // Actuator mounts: two 6061 side plates per joint (100 × 6 × 100 mm), one each side of the actuator.
  for (const [s, y] of [["l", 0.2], ["r", -0.2]]) {
    for (const [j, z] of [["ankle", 0.066], ["knee", 0.939], ["hip", 1.817]]) {
      for (const [k, dy] of [["a", 0.034], ["b", -0.034]]) {
        const id = `mount-${j}-${s}${k}`;
        add({ id, kind: "Plate", name: `${j} ${s} actuator side plate ${k}`, material: FRAME, geometry: { shape: "box", length: "0.1 m", width: "0.006 m", height: "0.1 m" }, position: pos(0, y + dy, z), props: { designChoice: "actuator side plate 100 × 100 × 6 mm 6061-T6 (mass computed)" } });
        mate(id, `${j}-${s}`);
        for (const t of j === "ankle" ? [`shin-${s}`, `foot-${s}`] : j === "knee" ? [`shin-${s}`, `thigh-${s}`] : [`thigh-${s}`, "pelvis"]) mate(id, t);
      }
    }
  }
  // Solar panel mount: two 1" × 0.065" 6061 rails behind the panel and four stand-offs to the torso uprights.
  for (const [s, y] of [["l", 0.12], ["r", -0.12]]) {
    add({ id: `panel-rail-${s}`, kind: "Beam", name: `solar panel rail ${s}`, material: FRAME, geometry: { ...tube("sq-1x0.065"), length: "1 m" }, position: pos(-0.169, y, 2.3), props: { axis: "z", section: "sq-1x0.065" } });
    mate(`panel-rail-${s}`, "solar");
    for (const [k, z] of [["lo", 1.95], ["hi", 2.65]]) {
      add({ id: `panel-standoff-${s}${k}`, kind: "Beam", name: `solar panel stand-off ${s} ${k}`, material: FRAME, geometry: { ...tube("sq-1x0.065"), length: "0.1309 m" }, position: pos(-0.0909, y, z), props: { axis: "x", section: "sq-1x0.065" } });
      mate(`panel-standoff-${s}${k}`, `panel-rail-${s}`); mate(`panel-standoff-${s}${k}`, `torso-${s}`);
    }
  }
  // Harness: actuator power (2 × AWG 14 per actuator) and one CAN pair (2 × AWG 24) per leg, battery to each
  // joint along the torso and leg; copper mass computed, insulation, connectors and sleeving estimated.
  const bat0 = { x: -0.09, y: 0, z: 2.05 };
  const runs = [];
  for (const y of [0.2, -0.2]) {
    for (const z of [1.817, 0.939, 0.061]) runs.push({ len: Math.abs(bat0.x) + Math.abs(y) + (bat0.z - z), conductors: 2, d: AWG[14], mid: { x: bat0.x / 2, y, z: (bat0.z + z) / 2 } });
    runs.push({ len: Math.abs(bat0.x) + Math.abs(y) + (bat0.z - 0.061), conductors: 2, d: AWG[24], mid: { x: bat0.x / 2, y, z: (bat0.z + 0.061) / 2 } });
  }
  const cu = runs.map((r) => ({ ...r, kg: r.len * r.conductors * (Math.PI / 4) * r.d * r.d * RHO_CU }));
  const cuKg = cu.reduce((t, r) => t + r.kg, 0);
  const cg = ["x", "y", "z"].map((k) => cu.reduce((t, r) => t + r.kg * r.mid[k], 0) / cuKg);
  const harnessKg = +(cuKg * 1.8).toFixed(4);
  add({ id: "wiring", kind: "Part", name: "wiring harness (actuator power + CAN)", position: pos(cg[0], cg[1], cg[2]),
    props: { distributed: true, mass: `${harnessKg} kg`,
      massState: { state: "estimated", method: `copper computed: ${cu.reduce((t, r) => t + r.len * r.conductors, 0).toFixed(3)} m of conductor (2 × AWG 14 per actuator for 19 A peaks, 2 × AWG 24 CAN per leg; ASTM B258 nominal diameters) × ${RHO_CU} kg/m³ (${COPPER}) = ${cuKg.toFixed(4)} kg; × 1.8 for insulation, connectors and sleeving (estimated, range × 1.4 to × 3.0); the LiDAR, camera and compute cables (VLP-16 mass excludes its cabling and interface box) are inside the range, not itemised. Wire gauge is a design choice; ampacity not checked`, uncertainty: { lowKg: +(cuKg * 1.4).toFixed(4), highKg: +(cuKg * 3.0).toFixed(4) } },
      centroid: "copper-mass-weighted midpoint of the runs (computed)" } });
  add({ id: "fasteners", kind: "Part", name: "fasteners (actuator, plate, tube-clamp and panel bolts)", position: pos(0, 0, 0.94),
    props: { distributed: true, mass: "0.5 kg",
      massState: { state: "estimated", method: "engineering estimate: ~150 M4-M6 steel screws, nuts and washers (≈ 2-5 g each) for 6 actuators × 2 side plates, the tube joints and the panel mount; no fastener schedule exists", uncertainty: { lowKg: 0.25, highKg: 1.0 } },
      centroid: "estimated: the actuator stack's mean height (most bolts are at the joints)" } });
  // Armor cage: not fitted on Milestone 1 (a stated design decision, reversible): spec 4.1 lists the M1 mission
  // (stand, walk at low speed, carry the payload, sense, stop safely) and 4.2 makes the 600 lb cage "Unknown ...
  // a component line, not a capability". Its mass is not zero and not unknown: it is not in this design.
  add({ id: "armor", kind: "Part", name: "armor cage (spec 4.2)", props: { notFitted: { reason: "Milestone 1 does not fit an armor cage: spec 4.1 mission (stand, walk, carry the payload, sense, stop safely); spec 4.2 lists the 600 lb cage as Unknown, a component line, not a capability. Design decision for the owner to reverse; the leg's load-to-limit says how much it could carry." } } });
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

// Solvers that don't apply to a component-list design: mass.cg and
// mass.assembly need geometry × density for every body, and most bodies here
// carry a data-sheet or estimated mass instead (actuators, cells, compute,
// sensors, harness). mass.budget replaces them: every mass with its state,
// the CG, the band, and any unknown named.
export const EXCLUDED_SOLVERS = [
  { id: "mass.cg", reason: "needs geometry for every body; most Sentinel bodies have a data-sheet or estimated mass instead (mass.budget gives the total, CG and band with each mass's state)" },
  { id: "mass.assembly", reason: "as mass.cg: it sums geometry-derived masses; mass.budget gives the total" },
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
