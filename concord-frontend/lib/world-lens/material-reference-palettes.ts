/**
 * Real-photo-adjacent color statistics for 3 material kinds (leather,
 * metal, cloth) that procedural-texture.ts's makePBR() synthesizes but
 * previously colored from hand-picked hex constants.
 *
 * Provenance note (read this before treating these the same as
 * terrain-reference-palettes.ts): these are sampled from Roblox's own
 * SurfaceAppearance material-reference gallery (creator-docs repo,
 * content/en-us/assets/modeling/surface-appearance/*.png — same
 * CC-BY-4.0 license as the terrain photos, see public/models/CREDITS.md)
 * — rendered PBR-material preview spheres (WornLeather, WornMetals,
 * CottonCanvasDenim), NOT flat photographed material swatches the way
 * the terrain JPEGs are. They are real reference renders of real
 * material presets, sampled with a center-crop (45% of the frame) to
 * stay inside the sphere and away from the white page background, and
 * an 8th/92nd luminance-percentile pick for dark/light (not a literal
 * min/max) so the specular highlight and silhouette ambient-occlusion
 * — lighting artifacts of a rendered sphere, not material color — don't
 * skew the result the way they would for a flat-lit photograph.
 *
 * Unlike the terrain photos, these preview images are not shipped in
 * the repo or displayed anywhere — only the extracted avg/dark/light
 * statistics below are used, by the same one-time headless-Chromium
 * canvas-sampling methodology as terrain-reference-palettes.ts.
 */

export interface MaterialReferencePalette {
  avg: readonly [number, number, number];
  dark: readonly [number, number, number];
  light: readonly [number, number, number];
}

export const MATERIAL_REFERENCE_PALETTES: Record<string, MaterialReferencePalette> = {
  leather: { avg: [116, 75, 59], dark: [95, 57, 39], light: [136, 92, 74] },
  metal:   { avg: [123, 102, 75], dark: [58, 40, 19], light: [247, 200, 148] },
  cloth:   { avg: [230, 209, 168], dark: [201, 181, 142], light: [251, 229, 187] },
};
