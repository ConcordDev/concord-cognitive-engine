// lib/world-lens/atmosphere-profiles.ts
//
// WAVE ART — Layer 2 (world/atmosphere → "painterly"). The fastest coherence
// win: the post-FX stack (Rayleigh+Mie sky, volumetric fog, bloom, LUT,
// auto-exposure) is already shipped — this is the per-world TUNING data that
// gives each of the 9 genres its own painterly air. Pure data + accessor;
// additive (inert until the renderer reads it, behind CONCORD_ART_ATMOSPHERE).
// Palettes are lore-true (see the plan's Layer-2 spec).

export type Hex = string;

export interface AtmosphereProfile {
  palette: { primary: Hex; secondary: Hex; accent: Hex };
  fogColor: Hex;
  fogDensity: number;                 // 0..1
  sky: { turbidity: number; rayleigh: number; mieCoefficient: number; elevation: number };
  lightColor: Hex;
  exposure: number;                   // ACES exposure multiplier
  lut: string;                        // named colour grade
}

// 9 canon worlds (theme ids in concordia-theme.ts#CANON_WORLD_THEMES).
export const ATMOSPHERE_PROFILES: Record<string, AtmosphereProfile> = {
  "concordia-hub":      { palette: { primary: "#caa765", secondary: "#7a5a30", accent: "#ffe6a8" }, fogColor: "#d8b878", fogDensity: 0.12, sky: { turbidity: 6, rayleigh: 2.0, mieCoefficient: 0.006, elevation: 28 }, lightColor: "#ffe2a0", exposure: 1.0, lut: "warm-stone" },
  "tunya":              { palette: { primary: "#b83a1e", secondary: "#6e5236", accent: "#f0c060" }, fogColor: "#caa06a", fogDensity: 0.22, sky: { turbidity: 14, rayleigh: 1.0, mieCoefficient: 0.012, elevation: 18 }, lightColor: "#ffb060", exposure: 1.05, lut: "ember-ash" },
  "cyber":              { palette: { primary: "#ff2bd0", secondary: "#1fd07a", accent: "#b07838" }, fogColor: "#1a0a28", fogDensity: 0.35, sky: { turbidity: 10, rayleigh: 0.6, mieCoefficient: 0.02, elevation: 6 }, lightColor: "#ff70e0", exposure: 0.85, lut: "neon-rain" },
  "crime":              { palette: { primary: "#6b6258", secondary: "#3a342c", accent: "#8a7250" }, fogColor: "#2a2620", fogDensity: 0.28, sky: { turbidity: 8, rayleigh: 0.8, mieCoefficient: 0.01, elevation: 10 }, lightColor: "#9a8c78", exposure: 0.8, lut: "noir-lowkey" },
  "fantasy":            { palette: { primary: "#3fa05a", secondary: "#6a4a2a", accent: "#f0e090" }, fogColor: "#bfe0c8", fogDensity: 0.1, sky: { turbidity: 3, rayleigh: 3.0, mieCoefficient: 0.004, elevation: 38 }, lightColor: "#fff4d0", exposure: 1.15, lut: "ghibli-wildwood" },
  "superhero":          { palette: { primary: "#7a3cc8", secondary: "#1f8a8a", accent: "#ffd040" }, fogColor: "#2a2a44", fogDensity: 0.2, sky: { turbidity: 7, rayleigh: 1.4, mieCoefficient: 0.011, elevation: 14 }, lightColor: "#d0c0ff", exposure: 0.95, lut: "street-grit" },
  "sovereign-ruins":    { palette: { primary: "#cfc4ad", secondary: "#8a8270", accent: "#e8dcc0" }, fogColor: "#d8d0bc", fogDensity: 0.26, sky: { turbidity: 12, rayleigh: 1.6, mieCoefficient: 0.008, elevation: 22 }, lightColor: "#f0e8d4", exposure: 1.1, lut: "dust-bleached" },
  "lattice-crucible":   { palette: { primary: "#4878d8", secondary: "#d040c0", accent: "#a0f0ff" }, fogColor: "#101830", fogDensity: 0.3, sky: { turbidity: 5, rayleigh: 2.4, mieCoefficient: 0.015, elevation: 30 }, lightColor: "#88c0ff", exposure: 0.9, lut: "witness-iridescent" },
  "concord-link-frontier": { palette: { primary: "#6a9a4a", secondary: "#9a7838", accent: "#d8c068" }, fogColor: "#c8d0a0", fogDensity: 0.14, sky: { turbidity: 6, rayleigh: 2.2, mieCoefficient: 0.007, elevation: 26 }, lightColor: "#f0e8b0", exposure: 1.05, lut: "courier-pastoral" },
};

export const DEFAULT_ATMOSPHERE_ID = "concordia-hub";

/** The atmosphere profile for a world theme id (falls back to the hub). */
export function atmosphereForWorld(themeId: string | null | undefined): AtmosphereProfile {
  if (themeId && themeId in ATMOSPHERE_PROFILES) return ATMOSPHERE_PROFILES[themeId];
  return ATMOSPHERE_PROFILES[DEFAULT_ATMOSPHERE_ID];
}
