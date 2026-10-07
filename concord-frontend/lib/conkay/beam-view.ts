/**
 * View options and the utilization colour ramp for the ConKay beam viewport.
 * Pure — the WebGL viewport and the 2-D legend/sweep table share them.
 */

export type ViewPreset = 'isometric' | 'front' | 'top' | 'end';
export type DisplayMode = 'solid' | 'wire' | 'stress' | 'wire-stress';

export const VIEW_LABELS: Record<ViewPreset, string> = {
  isometric: 'Isometric', front: 'Front', top: 'Top', end: 'End',
};
export const DISPLAY_LABELS: Record<DisplayMode, string> = {
  solid: 'Solid', wire: 'Wire', stress: 'Stress', 'wire-stress': 'Wire + Stress',
};


/** Utilization → colour: cool under half capacity, amber near yield, red over. */
export function utilizationColor(u: number): string {
  if (!Number.isFinite(u)) return '#64748b';
  const stops: Array<[number, [number, number, number]]> = [
    [0, [56, 189, 248]],
    [0.5, [52, 211, 153]],
    [0.8, [250, 204, 21]],
    [1, [239, 68, 68]],
  ];
  const v = Math.max(0, Math.min(1, u));
  for (let i = 1; i < stops.length; i++) {
    const [u1, c1] = stops[i];
    const [u0, c0] = stops[i - 1];
    if (v <= u1) {
      const t = (v - u0) / (u1 - u0);
      const c = c0.map((x, k) => Math.round(x + (c1[k] - x) * t));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return 'rgb(239, 68, 68)';
}
