// concord-frontend/lib/system/gradient-client.ts
//
// Client mirror of the server world-gradient band math (server/lib/world-gradient.js).
// Fetched config + anchor once on world entry, then the danger band is computed
// LOCALLY from the live player pose every throttled frame — no per-frame poll.
// Kept deliberately tiny + pure; must stay in sync with the server formulas.

export interface GradientConfig {
  worldRadiusM: number;
  hubRadiusM: number;
  bandCount: number;
  dangerCurve: number;
  frontierLevel: number;
}
export interface HubAnchor { x: number; z: number; radiusM: number }

const BAND_NAMES = [
  'Sanctuary', 'Settled', 'Borderlands', 'Wilds', 'Deep Wilds', 'Frontier',
  'Deep Frontier', 'The Edge',
];

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

export function distanceFromHub(anchor: HubAnchor, x: number, z: number): number {
  return Math.hypot((x || 0) - (anchor.x || 0), (z || 0) - (anchor.z || 0));
}

export function dangerFraction(cfg: GradientConfig, distance: number): number {
  const span = Math.max(1, cfg.worldRadiusM - cfg.hubRadiusM);
  return clamp((distance - cfg.hubRadiusM) / span, 0, 1);
}

export function dangerBandAt(cfg: GradientConfig, anchor: HubAnchor, x: number, z: number): number {
  const frac = dangerFraction(cfg, distanceFromHub(anchor, x, z));
  return clamp(Math.floor(frac * cfg.bandCount), 0, cfg.bandCount - 1);
}

function levelAtFraction(cfg: GradientConfig, frac: number): number {
  return Math.max(1, Math.round(cfg.frontierLevel * Math.pow(clamp(frac, 0, 1), cfg.dangerCurve)));
}

export function bandLevelRange(cfg: GradientConfig, band: number): [number, number] {
  const b = clamp(Math.floor(band), 0, cfg.bandCount - 1);
  const minLevel = b === 0 ? 1 : levelAtFraction(cfg, b / cfg.bandCount) + 1;
  const maxLevel = Math.max(minLevel, levelAtFraction(cfg, (b + 1) / cfg.bandCount));
  return [minLevel, maxLevel];
}

export function bandName(cfg: GradientConfig, band: number): string {
  const b = clamp(Math.floor(band), 0, cfg.bandCount - 1);
  const idx = clamp(Math.round((b / Math.max(1, cfg.bandCount - 1)) * (BAND_NAMES.length - 1)), 0, BAND_NAMES.length - 1);
  return BAND_NAMES[idx];
}
