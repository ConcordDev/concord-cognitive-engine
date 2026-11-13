// FIX-013: on mobile the lens MobileTabBar and the shell MobileNav were
// both fixed to bottom-0; the shell nav (z-50) painted over the tab bar
// (z-40) and intercepted its taps — the Code lens Search tab read as
// unclickable. Source-pin: the tab bar offsets above the shell nav's
// 3.5rem + safe-area height below md, and returns to bottom-0 at md+
// where the shell nav is hidden.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'MobileTabBar.tsx'), 'utf8');

describe('MobileTabBar stacking (FIX-013)', () => {
  it('offsets above the shell mobile nav below md', () => {
    expect(SRC).toContain('bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))]');
    expect(SRC).toContain('md:bottom-0');
  });

  it('no longer anchors to bottom-0 unconditionally', () => {
    expect(SRC).not.toContain("'fixed bottom-0 left-0 right-0 z-40");
  });
});
