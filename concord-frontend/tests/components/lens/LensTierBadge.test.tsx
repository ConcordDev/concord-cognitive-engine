/**
 * LensTierBadge presentational + manifest-drift tests.
 *
 * Pins:
 *   - SCAFFOLD lens renders "Experimental" badge with amber tone
 *   - DEEP / MODERATE / THIN / undefined lenses render nothing
 *   - Every lens classified SCAFFOLD in docs/PHASE12_AUDIT_lens-classification.csv
 *     has tier: 'SCAFFOLD' on its frontend manifest entry (drift guard)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock the manifest lookup so we can drive the badge regardless of the
// real manifest contents.
const mockManifest = vi.fn();
vi.mock('@/lib/lenses/manifest', () => ({
  getLensManifest: (id: string) => mockManifest(id),
}));

import { LensTierBadge } from '@/components/lens/LensTierBadge';

function badgeOf(c: HTMLElement): HTMLElement | null {
  return c.querySelector('[data-testid="lens-tier-badge"]');
}

describe('LensTierBadge — SCAFFOLD renders', () => {
  beforeEach(() => mockManifest.mockReset());

  it('renders Experimental badge with amber tone when tier is SCAFFOLD', () => {
    mockManifest.mockReturnValue({ domain: 'answers', tier: 'SCAFFOLD' });
    const { container, getByText } = render(<LensTierBadge lensId="answers" />);
    expect(badgeOf(container)?.getAttribute('data-tier')).toBe('SCAFFOLD');
    expect(badgeOf(container)?.className).toMatch(/amber/);
    expect(getByText('Experimental')).toBeTruthy();
  });

  it('uses sm size class when size="sm"', () => {
    mockManifest.mockReturnValue({ domain: 'answers', tier: 'SCAFFOLD' });
    const { container } = render(<LensTierBadge lensId="answers" size="sm" />);
    expect(badgeOf(container)?.className).toMatch(/text-\[10px\]/);
  });
});

describe('LensTierBadge — non-SCAFFOLD renders nothing', () => {
  beforeEach(() => mockManifest.mockReset());

  for (const tier of ['DEEP', 'MODERATE', 'THIN', undefined]) {
    it(`renders null when tier=${String(tier)}`, () => {
      mockManifest.mockReturnValue(tier === undefined ? { domain: 'x' } : { domain: 'x', tier });
      const { container } = render(<LensTierBadge lensId="x" />);
      expect(badgeOf(container)).toBeNull();
    });
  }

  it('renders null when manifest is missing entirely', () => {
    mockManifest.mockReturnValue(undefined);
    const { container } = render(<LensTierBadge lensId="missing" />);
    expect(badgeOf(container)).toBeNull();
  });
});

describe('LensTierBadge — manifest drift guard', () => {
  it('every lens classified SCAFFOLD in the audit CSV is tier=SCAFFOLD in manifest.ts', async () => {
    // Read audit CSV
    const csvPath = resolve(__dirname, '../../../../docs/PHASE12_AUDIT_lens-classification.csv');
    const csv = readFileSync(csvPath, 'utf-8');
    const scaffolds = csv
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(',SCAFFOLD'))
      .map((line) => line.split(',')[0]);

    expect(scaffolds.length).toBeGreaterThan(0);

    // Reset the mock so the real manifest lookups (via the actual module)
    // surface — unmock by importing directly here.
    vi.doUnmock('@/lib/lenses/manifest');
    const { getLensManifest } = await vi.importActual<
      typeof import('@/lib/lenses/manifest')
    >('@/lib/lenses/manifest');

    const missing: string[] = [];
    for (const lensId of scaffolds) {
      const m = getLensManifest(lensId);
      if (!m) {
        missing.push(`${lensId} (no manifest entry)`);
        continue;
      }
      if (m.tier !== 'SCAFFOLD') {
        missing.push(`${lensId} (tier=${m.tier ?? 'undefined'})`);
      }
    }

    expect(missing).toEqual([]);
  });
});
