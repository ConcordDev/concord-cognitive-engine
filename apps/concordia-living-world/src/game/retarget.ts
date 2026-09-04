import * as THREE from "three";
import { HUMANOID_ROLES, type HumanoidBones, type HumanoidRole } from "./humanoid-cert";

function roleFromTrack(name: string, source: HumanoidBones): HumanoidRole | null {
  const bone = name.split(".")[0] ?? "";
  for (const role of HUMANOID_ROLES) {
    if (source[role]?.name === bone) return role;
  }
  return null;
}

/**
 * source skeleton → normalized humanoid roles → target skeleton.
 * Mixamo→Mixamo is identity; other GLBs remap by role.
 */
export function retargetClip(
  clip: THREE.AnimationClip,
  source: HumanoidBones,
  target: HumanoidBones,
): THREE.AnimationClip {
  const c = clip.clone();
  c.tracks = c.tracks.flatMap((track) => {
    const role = roleFromTrack(track.name, source);
    if (!role) return [track];
    const dest = target[role];
    if (!dest) return [];
    const next = track.clone();
    next.name = track.name.replace(track.name.split(".")[0]!, dest.name);
    return [next];
  });
  return c;
}
