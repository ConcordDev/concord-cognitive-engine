// lib/conkay/fea-util-color.ts
//
// Deterministic utilization → contour band → RGB for the ConKay industrial
// slice (FEA_FRAME → Unity marker). Thresholds MUST match server
// `utilizationBand` / runFEA contour in server/domains/engineering.js
// (0.4 / 0.75 / 1.0). Not continuous stressToColor — band colors are the
// industrial contract so Unity marker hue matches the solver band label.

export type FeaUtilBand = 'low' | 'moderate' | 'high' | 'overstressed';

export interface FeaBandColor {
  band: FeaUtilBand;
  /** CSS hex #rrggbb */
  hex: string;
  /** 0–1 channels for Unity spawn_primitive / set_color */
  rgba: { r: number; g: number; b: number; a: number };
}

/** Same thresholds as engineering.utilizationBand / runFEA contour. */
export function utilizationBand(u: number): FeaUtilBand {
  if (!Number.isFinite(u)) return 'low';
  if (u > 1) return 'overstressed';
  if (u > 0.75) return 'high';
  if (u > 0.4) return 'moderate';
  return 'low';
}

/** Fixed band → color map (green → yellow → orange → red). */
export const FEA_BAND_COLORS: Record<FeaUtilBand, Omit<FeaBandColor, 'band'>> = {
  low: { hex: '#22c55e', rgba: { r: 0.133, g: 0.773, b: 0.369, a: 1 } },
  moderate: { hex: '#eab308', rgba: { r: 0.918, g: 0.702, b: 0.031, a: 1 } },
  high: { hex: '#f97316', rgba: { r: 0.976, g: 0.451, b: 0.086, a: 1 } },
  overstressed: { hex: '#ef4444', rgba: { r: 0.937, g: 0.267, b: 0.267, a: 1 } },
};

/** Map a utilization ratio to band + hex + rgba. */
export function feaUtilToColor(utilization: number): FeaBandColor {
  const band = utilizationBand(utilization);
  const c = FEA_BAND_COLORS[band];
  return { band, hex: c.hex, rgba: { ...c.rgba } };
}
