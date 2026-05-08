import { describe, it, expect, beforeEach } from 'vitest';

import { useUIStore } from '@/store/ui';
import { ACCESSIBILITY_DEFAULTS } from '@/store/slices/accessibility';

function getSnapshot() {
  return useUIStore.getState();
}

describe('accessibility slice', () => {
  beforeEach(() => {
    useUIStore.getState().resetAccessibility();
    useUIStore.getState().setOsReducedMotion(false);
  });

  it('exposes the documented defaults', () => {
    expect(getSnapshot().accessibility).toEqual(ACCESSIBILITY_DEFAULTS);
  });

  it('setAccessibility updates a single key without dropping others', () => {
    const before = getSnapshot().accessibility;
    getSnapshot().setAccessibility('textScale', 1.5);
    const after = getSnapshot().accessibility;
    expect(after.textScale).toBe(1.5);
    expect(after.colorblindMode).toBe(before.colorblindMode);
    expect(after.highContrast).toBe(before.highContrast);
  });

  it('setAllAccessibility merges partial updates', () => {
    getSnapshot().setAllAccessibility({ highContrast: true, reducedMotion: true });
    const after = getSnapshot().accessibility;
    expect(after.highContrast).toBe(true);
    expect(after.reducedMotion).toBe(true);
    expect(after.textScale).toBe(ACCESSIBILITY_DEFAULTS.textScale);
  });

  it('resetAccessibility restores defaults', () => {
    getSnapshot().setAccessibility('colorblindMode', 'protanopia');
    getSnapshot().setAccessibility('textScale', 2);
    getSnapshot().resetAccessibility();
    expect(getSnapshot().accessibility).toEqual(ACCESSIBILITY_DEFAULTS);
  });

  it('osReducedMotion is a separate slice and does not mutate user prefs', () => {
    getSnapshot().setOsReducedMotion(true);
    expect(getSnapshot().osReducedMotion).toBe(true);
    expect(getSnapshot().accessibility.reducedMotion).toBe(false);
  });
});
