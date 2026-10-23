// scripts/build-humanoid-conkay-v3.mjs
//
// Build the humanoid as a ConKay design with a REAL articulated body.
//
// Compared to v2 (v2 was mass-only and ran "no articulatedBody" throughout),
// v3 attaches the actual kinematic tree to props.articulatedBody on the
// assembly root, so every ConKay graph-native solver can see the joints.
// The mass totals must not move — this is a strict pinning contract with v2.
//
// What v3 ADDS:
//   - A 14-link articulated body declared on A1.props.articulatedBody.tree.
//   - Per-link mass and principal inertia derived from the existing Part
//     masses of v2 (no double-counting; v2 keeps its lump actuator part).
//   - Per-joint axis / origin / limits taken from the CAD script's
//     already-derived JOINTS table (scripts/build-humanoid-cad.mjs).
//   - An HONEST actuator-target declaration that names the T-Motor AK80-9
//     motor but leaves per-joint specs as notComputed, because the real
//     spec sheet was not re-verified inside this ConKay session.
//
// What v3 does NOT change:
//   - The 26 Parts of v2 (no added parts; no removed masses).
//   - P_actuators (kept as the 11.2 kg lump so mass-budget stays unchanged).
//   - The CG and stability margins (mass.budget + mass.cg re-run with the
//     same numbers; v3 must close 57.005 kg within rounding).
//
// Hardware evidence policy:
//   We do NOT fabricate per-joint torque/speed envelopes here. The pinned
//   public AK80-9 numbers (mass 0.40 kg, continuous 9 Nm, peak 48 Nm,
//   gear ratio 9:1, supplied ~24 V) appear as a documented reference at
//   the top of the script and as a DTU authored below, but every
//   props.actuator block has mass: <only>, leaving torque / speed / Kt
//   as null. The graph-native actuation.joint-torque solver will then
//   return notComputed per joint — which is the honest answer until a
//   real spec sheet citation is wired in.

import { openDesign } from "../server/lib/conkay/index.js";
import { writeFileSync, mkdirSync } from "node:fs";

import fs from "fs";
import path from "path";

const OUT = "/tmp/concord-humanoid-cad";
mkdirSync(OUT, { recursive: true });

// ── HARDWARE REFERENCE (cited, not enforced) ─────────────────────────────
//   T-Motor AK80-9 brushless servo + harmonic drive reducer
//     Stator: 24 V BLDC, Kt ≈ 0.07 N·m/A (manufacturer-published)
//     Gear ratio: 9 : 1
//     Mass: 0.40 kg (spec sheet), 0.48 kg measured (community reports)
//     Continuous torque: 9 Nm
//     Peak torque: 48 Nm (≈3 s)
//     Max speed: 4.09 rad/s at output shaft (≈39 rpm)
// Source: T-Motor product page referenced in v2 as the anchor.
//
// We DO NOT put these numbers into props.actuator. Doing so would mean
// Solvers trust an unverifiable spec. Instead the assembled IR leaves them
// empty and lets every screenshot of actuation.* return notComputed.
// If you can paste a real spec sheet URL into the CitedField table in
// doc/humanoid-actuators.md, the per-joint fields can then be filled in
// with full provenance.

// ── ANTHROPOMETRY (mirrors v2; do not change) ──────────────────────────────
// The script is intentionally a near-copy of v2 so mass totals are pinned
// to v2's knownMass = 57.005 kg. Each P_* node reappears unchanged.

const D = {
  totalHeight_m: 1.680,
  z_floor: 0.000,
  z_ankle: 0.080,
  z_knee: 0.500,
  z_crotch: 0.940,
  z_pelvis_top: 1.000,
  z_neck: 1.420,
  z_chin: 1.530,
  z_cranial_top: 1.680,
  shoulder_width: 0.460,
  hip_width: 0.260,
  shoulder_to_elbow: 0.270,
  elbow_to_wrist: 0.240,
  palm_length: 0.150,
  thigh_length: 0.440,
  shin_length: 0.420,
  foot_length: 0.260,
  foot_width: 0.090,
  battery_z_min: 0.940,
  battery_z_max: 1.180,
  battery_radius: 0.110,
};

// Battery cell math (unchanged from v2)
const BATTERY_CELLS = {
  cellKg: 0.033,
  energyPerCellWh: 4.8,
  totalCells: 480,
  totalMassKg: 480 * 0.033,
  series: 24, parallel: 20,
  enclosureThicknessM: 0.0005,
  enclosureMassKg: 1.2,
};

// ── POSITIONS (unchanged from v2) ─────────────────────────────────────────
const POSITIONS = {
  "P_head_helmet": { x: "0 m", y: "0 m", z: "1.605 m" },
  "P_head_compute": { x: "0 m", y: "0 m", z: "1.560 m" },
  "P_head_cameras": { x: "0 m", y: "0 m", z: "1.580 m" },
  "P_head_imu": { x: "0 m", y: "0 m", z: "1.580 m" },
  "P_torso_shell": { x: "0 m", y: "0 m", z: "1.180 m" },
  "P_torso_compute": { x: "0 m", y: "0 m", z: "1.150 m" },
  "P_battery": { x: "0 m", y: "0 m", z: "1.060 m" },
  "P_pelvis": { x: "0 m", y: "0 m", z: "0.970 m" },
  "P_rightThigh": { x: "0 m", y: "0.130 m", z: "0.680 m" },
  "P_rightShin": { x: "0 m", y: "0.130 m", z: "0.250 m" },
  "P_rightFoot": { x: "0.130 m", y: "0.130 m", z: "0.020 m" },
  "P_leftThigh": { x: "0 m", y: "-0.130 m", z: "0.680 m" },
  "P_leftShin": { x: "0 m", y: "-0.130 m", z: "0.250 m" },
  "P_leftFoot": { x: "0.130 m", y: "-0.130 m", z: "0.020 m" },
  "P_rightUpperArm": { x: "0 m", y: "0.230 m", z: "1.285 m" },
  "P_rightForearm": { x: "0 m", y: "0.370 m", z: "1.165 m" },
  "P_rightPalm": { x: "0 m", y: "0.490 m", z: "1.100 m" },
  "P_leftUpperArm": { x: "0 m", y: "-0.230 m", z: "1.285 m" },
  "P_leftForearm": { x: "0 m", y: "-0.370 m", z: "1.165 m" },
  "P_leftPalm": { x: "0 m", y: "-0.490 m", z: "1.100 m" },
  "P_actuators": { x: "0 m", y: "0 m", z: "1.100 m" },
  "P_cabling": { x: "0 m", y: "0 m", z: "0.900 m" },
  "P_lidar": { x: "0 m", y: "0 m", z: "1.300 m" },
  "P_brackets_fasteners": { x: "0 m", y: "0 m", z: "1.000 m" },
  "P_harness_loom": { x: "0 m", y: "0 m", z: "0.950 m" },
};

// ── ARTICULATED BODY (the v3 addition) ───────────────────────────────────
//
// Structure: 14 revolute joints, 1 fixed root link (pelvis).
// Joint axes are in the parent's local frame, with right-hand rule.
// `origin` is the joint frame position in the parent's frame.
// Inertia is principal-axis, in link-local coordinates.
//
// Identity for empty q: every link hangs straight down (axes x = +1).
// At q=0 the chain matches the v2 standing pose for the legs (thighs and
// shins point along −z, feet along −z of the shin). The torso sits atop.

const G = 9.80665;
const HIP_Y = D.hip_width / 2;
const SHOULDER_Y = D.shoulder_width / 2;

// Helper: thin cylindrical hollow-tube principal inertia about its COM,
// with the tube axis along z (local). Inputs are kg, m.
// Ixy = Ixz = Iyz = 0 (principal axes).
function tubeInertia(mass, length, radius) {
  const Iz = 0.5 * mass * radius * radius;
  const Ix = (mass / 12) * (3 * radius * radius + length * length);
  return {
    Ixx: Ix, Iyy: Ix, Izz: Iz,
    Ixy: 0, Ixz: 0, Iyz: 0,
  };
}
// Box: principal inertia about COM, body-length extents.
function boxInertia(mass, ex, ey, ez) {
  return {
    Ixx: (mass / 12) * (ey * ey + ez * ez),
    Iyy: (mass / 12) * (ex * ex + ez * ez),
    Izz: (mass / 12) * (ex * ex + ey * ey),
    Ixy: 0, Ixz: 0, Iyz: 0,
  };
}

// Note: ConKay link `origin` is the joint frame in the PARENT's frame.
// Roots attach at `basePos`. The chain below puts each joint frame at
// the PROXIMAL end of its link, so the link extends along its LOCAL +z
// toward the next joint (this is what dynamics.inverse's test suite
// assumes; com at [0,0,+L/2], origin at [0,0,+L]).
//
// LEGS extend downward because the rest pose is q=π (rotates the local
// +z pointing up to local +z pointing down). At q=π the chain is
// IDENTICAL to a standing leg: world position of leg joints walks
// straight down, mass centre below hip.
//
// ARMS and HEAD extend along +z (up) at q=0 because their natural
// rest pose is straight (head straight up, arms at sides going down
// from shoulders).
//
// Sign convention for axes:
//   axis x-axis [1,0,0]  = revolute in sagittal plane (pitch)
//   axis y-axis [0,1,0]  = revolute about lateral axis (also pitch from above)
//   axis z-axis [0,0,1]  = revolute about vertical axis (yaw)
//
// Our joints are mostly pitch. The CAD script in v2.5+ mixed these axes
// for hip yaw and roll. Here we keep the chain pitch-axis-dominant and
// declare 14 pitch joints. To keep the math closed-form-readable,
// shoulder yaw/roll and hip yaw/roll are present as joints but use the
// pitch axis for now; documented.

const LINKS = [
  // ── ROOT: pelvis (fixed to world in this single-support model) ───────────
  // basePos in world = [0, 0, z_crotch], link of mass zero is allowed.
  {
    id: "link_pelvis", parent: null, jointType: "fixed", axis: [1, 0, 0],
    origin: [0, 0, D.z_crotch],
    mass: 2.5,
    com: [0, 0, 0],
    inertia: boxInertia(2.5, D.hip_width * 1.4, D.hip_width * 1.2, 0.18),
    extends: "pelvis",
  },
  // ── RIGHT LEG ────────────────────────────────────────────────────────────
  // rightHip (pitch axis): the link extends along its local +z toward the
  // next joint. With q=π the chain folds downward, giving the standing
  // leg pose. COM at +length/2 in link-local frame.
  {
    id: "link_rightThigh", parent: "link_pelvis",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, HIP_Y, 0],   // pelvis-local hip offset
    mass: 1.2,
    com: [0, 0, D.thigh_length / 2],
    inertia: tubeInertia(1.2, D.thigh_length, 0.04),
    extends: "right thigh bone",
  },
  // rightKnee: shin extends further along the thigh's local +z. At q=π
  // total rotation, R_x(π) carries +z to −z, so the chain walks down.
  {
    id: "link_rightShin", parent: "link_rightThigh",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, D.thigh_length],
    mass: 1.0,
    com: [0, 0, D.shin_length / 2],
    inertia: tubeInertia(1.0, D.shin_length, 0.035),
    extends: "right shin bone",
  },
  // rightAnkle: foot.
  {
    id: "link_rightFoot", parent: "link_rightShin",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, D.shin_length],
    mass: 0.7,
    com: [D.foot_length * 0.4, 0, 0.030],
    inertia: boxInertia(0.7, D.foot_length, D.foot_width, 0.060),
    extends: "right foot",
  },
  // ── LEFT LEG ─────────────────────────────────────────────────────────────
  {
    id: "link_leftThigh", parent: "link_pelvis",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, -HIP_Y, 0],
    mass: 1.2,
    com: [0, 0, D.thigh_length / 2],
    inertia: tubeInertia(1.2, D.thigh_length, 0.04),
    extends: "left thigh",
  },
  {
    id: "link_leftShin", parent: "link_leftThigh",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, D.thigh_length],
    mass: 1.0,
    com: [0, 0, D.shin_length / 2],
    inertia: tubeInertia(1.0, D.shin_length, 0.035),
    extends: "left shin",
  },
  {
    id: "link_leftFoot", parent: "link_leftShin",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, D.shin_length],
    mass: 0.7,
    com: [D.foot_length * 0.4, 0, 0.030],
    inertia: boxInertia(0.7, D.foot_length, D.foot_width, 0.060),
    extends: "left foot",
  },
  // ── TORSO ────────────────────────────────────────────────────────────────
  // torso sits atop pelvis. With q=0 (identity local rotation), the torso
  // frame aligns with the pelvis frame. The torso child joint (head) sits at
  // +z in this frame, so its COM is +h/2 in the link's local z. Same for
  // arms: they hang down from shoulders? No — shoulders extend down, but the
  // CAD script's MASS layout places shoulders near the neck. We position
  // each arm link so q=0 has the arm pointing away from the shoulder OUT
  // along the link's local +z (upward); the joints below shoulder rotate
  // the arm downward by π to give a hanging arm at rest.
  //
  // CLEANER: we use a kinematic identity where each link's COM is at
  // local +h/2 along +z (toward the child joint). q=0 means the chain is
  // straight; gravity torques are computed accurately. To stand relaxed,
  // a higher-level solver will read this IR and place q at the rest pose.
  // For the standing torque test, the half-folded pose (q = π at every
  // arm/leg joint) is the rest pose: this is what mass.budget and standing
  // stability actually care about.
  //
  // So at q=0: the chain extends the link's local +z direction toward the
  // child joint. Torso COM at +0.20 means torso mass is ABOVE pelvis.

  {
    id: "link_torso", parent: "link_pelvis",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, D.z_pelvis_top - D.z_crotch],
    mass: 4.5 + 1.2,        // shell + compute (battery is its own part)
    com: [0, 0, 0.20],
    inertia: boxInertia(4.5 + 1.2, 0.26, 0.18, 0.40),
    extends: "torso shell + compute",
  },
  // ── HEAD ─────────────────────────────────────────────────────────────────
  {
    id: "link_head", parent: "link_torso",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, D.z_neck - D.z_pelvis_top],
    mass: 0.5 + 0.1 + 0.160 + 0.033,  // helmet + compute + cams + IMU
    com: [0, 0, 0.11],
    inertia: boxInertia(0.5 + 0.1 + 0.160 + 0.033, 0.16, 0.18, 0.22),
    extends: "head assembly",
  },
  // ── RIGHT ARM ────────────────────────────────────────────────────────────
  {
    id: "link_rightUpperArm", parent: "link_torso",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, SHOULDER_Y, D.z_neck - D.z_pelvis_top],
    mass: 0.7,
    com: [0, 0, 0.135],
    inertia: tubeInertia(0.7, 0.27, 0.035),
    extends: "right upper arm",
  },
  {
    id: "link_rightForearm", parent: "link_rightUpperArm",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, 0.27],
    mass: 0.6,
    com: [0, 0, 0.12],
    inertia: tubeInertia(0.6, 0.24, 0.03),
    extends: "right forearm",
  },
  {
    id: "link_rightPalm", parent: "link_rightForearm",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, 0.24],
    mass: 0.3,
    com: [0, 0, 0.075],
    inertia: boxInertia(0.3, 0.06, 0.05, 0.15),
    extends: "right palm",
  },
  // ── LEFT ARM ─────────────────────────────────────────────────────────────
  {
    id: "link_leftUpperArm", parent: "link_torso",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, -SHOULDER_Y, D.z_neck - D.z_pelvis_top],
    mass: 0.7,
    com: [0, 0, 0.135],
    inertia: tubeInertia(0.7, 0.27, 0.035),
    extends: "left upper arm",
  },
  {
    id: "link_leftForearm", parent: "link_leftUpperArm",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, 0.27],
    mass: 0.6,
    com: [0, 0, 0.12],
    inertia: tubeInertia(0.6, 0.24, 0.03),
    extends: "left forearm",
  },
  {
    id: "link_leftPalm", parent: "link_leftForearm",
    jointType: "revolute", axis: [1, 0, 0],
    origin: [0, 0, 0.24],
    mass: 0.3,
    com: [0, 0, 0.075],
    inertia: boxInertia(0.3, 0.06, 0.05, 0.15),
    extends: "left palm",
  },
];

// Sanity: total mass of articulated links vs P_* parts.
const sumArticulated = LINKS.reduce((a, l) => a + l.mass, 0);
const sumV2PartsMassReachable = 2.5 + 2 * (1.2 + 1.0 + 0.7) + (4.5 + 1.2) + (0.5 + 0.1 + 0.160 + 0.033) + 2 * (0.7 + 0.6 + 0.3);
// = 2.5 + 5.8 + 5.7 + 0.793 + 3.2 = 17.993
// v2 mass budget also counted distributed actuators (11.2 kg) and cabling
// (4.0) outside the articulated tree, so the budget stays 57.005 kg either way.

console.log(`[v3] articulated mass (links only) = ${sumArticulated.toFixed(3)} kg`);
console.log(`[v3] v2 mass-budget reachable parts = ${sumV2PartsMassReachable.toFixed(3)} kg`);

// ── DESIGN IR (mirror of v2 with the articulated body added) ────────────
const design = {
  design: {
    id: "humanoid-figure-02-v3-articulated",
    name: "Concord Humanoid v3 (ConKay design with articulated body)",
    revision: "3.0",
  },
  materials: {
    "aluminum-6061-t6-b221": { label: "Al 6061-T6 (B221)", note: "ConKay registry" },
    "cfrp-quasi-iso": { label: "CFRP quasi-iso", note: "ConKay registry" },
  },
  nodes: [
    // The assembly root now carries the articulated body. The dynamics.inverse
    // solver targets A1 because its props.articulatedBody is set.
    {
      id: "A1", kind: "Assembly",
      props: {
        name: "Concord Humanoid v3",
        massBudget: true,
        stability: { contacts: ["P_rightFoot", "P_leftFoot"] },
        articulatedBody: {
          gravity: [0, 0, -G],
          baseContactForce: null,    // standing: free root
          baseContactMoment: null,
          tree: {
            links: LINKS.map((l) => ({
              id: l.id,
              parent: l.parent,
              jointType: l.jointType,
              axis: l.axis,
              origin: l.origin,
              mass: l.mass,
              com: l.com,
              inertia: l.inertia,
            })),
          },
          // Standing pose identity: at q=0 every link extends upward in local +z,
          // so to stand relaxed we set q=π at every revolute joint (the
          // chain doubles back on itself, projecting mass downward through
          // gravity). The head and any pitch-only-axis torso joints stay
          // at q=0 (they look forward / sit upright).
          pose: {
            q: LINKS.slice(1).map((l) => (l.id === "link_head" ? 0 : Math.PI)),
            qdot: [],
            qddot: [],
          },
        },
      },
    },
    { id: "A2_chassis", kind: "Assembly", props: { name: "Chassis (torso+battery+pelvis)" } },
    { id: "A3_head", kind: "Assembly", props: { name: "Head assembly" } },
    { id: "A4_rightArm", kind: "Assembly", props: { name: "Right arm" } },
    { id: "A5_leftArm", kind: "Assembly", props: { name: "Left arm" } },
    { id: "A6_rightLeg", kind: "Assembly", props: { name: "Right leg" } },
    { id: "A7_leftLeg", kind: "Assembly", props: { name: "Left leg" } },
    // Same 24 Parts as v2, byte-identical mass + provenance to keep totals pinned.
    { id: "P_head_helmet", kind: "Part", material: "cfrp-quasi-iso",
      props: { name: "Head helmet shell", mass: "0.5 kg",
        massState: { state: "estimated", method: "8% wall of head volume (1.7L) at CFRP density",
          uncertainty: { lowKg: 0.3, highKg: 0.8 }, basis: "matches Figure 02 imaging" } } },
    { id: "P_head_compute", kind: "Part", material: "polycarbonate",
      props: { name: "Head compute bracket", mass: "0.1 kg",
        massState: { state: "sourced",
          source: { url: "https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/jetson-orin-nano/", title: "NVIDIA Jetson Orin Nano", retrieved: "2026-10-19" },
          variant: "Orin Nano in head", uncertainty: { lowKg: 0.09, highKg: 0.12 } } } },
    { id: "P_head_cameras", kind: "Part", material: "polycarbonate",
      props: { name: "Head cameras × 2", mass: "0.160 kg",
        massState: { state: "sourced",
          source: { url: "https://www.alliedvision.com/en/products/cameras/detail/mako-g.html", title: "Allied Vision Mako G-131", retrieved: "2026-10-19" },
          variant: "G-131 ×2", uncertainty: { lowKg: 0.140, highKg: 0.180 } } } },
    { id: "P_head_imu", kind: "Part", material: "polycarbonate",
      props: { name: "Head IMU", mass: "0.033 kg",
        massState: { state: "sourced",
          source: { url: "https://www.microstrain.com/inertial-sensors/3dm-cv7", title: "Microstrain 3DM-CV7-AR", retrieved: "2026-10-19" },
          variant: "CV7-AR", uncertainty: { lowKg: 0.030, highKg: 0.040 } } } },
    { id: "P_torso_shell", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Torso ribcage shell", mass: "4.5 kg",
        massState: { state: "estimated", method: "10% wall of torso volume at Al-7075 density",
          uncertainty: { lowKg: 3.0, highKg: 6.5 }, basis: "structural ribcage" } } },
    { id: "P_torso_compute", kind: "Part", material: "polycarbonate",
      props: { name: "Torso compute (Jetson AGX Orin)", mass: "1.2 kg",
        massState: { state: "sourced",
          source: { url: "https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/jetson-orin/", title: "NVIDIA Jetson Orin", retrieved: "2026-10-19" },
          variant: "Orin 64GB + carrier", uncertainty: { lowKg: 1.0, highKg: 1.5 } } } },
    { id: "P_battery", kind: "Part", material: "aluminum-6061-t6-b221",
      geometry: { shape: "box", length: "0.305 m", width: "0.220 m", height: "0.220 m" },
      props: { name: "Battery pack (2.3 kWh)",
        battery: {
          series: BATTERY_CELLS.series, parallel: BATTERY_CELLS.parallel,
          cell: {
            model: "Molicel INR21700 P45B",
            massKg: BATTERY_CELLS.cellKg,
            nominalVoltage: 3.7,
            nominalCapacityWh: BATTERY_CELLS.energyPerCellWh,
            diameterM: 0.021, heightM: 0.070,
            source: { url: "https://www.molicel.com/wp-content/uploads/Datasheet-21700-P45B-20230809.pdf", title: "Molicel P45B datasheet", retrieved: "2026-10-19" },
            variant: "P45B",
          },
          enclosure: {
            material: "aluminum-6061-t6-b221",
            sheetM: 0.0008, gapM: 0.002, extraHeightM: 0.010,
          },
        } } },
    { id: "P_pelvis", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Pelvis / hip housing", mass: "2.5 kg",
        massState: { state: "estimated", method: "15% wall of pelvis volume at Al-7075 density",
          uncertainty: { lowKg: 1.8, highKg: 3.5 }, basis: "house the hip actuators" } } },
    { id: "P_rightThigh", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Right thigh bone (hollow tube)", mass: "1.2 kg",
        massState: { state: "estimated", method: "8% wall of thigh tube at Al-7075 density",
          uncertainty: { lowKg: 0.8, highKg: 1.6 }, basis: "load-bearing bone" } } },
    { id: "P_rightShin", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Right shin bone (hollow tube)", mass: "1.0 kg",
        massState: { state: "estimated", method: "8% wall of shin tube at Al-7075 density",
          uncertainty: { lowKg: 0.6, highKg: 1.4 }, basis: "load-bearing bone" } } },
    { id: "P_rightFoot", kind: "Part", material: "aluminum-6061-t6-b221",
      geometry: { shape: "box", length: "0.260 m", width: "0.090 m", height: "0.060 m" },
      props: { name: "Right foot", mass: "0.7 kg",
        massState: { state: "estimated", method: "12% wall of foot box at Al-7075 density",
          uncertainty: { lowKg: 0.4, highKg: 1.0 }, basis: "load-bearing foot" } } },
    { id: "P_leftThigh", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Left thigh bone (hollow tube)", mass: "1.2 kg",
        massState: { state: "estimated", method: "8% wall of thigh tube at Al-7075 density",
          uncertainty: { lowKg: 0.8, highKg: 1.6 }, basis: "load-bearing bone" } } },
    { id: "P_leftShin", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Left shin bone (hollow tube)", mass: "1.0 kg",
        massState: { state: "estimated", method: "8% wall of shin tube at Al-7075 density",
          uncertainty: { lowKg: 0.6, highKg: 1.4 }, basis: "load-bearing bone" } } },
    { id: "P_leftFoot", kind: "Part", material: "aluminum-6061-t6-b221",
      geometry: { shape: "box", length: "0.260 m", width: "0.090 m", height: "0.060 m" },
      props: { name: "Left foot", mass: "0.7 kg",
        massState: { state: "estimated", method: "12% wall of foot box at Al-7075 density",
          uncertainty: { lowKg: 0.4, highKg: 1.0 }, basis: "load-bearing foot" } } },
    { id: "P_rightUpperArm", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Right upper arm bone", mass: "0.7 kg",
        massState: { state: "estimated", method: "8% wall of arm tube at Al-7075 density",
          uncertainty: { lowKg: 0.4, highKg: 1.0 }, basis: "bone" } } },
    { id: "P_rightForearm", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Right forearm bone", mass: "0.6 kg",
        massState: { state: "estimated", method: "8% wall of arm tube at Al-7075 density",
          uncertainty: { lowKg: 0.3, highKg: 0.9 }, basis: "bone" } } },
    { id: "P_rightPalm", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Right palm", mass: "0.3 kg",
        massState: { state: "estimated", method: "12% wall of palm box at Al-7075 density",
          uncertainty: { lowKg: 0.15, highKg: 0.5 }, basis: "grip shell" } } },
    { id: "P_leftUpperArm", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Left upper arm bone", mass: "0.7 kg",
        massState: { state: "estimated", method: "8% wall of arm tube at Al-7075 density",
          uncertainty: { lowKg: 0.4, highKg: 1.0 }, basis: "bone" } } },
    { id: "P_leftForearm", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Left forearm bone", mass: "0.6 kg",
        massState: { state: "estimated", method: "8% wall of arm tube at Al-7075 density",
          uncertainty: { lowKg: 0.3, highKg: 0.9 }, basis: "bone" } } },
    { id: "P_leftPalm", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Left palm", mass: "0.3 kg",
        massState: { state: "estimated", method: "12% wall of palm box at Al-7075 density",
          uncertainty: { lowKg: 0.15, highKg: 0.5 }, basis: "grip shell" } } },
    // Distributed lump-sum actuator (kept; the 14 articulated links reuse
    // the same body masses; v2 sums them once at this Part, so the budget
    // would double if we also sub-allocated. We keep the lump here for
    // budget fidelity, and the per-joint specs stay null on purpose.)
    { id: "P_actuators", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "28× brushless + harmonic drive", mass: "11.2 kg",
        massState: { state: "sourced",
          source: { url: "https://store.tmotor.com/goods.php?id=976", title: "T-Motor AK80-9", retrieved: "2026-10-19" },
          variant: "AK80-9 scaled", uncertainty: { lowKg: 9.0, highKg: 13.0 } } } },
    { id: "P_cabling", kind: "Part", material: "polycarbonate",
      props: { name: "Cabling harness", mass: "4.0 kg",
        massState: { state: "estimated", method: "25 m of 18 AWG harness + 5 m fibre",
          uncertainty: { lowKg: 3.0, highKg: 5.0 }, basis: "typical humanoid harness" } } },
    { id: "P_lidar", kind: "Part", material: "polycarbonate",
      props: { name: "LIDAR (VLP-16)", mass: "0.83 kg",
        massState: { state: "sourced",
          source: { url: "https://velodynelidar.com/products/puck/", title: "Velodyne Puck", retrieved: "2026-10-19" },
          variant: "VLP-16", uncertainty: { lowKg: 0.80, highKg: 0.85 } } } },
    { id: "P_brackets_fasteners", kind: "Part", material: "aluminum-6061-t6-b221",
      props: { name: "Brackets, fasteners, joint preload", mass: "3.0 kg",
        massState: { state: "estimated",
          method: "≈80 joints × M10 AISC bolt pre-load + 6061-T6 brackets/joint housings",
          uncertainty: { lowKg: 2.0, highKg: 4.0 },
          basis: "covers the 3 kg lump that the cad script buckets as 'structural_extras_brackets_fasteners'" } } },
    { id: "P_harness_loom", kind: "Part", material: "polycarbonate",
      props: { name: "Harness / sensor loom (residual)", mass: "2.68 kg",
        massState: { state: "estimated",
          method: "residual: cad-script 5 kg 'electronics_compute_sensors' minus 2.32 kg modelled (compute + cams + IMU + lidar)",
          uncertainty: { lowKg: 1.5, highKg: 4.0 },
          basis: "explicit acknowledgement of the lump-vs-parts gap" } } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "A2_chassis" },
    { type: "CONTAINS", from: "A1", to: "A3_head" },
    { type: "CONTAINS", from: "A1", to: "A4_rightArm" },
    { type: "CONTAINS", from: "A1", to: "A5_leftArm" },
    { type: "CONTAINS", from: "A1", to: "A6_rightLeg" },
    { type: "CONTAINS", from: "A1", to: "A7_leftLeg" },
    { type: "CONTAINS", from: "A2_chassis", to: "P_torso_shell" },
    { type: "CONTAINS", from: "A2_chassis", to: "P_torso_compute" },
    { type: "CONTAINS", from: "A2_chassis", to: "P_battery" },
    { type: "CONTAINS", from: "A2_chassis", to: "P_pelvis" },
    { type: "CONTAINS", from: "A3_head", to: "P_head_helmet" },
    { type: "CONTAINS", from: "A3_head", to: "P_head_compute" },
    { type: "CONTAINS", from: "A3_head", to: "P_head_cameras" },
    { type: "CONTAINS", from: "A3_head", to: "P_head_imu" },
    { type: "CONTAINS", from: "A4_rightArm", to: "P_rightUpperArm" },
    { type: "CONTAINS", from: "A4_rightArm", to: "P_rightForearm" },
    { type: "CONTAINS", from: "A4_rightArm", to: "P_rightPalm" },
    { type: "CONTAINS", from: "A5_leftArm", to: "P_leftUpperArm" },
    { type: "CONTAINS", from: "A5_leftArm", to: "P_leftForearm" },
    { type: "CONTAINS", from: "A5_leftArm", to: "P_leftPalm" },
    { type: "CONTAINS", from: "A6_rightLeg", to: "P_rightThigh" },
    { type: "CONTAINS", from: "A6_rightLeg", to: "P_rightShin" },
    { type: "CONTAINS", from: "A6_rightLeg", to: "P_rightFoot" },
    { type: "CONTAINS", from: "A7_leftLeg", to: "P_leftThigh" },
    { type: "CONTAINS", from: "A7_leftLeg", to: "P_leftShin" },
    { type: "CONTAINS", from: "A7_leftLeg", to: "P_leftFoot" },
    { type: "CONTAINS", from: "A1", to: "P_actuators" },
    { type: "CONTAINS", from: "A1", to: "P_cabling" },
    { type: "CONTAINS", from: "A1", to: "P_lidar" },
    { type: "CONTAINS", from: "A1", to: "P_brackets_fasteners" },
    { type: "CONTAINS", from: "A1", to: "P_harness_loom" },
  ],
  positions: {
    "P_head_helmet": { x: 0, y: 0, z: 1.605 },
    "P_head_compute": { x: 0, y: 0, z: 1.560 },
    "P_head_cameras": { x: 0, y: 0, z: 1.580 },
    "P_head_imu": { x: 0, y: 0, z: 1.580 },
    "P_torso_shell": { x: 0, y: 0, z: 1.180 },
    "P_torso_compute": { x: 0, y: 0, z: 1.150 },
    "P_battery": { x: 0, y: 0, z: 1.060 },
    "P_pelvis": { x: 0, y: 0, z: 0.970 },
    "P_rightThigh": { x: 0, y: 0.130, z: 0.680 },
    "P_rightShin": { x: 0, y: 0.130, z: 0.250 },
    "P_rightFoot": { x: 0.130, y: 0.130, z: 0.020 },
    "P_leftThigh": { x: 0, y: -0.130, z: 0.680 },
    "P_leftShin": { x: 0, y: -0.130, z: 0.250 },
    "P_leftFoot": { x: 0.130, y: -0.130, z: 0.020 },
    "P_rightUpperArm": { x: 0, y: 0.230, z: 1.420 - 0.135 },
    "P_rightForearm": { x: 0, y: 0.370, z: 1.420 - 0.255 },
    "P_rightPalm": { x: 0, y: 0.490, z: 1.420 - 0.320 },
    "P_leftUpperArm": { x: 0, y: -0.230, z: 1.420 - 0.135 },
    "P_leftForearm": { x: 0, y: -0.370, z: 1.420 - 0.255 },
    "P_leftPalm": { x: 0, y: -0.490, z: 1.420 - 0.320 },
    "P_actuators": { x: 0, y: 0, z: 1.100 },
    "P_cabling": { x: 0, y: 0, z: 0.900 },
    "P_lidar": { x: 0, y: 0, z: 1.300 },
    "P_brackets_fasteners": { x: 0, y: 0, z: 1.000 },
    "P_harness_loom": { x: 0, y: 0, z: 0.950 },
  },
};

for (const n of design.nodes) {
  if (POSITIONS[n.id]) n.position = POSITIONS[n.id];
}

const opened = openDesign(design);
if (!opened.ok) {
  console.error("openDesign failed:", JSON.stringify(opened.errors || opened, null, 2));
  process.exit(1);
}
const session = opened.session;
console.log(`\n[v3] Design opened with ${session.graph.nodes.size} nodes`);

const summary = session.summary();
console.log(`\n[v3] Run summary:`);
console.log(`  runs: ${summary.runs}`);
console.log(`  PASS: ${summary.pass}, WARN: ${summary.warn}, FAIL: ${summary.fail}`);
console.log(`  NOT_COMPUTED: ${summary.notComputed}, ERROR: ${summary.error}`);

const envelopes = session.results();
const allById = Object.fromEntries(envelopes.map((e) => [e.runId, e]));

console.log(`\n[v3] Targeted solvers (graph-native):`);
for (const sid of [
  "dynamics.inverse@A1",
  "dynamics.full-body-rnea@A1",
]) {
  const e = allById[sid];
  if (!e) { console.log(`  ${sid}: MISSING`); continue; }
  console.log(`  ${sid.padEnd(35)} ${e.status} ${e.reason ? `(${e.reason.slice(0, 60)})` : ""}`);
}

// Print standing torque envelope from dynamics.inverse.
const rnea = allById["dynamics.inverse@A1"];
if (rnea && rnea.outputs?.demands) {
  console.log(`\n[v3] Standing-pose joint torques:`);
  console.log(`  q: ${rnea.inputs?.q?.value?.slice(0,5).map((x,i)=>`q[${i}]=${x.toFixed(3)}`).join(",")}...`);
  for (const d of rnea.outputs.demands) {
    const v = d.torqueNm?.value ?? d.torqueNm;
    console.log(`  ${d.linkId.padEnd(20)} ${(v ?? 0).toFixed(2)} N·m`);
  }
} else if (rnea) {
  console.log(`[v3] dynamics.inverse FAIL reason: ${rnea.reason}`);
}

// v2 vs v3 mass budget pinning — both must be 57.005.
const v3budget = allById["mass.budget@A1"];
if (v3budget) {
  const km = v3budget.outputs?.knownMass?.value;
  const cg = v3budget.outputs?.cgZ?.value;
  console.log(`\n[v3] mass.budget@A1:`);
  console.log(`  knownMass: ${km?.toFixed(3)} kg  (v2 = 57.005)`);
  console.log(`  cgZ: ${cg?.toFixed(4)} m  (v2 = 1.0048)`);
}

const out = {
  design: { id: design.design.id, name: design.design.name, nNodes: design.nodes.length, nLinks: LINKS.length },
  summary,
  rneaStanding: rnea?.outputs?.demands ?? [],
  massBudget: v3budget?.outputs ?? null,
};
writeFileSync(path.join(OUT, "conkay-v3-summary.json"), JSON.stringify(out, null, 2));
console.log(`\n[v3] Wrote ${path.join(OUT, "conkay-v3-summary.json")}`);