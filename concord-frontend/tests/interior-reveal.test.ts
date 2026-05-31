// WAVE WD — interior reveal decision (pure, headless).
import { describe, it, expect } from 'vitest';
import {
  shouldRevealInterior,
  DOOR_REACH_M,
  ZOOM_REVEAL_RADIUS_M,
} from '@/lib/world-lens/interior-reveal';

describe('shouldRevealInterior', () => {
  it('never reveals when the feature is disabled (off == today)', () => {
    expect(shouldRevealInterior({ enabled: false, distanceM: 1, zoomLevel: 'interior', enteredViaDoor: true })).toBe(false);
  });

  it('reveals on a deliberate door entry within reach', () => {
    expect(shouldRevealInterior({ enabled: true, distanceM: DOOR_REACH_M - 1, zoomLevel: 'mid', enteredViaDoor: true })).toBe(true);
  });

  it('does not reveal a door entry from out of reach', () => {
    expect(shouldRevealInterior({ enabled: true, distanceM: DOOR_REACH_M + 1, zoomLevel: 'mid', enteredViaDoor: true })).toBe(false);
  });

  it('reveals on zoom into the interior band when standing near', () => {
    expect(shouldRevealInterior({ enabled: true, distanceM: ZOOM_REVEAL_RADIUS_M - 1, zoomLevel: 'interior' })).toBe(true);
  });

  it('does not reveal on zoom when too far from the building', () => {
    expect(shouldRevealInterior({ enabled: true, distanceM: ZOOM_REVEAL_RADIUS_M + 5, zoomLevel: 'interior' })).toBe(false);
  });

  it('does not reveal at a non-interior zoom without a door entry', () => {
    expect(shouldRevealInterior({ enabled: true, distanceM: 1, zoomLevel: 'isometric' })).toBe(false);
  });

  it('treats NaN distance as no-reveal', () => {
    expect(shouldRevealInterior({ enabled: true, distanceM: NaN, zoomLevel: 'interior', enteredViaDoor: true })).toBe(false);
  });
});
