/**
 * Maker F5 fix return — source pins (vitest on the Mac lane; node:test
 * fallback via run-vitest-as-node). The Bench names the pre-build
 * records still sitting in App Maker — origin carried — and imports
 * one onto the bench only at the owner's act; nothing auto-moves.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const page = fs.readFileSync(
  path.resolve(__dirname, '../app/lenses/maker/page.tsx'),
  'utf8',
);
const domain = fs.readFileSync(
  path.resolve(__dirname, '../../server/domains/maker.js'),
  'utf8',
);

describe('maker F5 — displaced-record reclaim', () => {
  it('the server registers reclaimables + reclaim, keyed on the app-maker store', () => {
    expect(domain).toContain('register("maker", "reclaimables"');
    expect(domain).toContain('register("maker", "reclaim"');
    expect(domain).toContain('appMakerLens');
    expect(domain).toContain('reclaimedAsMake');
  });

  it('the bench reads reclaimables through the maker domain', () => {
    expect(page).toContain("lensRun<{ projects?: unknown }>('maker', 'reclaimables', {})");
    expect(page).toContain("lensRun<{ make?: { id?: string } }>('maker', 'reclaim', { projectId: item.id })");
  });

  it('the reclaim strip names the re-homing with origin carried', () => {
    expect(page).toContain('data-testid="maker-reclaim"');
    expect(page).toContain('From before the bench had its own store');
    expect(page).toContain('· App Maker');
    expect(page).toContain('Import as make');
  });

  it('the strip renders only when reclaimables exist', () => {
    expect(page).toContain('reclaimables.length > 0');
  });
});
