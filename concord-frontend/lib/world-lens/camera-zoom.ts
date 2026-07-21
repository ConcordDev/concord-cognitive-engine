/**
 * Maps the Camera Mode panel's 0-100 zoom slider value to a distance-scale
 * multiplier for the Follow/Interior camera's `dist`/`height` locals in
 * ConcordiaScene.tsx. Zero-width at the slider's default (15) so wiring the
 * previously-no-op onZoom handler doesn't change the camera's default
 * position — only interacting with the slider does.
 */

export const DEFAULT_CAMERA_ZOOM = 15;
const MAX_SCALE = 1.6; // zoom = 0  → camera pulls back (wide view)
const MIN_SCALE = 0.5; // zoom = 100 → camera pulls in (tight view)

export function zoomToDistScale(zoom: number): number {
  const z = Math.max(0, Math.min(100, zoom));
  if (z <= DEFAULT_CAMERA_ZOOM) {
    const t = z / DEFAULT_CAMERA_ZOOM;
    return MAX_SCALE + (1 - MAX_SCALE) * t;
  }
  const t = (z - DEFAULT_CAMERA_ZOOM) / (100 - DEFAULT_CAMERA_ZOOM);
  return 1 + (MIN_SCALE - 1) * t;
}
