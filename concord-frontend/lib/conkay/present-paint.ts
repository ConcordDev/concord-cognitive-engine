/**
 * Studio paints. `graphite` is the same clearcoat metallic the Cycles studio
 * render (server/lib/conkay/cad/render_studio.py) and the presentation GLB
 * (server/lib/conkay/assembly/present-glb.js PRESENT_PAINT) use, so the
 * three views of one design look like one car. Base colours are linear RGB,
 * as in glTF. Paint is presentation only: it never touches geometry.
 */
export interface StudioPaint {
  label: string;
  baseColor: [number, number, number];
  metallic: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

export const STUDIO_PAINTS = {
  graphite: { label: 'Graphite', baseColor: [0.1, 0.11, 0.13], metallic: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 },
  silver: { label: 'Silver', baseColor: [0.79, 0.8, 0.85], metallic: 0.9, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05 },
} satisfies Record<string, StudioPaint>;

export type StudioPaintId = keyof typeof STUDIO_PAINTS;

/** Same-origin CC0 sky (see public/conkay/hdri/README.md). */
export const STUDIO_HDRI_URL = '/conkay/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr';

/** URL of a showcase design's presentation GLB (analysed solid + clearcoat material). */
export function presentGlbUrl(designId: string): string {
  return `/api/conkay/demo/designs/${encodeURIComponent(designId)}/present.glb`;
}
