/** Measure, section, parts, and standard views. No three.js import. */

export type Vec3 = [number, number, number];

export function measureDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Keep the last two points. A third click starts the next pair. */
export function pushMeasurePoint(points: Vec3[], next: Vec3): Vec3[] {
  return [...points, next].slice(-2);
}

/** Plane with normal +X. Points with x < at are clipped (dot(n, p) + constant < 0). */
export function sectionPlaneAt(at: number): { normal: Vec3; constant: number } {
  return { normal: [1, 0, 0], constant: -at };
}

export function sectionAt(min: number, max: number, t: number): number {
  if (!(max > min)) return min;
  const u = Math.min(1, Math.max(0, t));
  return min + (max - min) * u;
}

export interface ClipMaterial {
  clippingPlanes?: unknown;
  needsUpdate?: boolean;
}

export interface ClipObject {
  name?: string;
  isMesh?: boolean;
  material?: ClipMaterial | ClipMaterial[];
  children?: ClipObject[];
  traverse?: (fn: (obj: ClipObject) => void) => void;
}

/** Assign clipping planes to every mesh, including one named "tyre". Returns how many meshes were updated. */
export function applySectionClip(root: ClipObject, planes: unknown[]): number {
  let count = 0;
  const touch = (obj: ClipObject) => {
    if (!(obj.isMesh || obj.name === 'tyre')) return;
    const mats = obj.material == null ? [] : (Array.isArray(obj.material) ? obj.material : [obj.material]);
    for (const m of mats) {
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    count += 1;
  };
  if (typeof root.traverse === 'function') {
    root.traverse(touch);
    return count;
  }
  const walk = (obj: ClipObject) => {
    touch(obj);
    for (const child of obj.children || []) walk(child);
  };
  walk(root);
  return count;
}

export function partVisibility(id: string, hidden: ReadonlySet<string>, isolated: string | null): boolean {
  if (isolated) return isolated === id;
  return !hidden.has(id);
}

export const VIEW_DIRECTION = {
  front: { position: [0, 0, 1] as Vec3, label: 'Front (+Z)' },
  top: { position: [0, 1, 0] as Vec3, label: 'Top (+Y)' },
  side: { position: [1, 0, 0] as Vec3, label: 'Side (+X)' },
  iso: { position: [1, 0.7, 1] as Vec3, label: 'Isometric' },
} as const;

export type StandardView = keyof typeof VIEW_DIRECTION;

export function axisSpan(positions: number[], axis: 0 | 1 | 2): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = axis; i < positions.length; i += 3) {
    const v = positions[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

export interface PartRange {
  name?: string;
  nodeName?: string;
  i0?: number;
  i1?: number;
}

/** Indices that belong to parts the user has not hidden. */
export function visibleIndices(indices: number[], ranges: PartRange[] | undefined, hidden: ReadonlySet<string>, isolated: string | null): number[] {
  if (!ranges?.length) {
    if (isolated || hidden.size > 0) return [];
    return indices;
  }
  const out: number[] = [];
  for (const r of ranges) {
    const id = r.nodeName || r.name || '';
    if (!partVisibility(id, hidden, isolated)) continue;
    if (!Number.isFinite(r.i0) || !Number.isFinite(r.i1)) continue;
    for (let i = r.i0 as number; i < (r.i1 as number) && i < indices.length; i++) out.push(indices[i]);
  }
  return out;
}

export function massLabel(engineering?: { massKg?: number | null; massNote?: string | null } | null): string {
  const kg = engineering?.massKg;
  if (typeof kg === 'number' && Number.isFinite(kg)) {
    const rounded = Math.round(kg * 1000) / 1000;
    return `${rounded} kg`;
  }
  return engineering?.massNote ? String(engineering.massNote) : '';
}

export const STEP_EXPORT = {
  available: true,
  kind: 'faceted',
  label: 'STEP (faceted)',
  note: 'Faceted triangle STEP (AP214-style). Not an OpenCascade or SolidWorks B-rep solid.',
} as const;
