import * as THREE from "three";

export type RootPolicy = {
  inPlace: boolean;
  /** Mixamo Character is Rx(-90); hips.z is HEIGHT. Never zero Z. */
  mixamoCharacterSpace: boolean;
};

/**
 * Concordia translates the actor. Strip horizontal hips drift only.
 * Mixamo Soldier stores height on hips.z (Character Rx -90). Zeroing Z buries the mesh.
 */
export function makeInPlace(
  clip: THREE.AnimationClip,
  policy: RootPolicy = { inPlace: true, mixamoCharacterSpace: true },
): THREE.AnimationClip {
  if (!policy.inPlace) return clip;
  const c = clip.clone();
  c.tracks = c.tracks.map((track) => {
    if (!/hips/i.test(track.name) || !track.name.endsWith(".position")) return track;
    if (!(track instanceof THREE.VectorKeyframeTrack)) return track;
    const v = track.values.slice();
    for (let i = 0; i < v.length; i += 3) {
      v[i] = 0;
      if (!policy.mixamoCharacterSpace) {
        v[i + 2] = 0;
      }
    }
    return new THREE.VectorKeyframeTrack(track.name, track.times.slice(), v);
  });
  return c;
}

export function makeInPlaceClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips;
}