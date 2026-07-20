import { describe, it, expect } from 'vitest';
import { zoomToDistScale, DEFAULT_CAMERA_ZOOM } from '@/lib/world-lens/camera-zoom';

// Regression coverage for a live "Camera Mode" panel bug: the zoom slider
// rendered as fully interactive (drag it, watch the % readout change) but
// was wired to `onZoom={() => {}}` — a real no-op, closing zero visible
// distance. This module is the pure math behind the fix; page.tsx/
// ConcordiaScene.tsx wiring is covered by source-pin tests instead, since
// the page is too large to unit-render.
describe('zoomToDistScale', () => {
  it('is exactly 1.0 at the slider default (15), so wiring onZoom does not change the camera default', () => {
    expect(zoomToDistScale(DEFAULT_CAMERA_ZOOM)).toBe(1);
  });

  it('scales above 1.0 (camera pulls back) below the default', () => {
    expect(zoomToDistScale(0)).toBeGreaterThan(1);
    expect(zoomToDistScale(7)).toBeGreaterThan(1);
    expect(zoomToDistScale(7)).toBeLessThan(zoomToDistScale(0));
  });

  it('scales below 1.0 (camera pulls in) above the default', () => {
    expect(zoomToDistScale(100)).toBeLessThan(1);
    expect(zoomToDistScale(50)).toBeLessThan(1);
    expect(zoomToDistScale(100)).toBeLessThan(zoomToDistScale(50));
  });

  it('is monotonically decreasing across the whole 0-100 range', () => {
    let prev = zoomToDistScale(0);
    for (let z = 5; z <= 100; z += 5) {
      const cur = zoomToDistScale(z);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(zoomToDistScale(-50)).toBe(zoomToDistScale(0));
    expect(zoomToDistScale(500)).toBe(zoomToDistScale(100));
  });
});
