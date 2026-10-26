/** Unit grid, scale bar, and dimension labels for a real-scale mesh. No three.js. */

export interface MeshSize {
  bbox_mm?: { length?: number; height?: number; width?: number } | null;
  units?: string | null;
  geometryUnits?: string | null;
  scaleNote?: string | null;
  extents_mm?: { x?: number; y?: number; z?: number } | null;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function trimNumber(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/** 1/2/5 × 10^n nearest to span/8. gridStep(80) === 10. */
export function gridStep(span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const target = span / 8;
  const exp = Math.floor(Math.log10(target));
  const base = 10 ** exp;
  const n = target / base;
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return m * base;
}

/** 1/2/5 × 10^n nearest to span/4, never longer than the span. scaleBarLength(400) === 100. */
export function scaleBarLength(span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const target = span / 4;
  const exp = Math.floor(Math.log10(target));
  const base = 10 ** exp;
  const n = target / base;
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  const len = m * base;
  return len > span ? span : len;
}

/** Inline metre positions become millimetres in the viewer. A GLB URL is already in its file units. */
export function displayScale(opts: { usingPositions: boolean; geometryUnits?: string | null; units?: string | null }): number {
  if (opts.usingPositions && opts.geometryUnits === 'm' && opts.units === 'mm') return 1000;
  return 1;
}

export function isUnitless(mesh: MeshSize): boolean {
  return mesh.units === 'unitless' || mesh.scaleNote === 'unitless (not to scale)';
}

export function dimensionLabel(mesh: MeshSize): string {
  const b = mesh.bbox_mm;
  if (b && finite(b.length) && finite(b.height) && finite(b.width) && b.length > 0 && b.height > 0 && b.width > 0) {
    return `${trimNumber(b.length)} × ${trimNumber(b.height)} × ${trimNumber(b.width)} mm (long × tall × wide)`;
  }
  if (isUnitless(mesh)) return 'unitless (not to scale)';
  const e = mesh.extents_mm;
  if (mesh.units === 'mm' && e && finite(e.x) && finite(e.y) && finite(e.z)) {
    return `X ${trimNumber(e.x)} × Y ${trimNumber(e.y)} × Z ${trimNumber(e.z)} mm`;
  }
  return '';
}

/** Longest real millimetre span. Unitless meshes have none. */
export function spanMm(mesh: MeshSize): number {
  if (isUnitless(mesh)) return 0;
  const b = mesh.bbox_mm;
  if (b && finite(b.length) && finite(b.height) && finite(b.width)) {
    return Math.max(b.length, b.height, b.width);
  }
  const e = mesh.extents_mm;
  if (mesh.units === 'mm' && e && finite(e.x) && finite(e.y) && finite(e.z)) {
    return Math.max(Math.abs(e.x), Math.abs(e.y), Math.abs(e.z));
  }
  return 0;
}
