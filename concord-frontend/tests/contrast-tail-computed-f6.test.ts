/**
 * C-CONTRAST-TAIL F6 — the two locatable computed-colour rows.
 *
 * ffffff_on_13a797 (calendar) and ffffff_on_14a797 (projects) have no
 * literal source: they are composites. The identification is exact —
 * teal-500 #14b8a6 at 90% over #0a0a0f computes to #13a797, and over
 * #111111 to #14a797, digit for digit the walker's measured grounds.
 * Both sources are `bg-teal-500/90` buttons with white text
 * (CalendarGridWorkbench, ProjectsKeepMenu). The cure steps the fill to
 * teal-700 at the same alpha: composite 6.17–6.35:1 across the ground
 * range. The remaining computed-colour rows (12 signatures) have no
 * source anywhere in the tree — filed as unlocatable in the premise's
 * hunt record, not blind-fixed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '@/lib/social/contrast';

const root = resolve(__dirname, '..');

function composite(fill: string, alpha: number, ground: string): string {
  const f = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16));
  const g = [0, 2, 4].map((i) => parseInt(ground.slice(i, i + 2), 16));
  return f.map((v, i) => Math.round(alpha * v + (1 - alpha) * g[i]).toString(16).padStart(2, '0')).join('');
}

describe('premise: the composites are the measured grounds and fail AA', () => {
  it('teal-500/90 computes to the walker hexes at 3.0:1', () => {
    expect(composite('14b8a6', 0.9, '0a0a0f')).toBe('13a797');
    expect(composite('14b8a6', 0.9, '111111')).toBe('14a797');
    expect(contrastRatio('#ffffff', '#13a797')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#14a797')).toBeLessThan(4.5);
  });
});

describe('fix: teal-700/90 clears AA and is what the buttons carry', () => {
  it('the new composite is at least 4.5 across the ground range', () => {
    for (const g of ['0a0a0f', '111111', '1d1d22']) {
      expect(contrastRatio('#ffffff', composite('0f766e', 0.9, g))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('both buttons stepped', () => {
    for (const f of ['components/calendar/CalendarGridWorkbench.tsx', 'components/projects/ProjectsKeepMenu.tsx']) {
      const src = readFileSync(resolve(root, f), 'utf8');
      expect(src).toContain('bg-teal-700/90');
      expect(src).not.toContain('bg-teal-500/90');
    }
  });
});
