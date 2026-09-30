// Concordia Wave6 — Procedural Humanoid + Gait/IK MVP (server authority).
// Wraps procedural-creature humanoid topology + biped gait, adds two-bone IK
// plant + stride sampler so composition/Unity clients can consume poses without
// owning authority. Editor visual quality remains separate (NEED_DUTCH Play).

import { generateCreature, validateCreaturePhysics } from "./procedural-creature.js";

/**
 * Assemble a procedural humanoid blueprint from seed/description.
 */
export function assembleHumanoid(opts = {}) {
  const description = opts.description || "procedural humanoid biped person";
  const bp = generateCreature({
    description,
    worldId: opts.worldId || "concordia",
    topology: "humanoid",
    massKg: opts.massKg,
    heightM: opts.heightM,
  });
  const parts = bp.parts || [];
  const humanoid =
    bp.topology === "humanoid" ||
    parts.some((p) => p.name === "leftLeg") && parts.some((p) => p.name === "rightArm");
  const physics = validateCreaturePhysics(bp);
  return {
    ok: !!(bp && humanoid && physics.ok !== false),
    id: bp.id,
    topology: bp.topology,
    massKg: bp.massKg,
    heightM: bp.heightM,
    parts: parts.map((p) => ({ name: p.name, kind: p.kind, massKg: p.massKg })),
    gait: bp.gait || null,
    physics,
    provenance: bp.provenance || { source: "concordia-humanoid-gait" },
  };
}

/**
 * Sample a biped gait pose at time t (seconds). Deterministic; no Unity required.
 */
export function sampleGaitPose(humanoid, t = 0) {
  const gait = humanoid?.gait || { walkMps: 1.4, strideHz: 1.3, kind: "biped" };
  const hz = gait.strideHz || 1.3;
  const phase = (Number(t) * hz) % 1;
  const swing = Math.sin(phase * Math.PI * 2);
  const knee = Math.max(0, -Math.sin(phase * Math.PI * 2)) * 0.45;
  const footRoll = Math.sin(phase * Math.PI * 2) * 0.12;
  const spineTwist = Math.sin(phase * Math.PI * 2) * 0.08;
  return {
    ok: true,
    kind: gait.kind || "biped",
    phase,
    walkMps: gait.walkMps,
    leftLeg: { hip: swing * 0.35, knee, footRoll },
    rightLeg: { hip: -swing * 0.35, knee: Math.max(0, Math.sin(phase * Math.PI * 2)) * 0.45, footRoll: -footRoll },
    spine: { twist: spineTwist, squat: knee * 0.15 },
  };
}

/**
 * Two-bone IK: place end effector toward target; returns joint angles (rad).
 * Classic law-of-cosines solver for upper+lower bone lengths.
 */
export function twoBoneIK({ upperLen = 0.35, lowerLen = 0.35, target = { x: 0.1, y: -0.55, z: 0 } } = {}) {
  const tx = target.x ?? 0;
  const ty = target.y ?? -0.55;
  const tz = target.z ?? 0;
  const dist = Math.min(Math.hypot(tx, ty, tz), upperLen + lowerLen - 1e-4);
  const cosKnee = (upperLen ** 2 + lowerLen ** 2 - dist ** 2) / (2 * upperLen * lowerLen);
  const knee = Math.acos(Math.max(-1, Math.min(1, cosKnee)));
  const cosHip = (upperLen ** 2 + dist ** 2 - lowerLen ** 2) / (2 * upperLen * dist);
  const hip = Math.atan2(ty, Math.hypot(tx, tz)) - Math.acos(Math.max(-1, Math.min(1, cosHip)));
  return {
    ok: Number.isFinite(hip) && Number.isFinite(knee),
    hip,
    knee: Math.PI - knee,
    reach: dist,
    planted: dist <= upperLen + lowerLen,
  };
}

/**
 * Closed-loop MVP: assemble humanoid → sample gait → plant feet with IK.
 */
export function proveHumanoidGaitMvp(opts = {}) {
  const humanoid = assembleHumanoid(opts);
  const pose = sampleGaitPose(humanoid, opts.t ?? 0.37);
  const left = twoBoneIK({
    upperLen: (humanoid.heightM || 1.75) * 0.25,
    lowerLen: (humanoid.heightM || 1.75) * 0.25,
    target: { x: -0.1, y: -(humanoid.heightM || 1.75) * 0.48, z: pose.leftLeg.hip * 0.2 },
  });
  const right = twoBoneIK({
    upperLen: (humanoid.heightM || 1.75) * 0.25,
    lowerLen: (humanoid.heightM || 1.75) * 0.25,
    target: { x: 0.1, y: -(humanoid.heightM || 1.75) * 0.48, z: pose.rightLeg.hip * 0.2 },
  });
  return {
    ok: !!(humanoid.ok && pose.ok && left.ok && right.ok && left.planted && right.planted),
    humanoid: { id: humanoid.id, topology: humanoid.topology, parts: humanoid.parts?.length, gait: humanoid.gait },
    pose,
    ik: { left, right },
  };
}
