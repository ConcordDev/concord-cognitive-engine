import type { Object3D } from "three";

/** Unity-style humanoid roles. One map, many meshes. */
export const HUMANOID_ROLES = [
  "hips",
  "spine",
  "spine1",
  "spine2",
  "neck",
  "head",
  "clavL",
  "clavR",
  "armL",
  "armR",
  "foreL",
  "foreR",
  "handL",
  "handR",
  "thighL",
  "thighR",
  "shinL",
  "shinR",
  "footL",
  "footR",
] as const;

export type HumanoidRole = (typeof HUMANOID_ROLES)[number];
export type HumanoidBones = Partial<Record<HumanoidRole, Object3D>>;

const ALIASES: Record<HumanoidRole, string[]> = {
  hips: ["mixamorig:hips", "hips", "pelvis", "hip"],
  spine: ["mixamorig:spine", "spine", "spine1", "abdomen"],
  spine1: ["mixamorig:spine1", "spine1", "chest", "spine01"],
  spine2: ["mixamorig:spine2", "spine2", "upperchest", "spine02"],
  neck: ["mixamorig:neck", "neck"],
  head: ["mixamorig:head", "head"],
  clavL: ["mixamorig:leftshoulder", "leftshoulder", "clavicle_l", "leftclavicle"],
  clavR: ["mixamorig:rightshoulder", "rightshoulder", "clavicle_r", "rightclavicle"],
  armL: ["mixamorig:leftarm", "leftarm", "leftupperarm", "upperarm_l"],
  armR: ["mixamorig:rightarm", "rightarm", "rightupperarm", "upperarm_r"],
  foreL: ["mixamorig:leftforearm", "leftforearm", "leftlowerarm", "lowerarm_l"],
  foreR: ["mixamorig:rightforearm", "rightforearm", "rightlowerarm", "lowerarm_r"],
  handL: ["mixamorig:lefthand", "lefthand", "hand_l", "lefthand"],
  handR: ["mixamorig:righthand", "righthand", "hand_r"],
  thighL: ["mixamorig:leftupleg", "leftupleg", "leftthigh", "thigh_l", "upperleg_l"],
  thighR: ["mixamorig:rightupleg", "rightupleg", "rightthigh", "thigh_r", "upperleg_r"],
  shinL: ["mixamorig:leftleg", "leftleg", "leftshin", "shin_l", "lowerleg_l"],
  shinR: ["mixamorig:rightleg", "rightleg", "rightshin", "shin_r", "lowerleg_r"],
  footL: ["mixamorig:leftfoot", "leftfoot", "foot_l"],
  footR: ["mixamorig:rightfoot", "rightfoot", "foot_r"],
};

const REQUIRED: HumanoidRole[] = [
  "hips",
  "spine",
  "head",
  "armL",
  "armR",
  "handL",
  "handR",
  "thighL",
  "thighR",
  "footL",
  "footR",
];

function norm(name: string) {
  return name.replace(/^mixamorig/i, "mixamorig:").replace(/[:_\-\s]/g, "").toLowerCase();
}

function roleOf(name: string): HumanoidRole | null {
  const n = name.replace(/[:_\-\s]/g, "").toLowerCase();
  for (const role of HUMANOID_ROLES) {
    for (const a of ALIASES[role]) {
      if (n === a.replace(/[:_\-\s]/g, "").toLowerCase()) return role;
    }
  }
  return null;
}

export type HumanoidCert = {
  ok: true;
  bones: HumanoidBones;
  missing: string[];
  scale: number;
} | {
  ok: false;
  reason: string;
  missing: string[];
};

/** Reject a GLB that cannot be a Concordia humanoid. */
export function certifyHumanoid(root: Object3D): HumanoidCert {
  const bones: HumanoidBones = {};
  root.traverse((o) => {
    if (!o.name) return;
    const role = roleOf(o.name);
    if (role && !bones[role]) bones[role] = o;
  });
  const missing = REQUIRED.filter((r) => !bones[r]);
  if (missing.length) {
    return { ok: false, reason: `missing bones: ${missing.join(",")}`, missing };
  }
  const hips = bones.hips!;
  const head = bones.head!;
  const hy = hips.position.y;
  const scale = Math.abs(hy) > 20 ? 0.01 : Math.abs(hy) > 2 ? 0.1 : 1;
  if (!head) return { ok: false, reason: "no head", missing: ["head"] };
  void norm;
  return { ok: true, bones, missing: [], scale };
}

export function boneName(bones: HumanoidBones, role: HumanoidRole): string {
  return bones[role]?.name ?? "";
}
