/**
 * Real-photo color statistics sampled from the 7 CC-BY-4.0 terrain ground
 * textures (public/models/terrain/*.jpg — see public/models/CREDITS.md).
 * Extracted once via a headless-Chromium canvas sample (average color,
 * darkest sampled tone, lightest sampled tone; every 4th pixel of a
 * 640x640 render, ~102k samples per image). Feeds procedural-texture.ts's
 * synthetic PBR generator so its noise/speckle patterns are grounded in
 * real photographed color palettes instead of hand-picked hex constants —
 * "use the real photos as base references to make more combinations": an
 * infinite (kind, seed) space, now anchored to real color data rather than
 * eyeballed guesses.
 */

export interface ReferencePalette {
  /** Average RGB across the sampled image, 0-255 each. */
  avg: readonly [number, number, number];
  /** Darkest sampled tone (by luminance) — shadow/crevice color. */
  dark: readonly [number, number, number];
  /** Lightest sampled tone (by luminance) — highlight color. */
  light: readonly [number, number, number];
}

export const TERRAIN_REFERENCE_PALETTES: Record<string, ReferencePalette> = {
  grass:       { avg: [91, 114, 59],   dark: [7, 33, 4],     light: [216, 209, 203] },
  dirt:        { avg: [99, 95, 95],    dark: [18, 35, 43],   light: [193, 175, 175] },
  cobblestone: { avg: [135, 141, 142], dark: [0, 31, 51],    light: [224, 210, 201] },
  sand:        { avg: [209, 195, 180], dark: [140, 136, 124], light: [245, 226, 211] },
  asphalt:     { avg: [106, 118, 135], dark: [6, 38, 63],    light: [157, 163, 177] },
  brick:       { avg: [146, 102, 84],  dark: [9, 5, 2],      light: [222, 210, 198] },
  gravel:      { avg: [105, 103, 91],  dark: [1, 19, 21],    light: [204, 191, 157] },
};
