/**
 * FIX-self-004 — the Overview showed only the pinned tiles
 * (Steps/Sleep/Workout/Mood by default); a logged Water reading was
 * invisible except inside the total count. The dashboard now reads
 * the ledger's readings feed, and names any metric that has readings
 * but no tile, pointing at the Customize control — derived from the
 * readings themselves, never from the totals (which mix old readings
 * with unpinned ones).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-self-004 — logged-but-unpinned metrics are named', () => {
  const s = read('components/self/OverviewDashboard.tsx');

  it('derives unshown metrics from the readings feed', () => {
    expect(s).toContain("lensRun<{ readings: Array<{ metric: string }> }>('self', 'readings', { limit: 500 })");
    expect(s).toContain('!tilesNow.includes(m)');
  });

  it('renders the also-in-your-ledger line with the Customize pointer', () => {
    expect(s).toContain('Also in your ledger:');
    expect(s).toContain('use Customize to pin');
  });
});
