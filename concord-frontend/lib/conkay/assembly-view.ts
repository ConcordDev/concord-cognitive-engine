// View math for the assembly viewer. Vehicle frame: x rearward, y right, z up.
// Three.js frame: y up. (x, y, z) -> (x, z, -y).

export interface ExplodePart {
  id: string;
  placement: { x: number; y: number; z: number };
  explode?: { axis: 'x' | 'y' | 'z'; sign: number; rank: number };
}

export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export { studioHeroCamera } from './hero-camera.mjs';

/** Slider 0 stays assembled. Each part moves along its own axis by rank. */
export function explodedShift(part: ExplodePart, t: number): [number, number, number] {
  const e = part.explode || { axis: 'z', sign: 1, rank: 0 };
  const d = Math.max(0, Math.min(1, t)) * e.rank * e.sign * 0.22;
  const v = { x: 0, y: 0, z: 0 };
  v[e.axis] = d;
  return [part.placement.x + v.x, part.placement.y + v.y, part.placement.z + v.z];
}

/**
 * Clipping plane in three.js space (normal, constant) that removes the
 * positive side of the vehicle axis at `position` metres.
 * THREE.Plane discards pixels where normal·point + constant < 0.
 * `originX` is the vehicle x the viewer places at the world origin.
 */
export function sectionPlane(
  axis: 'x' | 'y' | 'z',
  position: number,
  originX = 0
): { normal: [number, number, number]; constant: number } {
  // The scene group is shifted by -originX along x (the car is centred on the
  // origin), and clipping planes live in world space, so shift the cut too.
  if (axis === 'x') return { normal: [1, 0, 0], constant: -(position - originX) };
  if (axis === 'y') return { normal: [0, 0, 1], constant: position };
  return { normal: [0, -1, 0], constant: position };
}
