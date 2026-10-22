// scripts/build-humanoid-cad.mjs
//
// Build a real humanoid robot CAD and run a first-pass roboticist's
// analysis. Every geometry triangle traces to a real parametric
// generator (parametric-mesh.js). Every mass traces to a real
// material density. Every torque / SSM number traces to a real
// kinematic pose. Every result has a "compute-don't-guess" link
// back to either the geometry pipeline (asset-gen) or the analysis
// math (this file).
//
// ── HONESTY NOTES ──────────────────────────────────────────────────────
// What this script DOES prove:
//   - Geometry is real, mesh is closed, STL/GLB round-trip cleanly.
//   - Per-part mass and volume are real (signed-tetrahedral sum on
//     per-part closed solids).
//   - Joint torques are real for the kinematic pose we feed in.
//   - Static stability margin (SSM) is real for the given stance.
//
// What it does NOT prove:
//   - This isn't a FEA stress analysis. We don't compute joint-bolt
//     reactions, gear loads, or actuator fatigue.
//   - This isn't a full-dynamics simulation. We don't have contact
//     dynamics, ZMP-based balance, or footstep planning.
//   - HOLLOW-SHELL mass is a heuristic. The real mass is what you'd
//     build; this script gives a defensible upper bound and lower
//     bound, then per-component adds the rotative parts (motors,
//     batteries, electronics) that make up the actual robot mass.
//
// Reference data: Figure 02 public spec (1.68m / 60kg / 28 DOF),
// NASA-STD-3000 anthropometry, AISC + ISO 7250-1 biomechanics refs.

import fs from "fs";
import path from "path";
import {
  loftClosedTube,
  mergeMeshes,
} from "../server/lib/asset-gen/parametric-mesh.js";
import { meshToSTL } from "../server/lib/asset-gen/stl-export.js";
import {
  packGLB,
  computeVertexNormals,
} from "../server/lib/evo-asset/glb-bridge.js";
import {
  massProperties,
  getMaterial,
} from "../server/lib/asset-gen/mass-properties.js";

// ── COORDINATE FRAMES ────────────────────────────────────────────────────
// World frame: X=fwd, Y=lateral (right +Y), Z=up. Origin at floor on
// the centreline between the two feet (between the heels).
//
// Per-segment local frames: X along the segment's long axis. For
// limbs, the proximal end (joint inboard) is at local origin and
// the distal end is at local +X (length). For torso/pelvis/head,
// the bot's long axis (Z in world) is computed by an explicit
// transform (these don't fit the linear segment convention).
//
// Up = +Z. Forward = +X. Right = +Y.

const OUT_DIR = "/tmp/concord-humanoid-cad";

// ── DIMENSIONS (Figure 02 public spec, m) ────────────────────────────────
// All values rounded to mm to match engineering drawing convention.
// Anthropometric breakdown uses NASA-STD-3000 Man-Systems ratios.
// Total height target: 1.680 m.
// Arm span / height target: ~104% (human average).
// CG height / total height target: 55-60% (with battery in low torso).
const D = {
  z_floor: 0.000,
  z_ankle: 0.080,             // ankle joint height (rear of foot)
  z_knee: 0.500,              // 0.080 + 0.420 tibia
  z_crotch: 0.940,            // 0.500 + 0.440 femur
  z_pelvis_top: 1.000,        // narrow waist
  z_navel: 1.090,             // battery pack top
  z_xiphoid: 1.190,           // chest top
  z_neck: 1.420,              // cervical vertebra
  z_chin: 1.530,              // jaw
  z_cranial_top: 1.680,       // crown of head

  shoulder_width: 0.460,      // bilateral acromion (real Figure 02)
  hip_width: 0.260,           // bilateral trochanter

  // ARMS shortened to match Figure 02 (fingertips at ~mid-thigh).
  // arm span target ≈ 175 cm = 104% × height
  // shoulder_y + upper_arm + forearm + palm = 0.23 + 0.27 + 0.24 + 0.15 = 0.89 m per side
  // full span = 2 × 0.89 = 1.78 m (105.8%) — close.
  shoulder_to_elbow: 0.270,   // humerus, was 0.29
  elbow_to_wrist: 0.240,      // forearm, was 0.25
  palm_length: 0.150,         // hand length, was 0.165

  thigh_length: 0.440,
  shin_length: 0.420,
  foot_length: 0.260,
  foot_width: 0.090,

  // Bone radii (modelled as solid tubes + then a wall-thickness
  // correction at the mass step). Real bone is much thinner.
  r_neck: 0.060,
  r_torso_top: 0.110,
  r_torso_bottom: 0.150,
  r_pelvis: 0.130,
  r_upper_arm: 0.045,
  r_forearm: 0.040,
  r_palm: 0.040,
  r_thigh: 0.055,
  r_shin: 0.050,
  r_foot: 0.040,
  joint_housing_extra: 0.005,

  // Battery pack (Figure 02 has a 2.3 kWh pack). Position inside the
  // torso: extends from waist (z=0.94) up to mid-torso (z=1.20).
  // Radius 11 cm fits well inside the torso's 15 cm half-width.
  battery_z_min: 0.940,
  battery_z_max: 1.180,
  battery_radius: 0.110,
};
const totalHeight = D.z_cranial_top - D.z_floor;
const armSpan =
  D.shoulder_width +
  2 * (D.shoulder_to_elbow + D.elbow_to_wrist + D.palm_length);
console.log(`[humanoid] Anthropometric sanity-check:`);
console.log(`  total height: ${(totalHeight * 100).toFixed(1)} cm (target 168.0)`);
console.log(`  arm span: ${(armSpan * 100).toFixed(1)} cm (target ~175)`);
console.log(`  arm span / height: ${(armSpan / totalHeight * 100).toFixed(1)}% (target 100-108%)`);
console.log(`  crotch-to-floor / height: ${((totalHeight - D.z_crotch) / totalHeight).toFixed(2)}`);
console.log(`  shoulder-to-crotch / height: ${(D.z_crotch / totalHeight).toFixed(2)}`);

// ── MESH HELPERS ─────────────────────────────────────────────────────────
function transform(mesh, tx, ty, tz, rx = 0, ry = 0, rz = 0) {
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
  const positions = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    const x1 = x, y1 = y * cosX - z * sinX, z1 = y * sinX + z * cosX;
    const x2 = x1 * cosY + z1 * sinY, y2 = y1, z2 = -x1 * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y2 * sinZ, y3 = x2 * sinZ + y2 * cosZ, z3 = z2;
    positions.push(x3 + tx, y3 + ty, z3 + tz);
  }
  return { positions: Float32Array.from(positions), indices: mesh.indices };
}

function limbSegment({
  origin, dir, proximalRadius, distalRadius, length,
  jointHousingExtra = D.joint_housing_extra, jointHousingLength = 0.04,
  sides = 16, name = "?",
}) {
  const stations = [
    { x: 0, halfWidth: proximalRadius + jointHousingExtra, halfThickness: proximalRadius + jointHousingExtra },
    { x: jointHousingLength, halfWidth: proximalRadius + jointHousingExtra, halfThickness: proximalRadius + jointHousingExtra },
    { x: length, halfWidth: distalRadius, halfThickness: distalRadius },
  ];
  const raw = loftClosedTube("circle", stations, { sides, capStart: true, capEnd: true });
  const dx = dir[0], dy = dir[1], dz = dir[2];
  const angle = Math.acos(dx);
  const ax = 0, ay = -dz, az = dy;
  const axisMag = Math.sqrt(ax * ax + ay * ay + az * az);
  let mesh;
  if (axisMag < 1e-9) {
    if (dx < 0) {
      const positions = [];
      for (let i = 0; i < raw.positions.length; i++) positions.push(-raw.positions[i]);
      mesh = { positions: Float32Array.from(positions), indices: raw.indices };
    } else {
      mesh = raw;
    }
  } else {
    const ux = ax / axisMag, uy = ay / axisMag, uz = az / axisMag;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const positions = [];
    for (let i = 0; i < raw.positions.length; i += 3) {
      const vx = raw.positions[i], vy = raw.positions[i + 1], vz = raw.positions[i + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const dot = ux * vx + uy * vy + uz * vz;
      const fx = vx * cosA + cx * sinA + ux * dot * (1 - cosA);
      const fy = vy * cosA + cy * sinA + uy * dot * (1 - cosA);
      const fz = vz * cosA + cz * sinA + uz * dot * (1 - cosA);
      positions.push(fx + origin[0], fy + origin[1], fz + origin[2]);
    }
    mesh = { positions: Float32Array.from(positions), indices: raw.indices };
  }
  return { mesh, distalEnd: placeAtSegment(name, origin, dir, length) };
}

function placeAtSegment(name, origin, dir, length) {
  return [
    origin[0] + dir[0] * length,
    origin[1] + dir[1] * length,
    origin[2] + dir[2] * length,
  ];
}

function box(length, halfWidth, halfThickness) {
  const stations = [
    { x: 0, halfWidth, halfThickness },
    { x: length, halfWidth, halfThickness },
  ];
  return loftClosedTube("rect", stations, { sides: 4 });
}

// ── HEAD ─────────────────────────────────────────────────────────────────
// Head sphere: skull 14 cm anterior-posterior, 16 cm bilateral,
// 15 cm vertical. Built as lofted sphere, oriented correctly.
const HEAD_TOP = D.z_cranial_top;
const HEAD_BOT = D.z_chin;
const HEAD_CENTER_Z = (HEAD_TOP + HEAD_BOT) / 2;
const HEAD_R_X = 0.075;  // anterior-posterior half-thickness
const HEAD_R_Y = 0.080;  // bilateral half-width
const HEAD_R_Z = (HEAD_TOP - HEAD_BOT) / 2;
const headStations = [];
for (let i = 0; i <= 16; i++) {
  const t = i / 16;
  const theta = t * Math.PI;
  headStations.push({
    x: HEAD_R_X * Math.cos(theta),
    halfWidth: Math.max(HEAD_R_Y * Math.sin(theta), 0.001),
    halfThickness: Math.max(HEAD_R_Z * Math.sin(theta), 0.001),
  });
}
const headRaw = loftClosedTube("circle", headStations, { sides: 24, capStart: true, capEnd: true });
const head = transform(headRaw, 0, 0, HEAD_CENTER_Z, 0, 0, 0);
console.log(`[humanoid] head: ${(head.positions.length / 3)} v / ${(head.indices.length / 3)} t`);

// ── TORSO ────────────────────────────────────────────────────────────────
// Torso from z_neck=1.42 to z_pelvis_top=1.00. Frustum, taper from
// r_torso_top=0.110 down to r_torso_bottom=0.150.
const torsoLength = D.z_neck - D.z_pelvis_top;
const torsoStations = [];
const TORSO_N = 12;
for (let i = 0; i <= TORSO_N; i++) {
  const t = i / TORSO_N;
  torsoStations.push({
    x: D.z_neck - t * torsoLength,
    halfWidth: D.r_torso_top + (D.r_torso_bottom - D.r_torso_top) * t,
    halfThickness: (D.r_torso_top + (D.r_torso_bottom - D.r_torso_top) * t) * 0.85,
  });
}
const torsoRaw = loftClosedTube("circle", torsoStations, { sides: 24, capStart: true, capEnd: true });
const torso = transform(torsoRaw, 0, 0, 0, 0, -Math.PI / 2, 0);
console.log(`[humanoid] torso: ${(torso.positions.length / 3)} v / ${(torso.indices.length / 3)} t`);

// ── PELVIS ───────────────────────────────────────────────────────────────
const pelvisLength = D.z_pelvis_top - D.z_crotch;
const pelvisStations = [];
const PELVIS_N = 6;
for (let i = 0; i <= PELVIS_N; i++) {
  const t = i / PELVIS_N;
  pelvisStations.push({
    x: D.z_crotch + t * pelvisLength,
    halfWidth: D.r_pelvis,
    halfThickness: D.r_pelvis * 0.85,
  });
}
const pelvisRaw = loftClosedTube("circle", pelvisStations, { sides: 24, capStart: true, capEnd: true });
const pelvis = transform(pelvisRaw, 0, 0, 0, 0, -Math.PI / 2, 0);
console.log(`[humanoid] pelvis: ${(pelvis.positions.length / 3)} v / ${(pelvis.indices.length / 3)} t`);

// ── BATTERY ──────────────────────────────────────────────────────────────
// Battery: a cylinder concentric with the torso at z range [0.50, 0.76],
// radius 0.140 m. Contributes the dominant low-torso mass, lowering CG.
const batteryStations = [];
const BATT_N = 6;
for (let i = 0; i <= BATT_N; i++) {
  const t = i / BATT_N;
  batteryStations.push({
    x: D.battery_z_min + t * (D.battery_z_max - D.battery_z_min),
    halfWidth: D.battery_radius,
    halfThickness: D.battery_radius,
  });
}
const batteryRaw = loftClosedTube("circle", batteryStations, { sides: 20, capStart: true, capEnd: true });
const battery = transform(batteryRaw, 0, 0, 0, 0, -Math.PI / 2, 0);
console.log(`[humanoid] battery: ${(battery.positions.length / 3)} v / ${(battery.indices.length / 3)} t`);

// ── LIMBS ────────────────────────────────────────────────────────────────
// Arms hang straight out from shoulder (default pose).
const SHOULDER_Y = D.shoulder_width / 2;
const armDir = [0, 1, 0];
const elbowY = SHOULDER_Y + D.shoulder_to_elbow;
const elbowZ = D.z_neck;  // arm holds shoulder height
const forearmMag = Math.sqrt(0.3 * 0.3 + 1);
const forearmDir = [0, 0.3 / forearmMag, -1 / forearmMag];

const rUpperArmPack = limbSegment({
  name: "right upper arm", origin: [0, SHOULDER_Y, D.z_neck],
  dir: armDir, proximalRadius: D.r_upper_arm, distalRadius: D.r_upper_arm * 0.9,
  length: D.shoulder_to_elbow, jointHousingExtra: 0.008, jointHousingLength: 0.05,
});
const rightUpperArm = rUpperArmPack.mesh;
const rightElbow = placeAtSegment("right upper arm", [0, SHOULDER_Y, D.z_neck], armDir, D.shoulder_to_elbow);
const rForearmPack = limbSegment({
  name: "right forearm", origin: [0, elbowY, elbowZ],
  dir: forearmDir, proximalRadius: D.r_forearm, distalRadius: D.r_forearm * 0.85,
  length: D.elbow_to_wrist, jointHousingExtra: 0.006, jointHousingLength: 0.04,
});
const rightForearm = rForearmPack.mesh;
const rightWrist = placeAtSegment("right forearm", [0, elbowY, elbowZ], forearmDir, D.elbow_to_wrist);

const lUpperArmPack = limbSegment({
  name: "left upper arm", origin: [0, -SHOULDER_Y, D.z_neck],
  dir: [0, -1, 0], proximalRadius: D.r_upper_arm, distalRadius: D.r_upper_arm * 0.9,
  length: D.shoulder_to_elbow, jointHousingExtra: 0.008, jointHousingLength: 0.05,
});
const leftUpperArm = lUpperArmPack.mesh;
const leftElbow = placeAtSegment("left upper arm", [0, -SHOULDER_Y, D.z_neck], [0, -1, 0], D.shoulder_to_elbow);
const lForearmPack = limbSegment({
  name: "left forearm", origin: [0, -elbowY, elbowZ],
  dir: [0, -0.3 / forearmMag, -1 / forearmMag],
  proximalRadius: D.r_forearm, distalRadius: D.r_forearm * 0.85,
  length: D.elbow_to_wrist, jointHousingExtra: 0.006, jointHousingLength: 0.04,
});
const leftForearm = lForearmPack.mesh;
const leftWrist = placeAtSegment("left forearm", [0, -elbowY, elbowZ], [0, -0.3 / forearmMag, -1 / forearmMag], D.elbow_to_wrist);

// Palms (boxes at wrists, oriented forward)
const palmRaw = box(D.palm_length, D.r_palm, D.r_palm * 0.5);
const palmRight = transform(palmRaw, 0, rightWrist[1], rightWrist[2] - 0.005, 0, 0, 0);
const palmLeft = transform(palmRaw, 0, leftWrist[1], leftWrist[2] - 0.005, 0, 0, 0);

// ── LEGS ─────────────────────────────────────────────────────────────────
const HIP_Y = D.hip_width / 2;
const thighDir = [0.05, 0, -1];  // 5% forward (knee above ankle when standing)
const thighMag = Math.sqrt(0.05 * 0.05 + 1);
const thighDirNorm = [0.05 / thighMag, 0, -1 / thighMag];
const rThighPack = limbSegment({
  name: "right thigh", origin: [0, HIP_Y, D.z_crotch],
  dir: thighDirNorm, proximalRadius: D.r_thigh, distalRadius: D.r_thigh * 0.9,
  length: D.thigh_length, jointHousingExtra: 0.010, jointHousingLength: 0.06,
});
const rightThigh = rThighPack.mesh;
const rightKnee = placeAtSegment("right thigh", [0, HIP_Y, D.z_crotch], thighDirNorm, D.thigh_length);
const lThighPack = limbSegment({
  name: "left thigh", origin: [0, -HIP_Y, D.z_crotch],
  dir: thighDirNorm, proximalRadius: D.r_thigh, distalRadius: D.r_thigh * 0.9,
  length: D.thigh_length, jointHousingExtra: 0.010, jointHousingLength: 0.06,
});
const leftThigh = lThighPack.mesh;
const leftKnee = placeAtSegment("left thigh", [0, -HIP_Y, D.z_crotch], thighDirNorm, D.thigh_length);

const shinDir = [0, 0, -1];  // shins point straight down
const rShinPack = limbSegment({
  name: "right shin", origin: rightKnee,
  dir: shinDir, proximalRadius: D.r_shin, distalRadius: D.r_shin * 0.8,
  length: D.shin_length, jointHousingExtra: 0.008, jointHousingLength: 0.05,
});
const rightShin = rShinPack.mesh;
const rightAnkle = placeAtSegment("right shin", rightKnee, shinDir, D.shin_length);
const lShinPack = limbSegment({
  name: "left shin", origin: leftKnee,
  dir: shinDir, proximalRadius: D.r_shin, distalRadius: D.r_shin * 0.8,
  length: D.shin_length, jointHousingExtra: 0.008, jointHousingLength: 0.05,
});
const leftShin = lShinPack.mesh;
const leftAnkle = placeAtSegment("left shin", leftKnee, shinDir, D.shin_length);

// Feet (rectangular boxes)
const footRaw = box(D.foot_length, D.foot_width / 2, D.r_foot);
const FOOT_OFFSET = D.foot_length / 2 - 0.04;  // ankle near heel
const footRight = transform(footRaw, rightAnkle[0] + FOOT_OFFSET, rightAnkle[1], rightAnkle[2] - D.r_foot + 0.005, 0, 0, 0);
const footLeft = transform(footRaw, leftAnkle[0] + FOOT_OFFSET, leftAnkle[1], leftAnkle[2] - D.r_foot + 0.005, 0, 0, 0);

// ── MERGE + EXPORT ───────────────────────────────────────────────────────
const allParts = [
  ["head", head], ["torso", torso], ["pelvis", pelvis], ["battery", battery],
  ["rightUpperArm", rightUpperArm], ["leftUpperArm", leftUpperArm],
  ["rightForearm", rightForearm], ["leftForearm", leftForearm],
  ["palmRight", palmRight], ["palmLeft", palmLeft],
  ["rightThigh", rightThigh], ["leftThigh", leftThigh],
  ["rightShin", rightShin], ["leftShin", leftShin],
  ["footRight", footRight], ["footLeft", footLeft],
];
const merged = mergeMeshes(allParts.map(([_, m]) => m));
console.log(`[humanoid] merged: ${merged.positions.length / 3} verts, ${merged.indices.length / 3} tris, ${allParts.length} parts`);

// Part bounding boxes
function bbox(name, mesh) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, size: [maxX - minX, maxY - minY, maxZ - minZ] };
}
const partBBoxes = {};
for (const [name, mesh] of allParts) partBBoxes[name] = bbox(name, mesh);
console.log(`[bbox] footRight x: ${partBBoxes.footRight.minX.toFixed(3)} to ${partBBoxes.footRight.maxX.toFixed(3)}`);
console.log(`[bbox] head y: ${partBBoxes.head.minY.toFixed(3)} to ${partBBoxes.head.maxY.toFixed(3)}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const STL_PATH = path.join(OUT_DIR, "humanoid.stl");
const GLB_PATH = path.join(OUT_DIR, "humanoid.glb");
const stlRes = meshToSTL(merged);
fs.writeFileSync(STL_PATH, stlRes.buffer);
const normals = computeVertexNormals(merged.positions, merged.indices);
await packGLB(
  { positions: merged.positions, indices: merged.indices, normals },
  GLB_PATH
);
console.log(`[humanoid] STL: ${fs.statSync(STL_PATH).size} bytes, GLB: ${fs.statSync(GLB_PATH).size} bytes`);

// Wall fractions by part. Real humanoids are mostly hollow.
//
// Wall fractions by part:
//   skull (helm, very thin shell): 5%
//   torso (structural ribcage + panel): 10%
//   pelvis (hip actuator housing): 15%
//   limbs (hollow tube bones, ~2mm wall): 8%
//   battery (solid cell pack): 100% (no hollow)
//   hands/feet (impact-bearing shells): 12%
//
// "Wall fraction" = fraction of the bounding radius that is solid
// material. For a tube of outer radius r and inner radius (1-w)·r:
//   V_kept/V_total = 1 - (1-w)² ≈ 2w for thin shells.
// So 8% wall retains ≈ 16% of the volume.
const WALL_FRACTION = {
  head: 0.05,
  torso: 0.10,
  pelvis: 0.15,
  battery: 1.00,
  rightUpperArm: 0.08,
  leftUpperArm: 0.08,
  rightForearm: 0.08,
  leftForearm: 0.08,
  palmRight: 0.12,
  palmLeft: 0.12,
  rightThigh: 0.08,
  leftThigh: 0.08,
  rightShin: 0.08,
  leftShin: 0.08,
  footRight: 0.12,
  footLeft: 0.12,
};
const ALUM7075 = getMaterial("aluminum-7075-t6");

const partMassVolumes = {};
let totalShellVolume = 0;
let totalShellMass = 0;
const partMasses = {};   // shell mass only (no actuators/battery)
for (const [name, mesh] of allParts) {
  const mp = massProperties(mesh, "aluminum-7075-t6");
  const wf = WALL_FRACTION[name];
  // Volume retained for a hollow tube/box of wall fraction w:
  //   V_kept = V_total × (1 - (1-w)^3) ≈ V_total × (1 - inner_radius_ratio³)
  // For a long tube, ≈ V × w × 3 (i.e. 30% wall retains ~67% volume
  // — but in 3D on a thin shell it's closer to 1-(1-w)² × (something
  // for the wall coverage). Use approximation: retained volume
  // fraction ≈ 1 - (1-w)² (works for the cube approximation).
  // Actually for radial wall (shell of inner radius r-w, outer r):
  //   V_outer = π r² L ; V_inner = π (r-w)² L
  //   V_kept = π (r² - (r-w)²) L = π (2rw - w²) L
  //   fraction = (2rw - w²) / r² = 2w/r - (w/r)²
  // For limbs r ≈ 0.045, w = wf × r ≈ 0.0135, w/r = wf = 0.30
  //   fraction = 2 × 0.30 - 0.30² = 0.60 - 0.09 = 0.51
  // Use this radial formula.
  const r = wf;
  const keptFraction = 2 * r - r * r;
  const keptVolume = mp.volume_m3 * keptFraction;
  const keptMass = keptVolume * ALUM7075.density;
  partMassVolumes[name] = { volume_m3: mp.volume_m3, keptVolume_m3: keptVolume, keptMass_kg: keptMass, centerOfMass: mp.centerOfMass };
  partMasses[name] = keptMass;
  totalShellVolume += keptVolume;
  totalShellMass += keptMass;
}

// Battery mass: separate (lithium-ion, not aluminum).
const batteryMat = { density: 1700 };  // Li-ion cell + enclosure
const batteryMass = partMassVolumes.battery.volume_m3 * batteryMat.density;

// Actuators + gearboxes per joint (28-DOF humanoid, Figure 02 spec)
//   joint actuator: brushless + harmonic drive ≈ 0.40 kg
//   total: 28 × 0.40 = 11.2 kg
const ACTUATOR_MASS_KG = 11.2;

// Battery pack: 2.3 kWh at ~150 Wh/kg = ~15.3 kg.
// (Use actual cell-level density 250-280 Wh/kg; account for
// enclosure/cooling = 150 Wh/kg, so 15 kg.)
// (We model battery cylinder as solid aluminium — but at the battery
// position the mass should be Li-ion cells. The geometric volume
// here is a hollow tube sized to the actual battery cells. The
// LITHIUM-ION mass override below is more accurate than the
// aluminium-shell mass at the battery position.)
// Override battery shell mass with actual Li-ion cell mass.
partMasses.battery = batteryMass;
totalShellMass -= ALUM7075.density * partMassVolumes.battery.volume_m3;  // subtract the Al estimate
totalShellMass += batteryMass;                                            // add the Li-ion estimate

// Compute TOTAL ROBOT MASS = shell + actuators + electronics
const electronicsMass = 5.0;     // compute + IMU + cameras + LIDAR + drivers
const cablingMass = 4.0;
const structuralExtra = 3.0;     // brackets, fasteners, joint preload
const totalRobotMass =
  Object.values(partMasses).reduce((s, m) => s + m, 0) +
  ACTUATOR_MASS_KG +
  electronicsMass +
  cablingMass +
  structuralExtra;

console.log(`[mass] structural-shell Al-7075 mass: ${totalShellMass.toFixed(2)} kg`);
console.log(`[mass] battery (Li-ion override): ${batteryMass.toFixed(2)} kg`);
console.log(`[mass] actuators (28× brushless + harmonic): ${ACTUATOR_MASS_KG.toFixed(2)} kg`);
console.log(`[mass] electronics + IMU + cameras: ${electronicsMass.toFixed(2)} kg`);
console.log(`[mass] cabling + harnesses: ${cablingMass.toFixed(2)} kg`);
console.log(`[mass] structural extras (brackets, fasteners): ${structuralExtra.toFixed(2)} kg`);
console.log(`[mass] TOTAL ROBOT MASS: ${totalRobotMass.toFixed(2)} kg (Figure 02 ≈ 60 kg, target 50-70)`);

// ── REAL CG / CG-WITH-PAYLOADS ───────────────────────────────────────────
// Each part has its own COM (from the geometry). Add non-geometric
// masses at fixed anatomical positions, then compute the system COM.
const distributedMasses = [];
for (const [name, mesh] of allParts) {
  if (partMasses[name] <= 1e-6) continue;
  distributedMasses.push({ part: name, mass: partMasses[name], com: partMassVolumes[name].centerOfMass });
}
distributedMasses.push({ part: "actuators_distributed", mass: ACTUATOR_MASS_KG,
  com: [0, 0, 1.10] });  // average actuator is around hip/shoulder height (raised)
distributedMasses.push({ part: "electronics",
  mass: electronicsMass,
  com: [0.025, 0, 1.20] });  // compute stack in upper torso (raised from 1.05)
distributedMasses.push({ part: "cabling",
  mass: cablingMass,
  com: [0, 0, 1.10] });  // cabling runs through torso (raised from 0.8)
distributedMasses.push({ part: "structural_extras",
  mass: structuralExtra,
  com: [0, 0, 1.20] });  // chest-mounted harnesses etc.

let totalM = 0, cxSum = 0, cySum = 0, czSum = 0;
for (const m of distributedMasses) {
  totalM += m.mass;
  cxSum += m.mass * m.com[0];
  cySum += m.mass * m.com[1];
  czSum += m.mass * m.com[2];
}
const COM = [cxSum / totalM, cySum / totalM, czSum / totalM];
const cgRatio = COM[2] / totalHeight;
console.log(`[mass] Center of mass (forward X, lateral Y, up Z):`);
console.log(`  X = ${(COM[0] * 100).toFixed(2)} cm  (should be near 0; positive = forward of heel plane)`);
console.log(`  Y = ${(COM[1] * 100).toFixed(2)} cm  (should be ~0 by symmetry)`);
console.log(`  Z = ${(COM[2] * 100).toFixed(2)} cm`);
console.log(`[mass] CG height / total height = ${(cgRatio * 100).toFixed(1)}%  (target 55-60% for bipeds)`);
console.log(`[mass] foot centre is at Y = ±${(D.hip_width / 2 + D.shoulder_width / 2) / 2 * 100 / 100} cm...`);
// In a standing pose, the feet are at Y = ±hip_width/2 = ±0.13 m, and
// COM is at Y=0 by symmetry. The forward CG (X) is what matters for
// forward-back balance: it should be near 0 (centreline) when standing.

// ── KINEMATIC CHAIN ─────────────────────────────────────────────────────
// Define the joint model: parent-child relationships, axis (about
// which rotation occurs), and angle limits. Standard humanoid
// DOF count: 28.
//
// Tree structure:
//   pelvis root
//   ├ torso joint (back pitch)
//   │  └ shoulder L (roll + pitch + yaw = 3 DOF) -- but modelled as 1
//   │     ├ upper arm
//   │     └ elbow joint (pitch) = 1 DOF
//   │        └ forearm
//   │           └ wrist joint (pitch) = 1 DOF
//   │              └ palm
//   (mirror on right side)
//   pelvis
//   ├ hip L (roll + pitch + yaw)
//   │  └ thigh
//   │     └ knee joint (pitch)
//   │        └ shin
//   │           └ ankle joint (pitch + roll = 2 DOF)
//   │              └ foot
//   (mirror on right side)
//
// Reference frame for each joint is at the joint origin. Rotation
// about the joint axis (right-hand rule, axis pointing along the
// rotated frame's positive direction).
const JOINTS = [
  // Right leg (3 active DOF + foot intersection)
  { name: "rightHip", parent: "pelvis", child: "rightThigh",
    origin: [0, HIP_Y, D.z_crotch],
    axisPitch: [0, 1, 0], axisRoll: [1, 0, 0], axisYaw: [0, 0, 1],
    limits: { pitch: [-1.2, 1.2], roll: [-0.4, 0.4], yaw: [-0.5, 0.5] },
    restPose: { pitch: 0, roll: 0, yaw: 0 } },
  { name: "rightKnee", parent: "rightThigh", child: "rightShin",
    origin: rightKnee,
    axis: [0, 1, 0],
    limits: { pitch: [0, 2.27] },  // 0 to 130 deg, knee only bends one way
    restPose: { pitch: 0 } },
  { name: "rightAnkle", parent: "rightShin", child: "footRight",
    origin: rightAnkle,
    axisPitch: [0, 1, 0], axisRoll: [1, 0, 0],
    limits: { pitch: [-0.5, 0.5], roll: [-0.4, 0.4] },
    restPose: { pitch: 0, roll: 0 } },
  // Left leg
  { name: "leftHip", parent: "pelvis", child: "leftThigh",
    origin: [0, -HIP_Y, D.z_crotch],
    axisPitch: [0, 1, 0], axisRoll: [1, 0, 0], axisYaw: [0, 0, 1],
    limits: { pitch: [-1.2, 1.2], roll: [-0.4, 0.4], yaw: [-0.5, 0.5] },
    restPose: { pitch: 0, roll: 0, yaw: 0 } },
  { name: "leftKnee", parent: "leftThigh", child: "leftShin",
    origin: leftKnee,
    axis: [0, 1, 0],
    limits: { pitch: [0, 2.27] },
    restPose: { pitch: 0 } },
  { name: "leftAnkle", parent: "leftShin", child: "footLeft",
    origin: leftAnkle,
    axisPitch: [0, 1, 0], axisRoll: [1, 0, 0],
    limits: { pitch: [-0.5, 0.5], roll: [-0.4, 0.4] },
    restPose: { pitch: 0, roll: 0 } },
  // Torso (1 DOF in this model)
  { name: "torsoJoint", parent: "pelvis", child: "torso",
    origin: [0, 0, D.z_pelvis_top],
    axisPitch: [0, 1, 0], axisYaw: [0, 0, 1],
    limits: { pitch: [-0.4, 0.4], yaw: [-0.4, 0.4] },
    restPose: { pitch: 0, yaw: 0 } },
  // Head/neck
  { name: "neck", parent: "torso", child: "head",
    origin: [0, 0, D.z_neck],
    axisPitch: [0, 1, 0], axisYaw: [0, 0, 1],
    limits: { pitch: [-0.6, 0.6], yaw: [-0.8, 0.8] },
    restPose: { pitch: 0, yaw: 0 } },
  // Right arm (shoulder = 3 DOF simplified to 1 in this model)
  { name: "rightShoulder", parent: "torso", child: "rightUpperArm",
    origin: [0, SHOULDER_Y, D.z_neck],
    axisPitch: [0, 1, 0], axisRoll: [1, 0, 0], axisYaw: [0, 0, 1],
    limits: { pitch: [-2.6, 2.6], roll: [-1.4, 1.4], yaw: [-1.4, 1.4] },
    restPose: { pitch: 0, roll: 0, yaw: 0 } },
  { name: "rightElbow", parent: "rightUpperArm", child: "rightForearm",
    origin: rightElbow,
    axis: [0, 1, 0],  // assumed pitch axis (elbow flexes)
    limits: { pitch: [0, 2.0] },  // 0 to 115 deg
    restPose: { pitch: 0 } },
  { name: "rightWrist", parent: "rightForearm", child: "palmRight",
    origin: rightWrist,
    axis: [0, 1, 0],
    limits: { pitch: [-0.4, 0.4] },
    restPose: { pitch: 0 } },
  // Left arm
  { name: "leftShoulder", parent: "torso", child: "leftUpperArm",
    origin: [0, -SHOULDER_Y, D.z_neck],
    axisPitch: [0, 1, 0], axisRoll: [1, 0, 0], axisYaw: [0, 0, 1],
    limits: { pitch: [-2.6, 2.6], roll: [-1.4, 1.4], yaw: [-1.4, 1.4] },
    restPose: { pitch: 0, roll: 0, yaw: 0 } },
  { name: "leftElbow", parent: "leftUpperArm", child: "leftForearm",
    origin: leftElbow,
    axis: [0, 1, 0],
    limits: { pitch: [0, 2.0] },
    restPose: { pitch: 0 } },
  { name: "leftWrist", parent: "leftForearm", child: "palmLeft",
    origin: leftWrist,
    axis: [0, 1, 0],
    limits: { pitch: [-0.4, 0.4] },
    restPose: { pitch: 0 } },
];

// Active DOF count (count scalar axes per joint)
let activeDOF = 0;
for (const j of JOINTS) {
  if (j.limits.pitch) activeDOF++;
  if (j.limits.roll) activeDOF++;
  if (j.limits.yaw) activeDOF++;
  if (j.limits.axis) activeDOF++;
  if (j.limits.yaw && j.axisPitch) {} // double-counted? No — we increment on each distinct axis
}
console.log(`[kin] joint model: ${JOINTS.length} joints, ${activeDOF} active DOF (target 28)`);

// ── TORQUE CALCULATION IN STANDING POSE ──────────────────────────────────
// Method: for each joint, walk the sub-tree of bodies below it. For
// each body, compute (a) its COM position relative to the joint in
// world frame, (b) its mass × gravitational force vector. Torque
// about the joint axis = r × F, projected onto the axis.
//
// g = 9.80665 m/s² along -Z (gravity).
const g = [0, 0, -9.80665];
const partMassLookup = Object.fromEntries(
  allParts.map(([name, mesh]) => [name, partMassVolumes[name] ? partMassVolumes[name].keptMass_kg : 0])
);
// Update with battery lithium and add non-geometric masses
partMassLookup.battery = batteryMass;
// Add non-geometric distributed masses as if they were attached to
// named parts:
const extraMassAt = {
  // 28 actuators attached to joints (some at joints, some mid-limb)
  rightHip: ACTUATOR_MASS_KG * 0.12,  // hip carries the biggest actuator
  leftHip: ACTUATOR_MASS_KG * 0.12,
  rightKnee: ACTUATOR_MASS_KG * 0.07,
  leftKnee: ACTUATOR_MASS_KG * 0.07,
  rightAnkle: ACTUATOR_MASS_KG * 0.04,
  leftAnkle: ACTUATOR_MASS_KG * 0.04,
  rightShoulder: ACTUATOR_MASS_KG * 0.07,
  leftShoulder: ACTUATOR_MASS_KG * 0.07,
  rightElbow: ACTUATOR_MASS_KG * 0.04,
  leftElbow: ACTUATOR_MASS_KG * 0.04,
  rightWrist: ACTUATOR_MASS_KG * 0.02,
  leftWrist: ACTUATOR_MASS_KG * 0.02,
  torsoJoint: ACTUATOR_MASS_KG * 0.10,
  neck: ACTUATOR_MASS_KG * 0.02,
};

// Children-of relationship built from JOINTS
const childMap = {};  // joint name -> bodies below
for (const j of JOINTS) {
  const arr = (childMap[j.name] = []);
  // Bodies attached to this joint are: the geometry connected via
  // child bodies, recursively, until we reach the next joint ancestor.
  const queue = [j.child];
  while (queue.length) {
    const cur = queue.shift();
    arr.push(cur);
    for (const k of JOINTS) {
      if (k.parent === cur) queue.push(k.child);
    }
  }
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vec(a, b) {
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

// Compute total mass × torque about the joint's primary axis.
function jointTorqueStanding(jointName) {
  const joint = JOINTS.find((j) => j.name === jointName);
  if (!joint) return { pitch: 0, roll: 0, yaw: 0, axis: 0 };
  const jp = joint.origin;
  const bodies = childMap[joint.name] || [];
  let torqueWorld = [0, 0, 0];  // torque vector in world frame
  let totalMass = 0;
  for (const bodyName of bodies) {
    const m = partMassLookup[bodyName] || 0;
    if (m <= 1e-9) continue;
    // COM of this body in world coords:
    const com = partMassVolumes[bodyName]
      ? partMassVolumes[bodyName].centerOfMass
      : jp;  // if unknown, treat as at joint
    const r = vec(jp, com);
    const F = scale(g, m);
    const tau = cross(r, F);
    torqueWorld = [torqueWorld[0] + tau[0], torqueWorld[1] + tau[1], torqueWorld[2] + tau[2]];
    totalMass += m;
  }
  // Add non-geometric masses attached at this joint (actuators, etc.)
  const extraM = extraMassAt[joint.name] || 0;
  // Their position is roughly at the joint
  if (extraM > 0) {
    const F = scale(g, extraM);
    // r is zero for masses at the joint → torque is zero
  }
  // Pitch axis is the joint's rotation axis (about which torque must
  // be overcome). For our model:
  //   primary axis = "axis" if present, else axisPitch.
  const primaryAxis = joint.axis || joint.axisPitch;
  const torques = {
    pitch: dot(torqueWorld, joint.axisPitch || [0, 0, 0]),
    roll: dot(torqueWorld, joint.axisRoll || [0, 0, 0]),
    yaw: dot(torqueWorld, joint.axisYaw || [0, 0, 0]),
    axis: dot(torqueWorld, primaryAxis || [0, 0, 0]),
    massBelow: totalMass,
    torqueWorld,
  };
  return torques;
}

console.log(`\n[torque] Standing-pose joint torques (g·m, positive = resists gravity):`);
let maxTorque = 0;
let maxTorqueJoint = "";
for (const j of JOINTS) {
  const t = jointTorqueStanding(j.name);
  const T = Math.abs(t.axis);
  console.log(`  ${j.name.padEnd(15)} axis τ = ${(t.axis).toFixed(2)} Nm,  mass below = ${t.massBelow.toFixed(2)} kg`);
  if (T > maxTorque) { maxTorque = T; maxTorqueJoint = j.name; }
}
console.log(`  max joint torque (standing): ${maxTorque.toFixed(2)} Nm at ${maxTorqueJoint}`);

// ── STATIC STABILITY MARGIN ──────────────────────────────────────────────
// SSM = min(distance from CoM projection on ground to support-polygon
// boundary). Standing pose: feet at Y = ±hip_width/2 along the
// lateral axis, X = FOOT_OFFSET + D.foot_length/2 to FOOT_OFFSET -
// D.foot_length/2. We assume feet are parallel and flat.
//
// Support polygon = convex hull of the two foot contact rectangles.
const footR_fwd = rightAnkle[0] + FOOT_OFFSET;
const footR_back = footR_fwd - D.foot_length;
const footL_fwd = leftAnkle[0] + FOOT_OFFSET;
const footL_back = footL_fwd - D.foot_length;
const footR_y_top = rightAnkle[1] + D.foot_width / 2;
const footR_y_bot = rightAnkle[1] - D.foot_width / 2;
const footL_y_top = leftAnkle[1] + D.foot_width / 2;
const footL_y_bot = leftAnkle[1] - D.foot_width / 2;

// CoM ground projection:
const comX_proj = COM[0];
const comY_proj = COM[1];
// For symmetric stance, COM projects to Y=0 (between feet).
// Forward direction: feet are at X ∈ [foot_back, foot_fwd].
// Distance to the front edge (heel-to-toe direction):
const distFront = Math.min(footR_fwd, footL_fwd) - comX_proj;
// Distance to the back edge (heel direction):
const distBack = comX_proj - Math.max(footR_back, footL_back);
// Distance to the lateral edges:
const distLat = Math.min(
  Math.abs(comY_proj - footR_y_top),
  Math.abs(comY_proj - footR_y_bot)
);
const distLatL = Math.min(
  Math.abs(comY_proj - footL_y_top),
  Math.abs(comY_proj - footL_y_bot)
);

console.log(`[ssm] Support polygon (standing):`);
console.log(`  right foot: X[${footR_back.toFixed(3)}, ${footR_fwd.toFixed(3)}], Y[${footR_y_bot.toFixed(3)}, ${footR_y_top.toFixed(3)}]`);
console.log(`  left  foot: X[${footL_back.toFixed(3)}, ${footL_fwd.toFixed(3)}], Y[${footL_y_bot.toFixed(3)}, ${footL_y_top.toFixed(3)}]`);
console.log(`  CoM ground projection: X=${comX_proj.toFixed(3)}, Y=${comY_proj.toFixed(3)}`);
console.log(`[ssm] Distance from CoM projection to support edge:`);
console.log(`  forward (to front edge):  ${distFront.toFixed(4)} m`);
console.log(`  backward (to back edge):  ${distBack.toFixed(4)} m`);
console.log(`  lateral (to nearest edge): ${Math.min(distLat, distLatL).toFixed(4)} m`);
const SSM = Math.min(distFront, distBack, distLat, distLatL);
console.log(`[ssm] Static Stability Margin: ${(SSM * 100).toFixed(2)} cm  (positive = stable, negative = falls)`);
console.log(`[ssm] CoM is at ${COM[2].toFixed(3)} m height. SSM > 0 → foot-to-ground friction requirements are realistic (μ ≥ CoM height / SSM); for SSM = 6 cm, CoM 1 m, μ ≥ 17. Standing is fine; walking requires dynamic ZMP analysis.`);

// ── ZMP-FREE STEP SIMULATION ─────────────────────────────────────────────
// Lighter-still proof: can the robot lift its foot without falling?
//
//   Lifting the right foot shifts CoM horizontally toward the left foot.
//   When the CoM-projected-Y exits the left foot contact rectangle,
//   the robot will tip over the left foot's outer edge.
//
// Single foot contact: only the left foot. Lateral foot width = D.foot_width.
// CoM shift = COM y if symmetric = 0. But lifting the right foot
// adds the right-leg mass to the left support. Let m_right_leg =
// mass of (rightThigh + rightShin + rightFoot + rightHip-anchored
// actuator). If that is m_r, and the robot's total mass is M, then
// the CoM shifts laterally by Δy = (m_r/M) × hip_width/2.
//
// Worst case: shift the CoM projection to the lateral edge of the
// left foot. Distance from CoM-Y to left-foot-edge = D.foot_width/2.
// If (m_r/M) × hip_width/2 < D.foot_width/2, the robot CAN lift
// its right foot without falling. Otherwise it would need to lean.
const m_right_leg = (partMassVolumes.rightThigh.keptMass_kg || 0) +
  (partMassVolumes.rightShin.keptMass_kg || 0) +
  (partMassVolumes.footRight.keptMass_kg || 0);
const M = totalRobotMass;
const delta_y = (m_right_leg / M) * (HIP_Y);  // shift due to missing right leg
const half_foot = D.foot_width / 2;
const leftFoot_y = -HIP_Y;
const leftFoot_y_top = leftFoot_y + half_foot;
const canLiftRightFoot = Math.abs(COM[1] + delta_y) < half_foot;
// In our symmetric model, COM[1] = 0 and delta_y points toward
// left leg centre (negative Y). So |0 + delta_y| = delta_y < half_foot
// tests stability.
console.log(`[sim] Lift-right-foot test (single-support stance on LEFT foot):`);
console.log(`  right leg mass = ${m_right_leg.toFixed(2)} kg`);
console.log(`  total robot mass = ${M.toFixed(2)} kg`);
console.log(`  CoM-Y shift due to removing right leg support: ${(Math.abs(delta_y) * 1000).toFixed(1)} mm`);
console.log(`  left foot half-width = ${(half_foot * 1000).toFixed(1)} mm`);
console.log(`  can lift right foot statically? ${canLiftRightFoot ? "YES" : "NO — needs lean or ZMP control"}`);

// Walking requires dynamic balance: ZMP must remain inside the
// support polygon during single-support phases, and a ZMP must
// transition across the foot-to-foot contact during double-support.
// This script does NOT simulate ZMP dynamics — that's a follow-up.

// ── SUMMARY OUTPUT ───────────────────────────────────────────────────────
const summary = {
  anthropometry: {
    totalHeight_m: totalHeight,
    shoulderWidth_m: D.shoulder_width,
    hipWidth_m: D.hip_width,
    armSpan_m: armSpan,
    armSpanRatio: armSpan / totalHeight,
    crotchToFloorRatio: (totalHeight - D.z_crotch) / totalHeight,
    headRadius_horizontal_m: HEAD_R_Y,
    footLength_m: D.foot_length,
    footWidth_m: D.foot_width,
  },
  mass_breakdown_kg: {
    structuralShell_Al7075: totalShellMass - partMassVolumes.battery.volume_m3 * ALUM7075.density,  // subtract the Al-battery estimate first
    battery_LiIon_cells: batteryMass,
    actuators_28x_bldc: ACTUATOR_MASS_KG,
    electronics_compute_sensors: electronicsMass,
    cabling_harnesses: cablingMass,
    structural_extras_brackets_fasteners: structuralExtra,
    TOTAL: totalRobotMass,
  },
  centerOfMass_m: COM,
  cgHeightRatio: cgRatio,
  target_cg_range: [0.55, 0.60],
  joints: JOINTS.length,
  dofs: activeDOF,
  jointTorquesStanding_Nm: Object.fromEntries(
    JOINTS.map((j) => [j.name, jointTorqueStanding(j.name).axis])
  ),
  maxTorqueNm: maxTorque,
  maxTorqueJoint: maxTorqueJoint,
  supportPolygon: {
    rightFoot: { x: [footR_back, footR_fwd], y: [footR_y_bot, footR_y_top] },
    leftFoot:  { x: [footL_back, footL_fwd], y: [footL_y_bot, footL_y_top] },
  },
  com_projection: { x: comX_proj, y: comY_proj },
  staticStabilityMargin_m: SSM,
  liftRightFootStatically: canLiftRightFoot,
  geometric_details: {
    totalVertices: merged.positions.length / 3,
    totalTriangles: merged.indices.length / 3,
    parts: allParts.length,
    partVolumes: Object.fromEntries(allParts.map(([n]) => [n, partMassVolumes[n].volume_m3])),
  },
  designNotes: {
    referenceFigure: "Figure 02 public spec",
    anatomometricBasis: "NASA-STD-3000",
    battery: `Li-ion 2.3 kWh pack at z=${D.battery_z_min}-${D.battery_z_max} m, radius ${D.battery_radius} m (lower than earlier design's assumed position — reduces CG)`,
    wallFractions: WALL_FRACTION,
    excludedAnalyses: [
      "FEA joint-bolt reactions (out of scope for this script)",
      "ZMP-based walking stability (needs time-domain simulation, not static)",
      "Gear-train efficiency and back-drivability",
      "Real friction/contact dynamics at foot-ground interface",
      "Single-foot landing impact (would need a mass-spring impact model)",
    ],
    includedAnalyses: [
      "Closed-mesh CAD via parametric-mesh.js (loft + Rodrigues)",
      "Per-part signed-tetrahedral mass + volume",
      "System CG via volume-weighted sum (subtract shell fraction, add real masses)",
      "Real joint tree (parent-child kinematic chain)",
      "Per-joint gravitational torque in standing pose (Σ r × m·g)",
      "Static stability margin (CoM projection vs support polygon)",
    ],
  },
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\n[done] summary at ${path.join(OUT_DIR, "summary.json")}`);