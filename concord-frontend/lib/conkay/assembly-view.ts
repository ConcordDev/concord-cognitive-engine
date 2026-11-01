// View math for the assembly viewer. Vehicle frame: x rearward, y right, z up.
// Three.js frame: y up. (x, y, z) -> (x, z, -y).

export interface ExplodePart {
  id: string;
  placement: { x: number; y: number; z: number };
  explode?: { axis: "x" | "y" | "z"; sign: number; rank: number };
}

export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

/** Slider 0 stays assembled. Each part moves along its own axis by rank. */
export function explodedShift(part: ExplodePart, t: number): [number, number, number] {
  const e = part.explode || { axis: "z", sign: 1, rank: 0 };
  const d = Math.max(0, Math.min(1, t)) * e.rank * e.sign * 0.22;
  const v = { x: 0, y: 0, z: 0 };
  v[e.axis] = d;
  return [part.placement.x + v.x, part.placement.y + v.y, part.placement.z + v.z];
}

/**
 * The explode SEQUENCE (HANDOFF-3 A5): the car comes apart subsystem by
 * subsystem in build order. `subsystemOf` maps every component to exactly one
 * step — exterior skin and its fittings are the body, the glass is its own
 * step, doors carry their handles, cargo volumes ride with the interior, and
 * the wheels roll with the chassis they bolt to.
 */
export const EXPLODE_SUBSYSTEMS = [
  { id: "body", label: "Body" },
  { id: "glazing", label: "Glazing" },
  { id: "doors", label: "Doors" },
  { id: "interior", label: "Interior" },
  { id: "powertrain", label: "Powertrain" },
  { id: "chassis", label: "Chassis" },
] as const;
export type ExplodeSubsystem = (typeof EXPLODE_SUBSYSTEMS)[number]["id"];

export function subsystemOf(part: { group?: string; role?: string }): ExplodeSubsystem {
  if (part.group === "exterior") {
    if (part.role === "glass") return "glazing";
    if (part.role === "opening" || part.role === "handle") return "doors";
    return "body";
  }
  if (part.group === "interior" || part.group === "storage") return "interior";
  if (part.group === "powertrain") return "powertrain";
  return "chassis";
}

/**
 * How far one part is exploded at sequence position `pos` (0..subsystem
 * count). Subsystems before the position are fully out, the one at the
 * position is part-way, the rest are still assembled — so stepping moves
 * only the current subsystem's parts.
 */
export function explodeAmountFor(part: { group?: string; role?: string }, pos: number): number {
  const idx = EXPLODE_SUBSYSTEMS.findIndex((s) => s.id === subsystemOf(part));
  const t = pos - idx;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * Clipping plane in three.js space (normal, constant) that removes the
 * positive side of the vehicle axis at `position` metres.
 * THREE.Plane discards pixels where normal·point + constant < 0.
 * `originX` is the vehicle x the viewer places at the world origin.
 */
export function sectionPlane(axis: "x" | "y" | "z", position: number, originX = 0): { normal: [number, number, number]; constant: number } {
  // The scene group is shifted by -originX along x (the car is centred on the
  // origin), and clipping planes live in world space, so shift the cut too.
  if (axis === "x") return { normal: [1, 0, 0], constant: -(position - originX) };
  if (axis === "y") return { normal: [0, 0, 1], constant: position };
  return { normal: [0, -1, 0], constant: position };
}
