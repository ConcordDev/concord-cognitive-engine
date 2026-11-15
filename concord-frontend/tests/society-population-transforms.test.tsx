/**
 * FIX-society-008 — plotting the population series with per-capita on
 * produced a flat line at 1 (population ÷ population) and the
 * inflation toggle deflated a headcount. Both transforms are now
 * disabled for the population indicator with the reason on the
 * label, and the recompute effect uses effective flags so a toggle
 * left on from another indicator cannot transform it either.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-society-008 — transforms do not apply to population', () => {
  const s = read('components/society/DataExplorer.tsx');

  it('toggles disable on the population indicator', () => {
    expect(s).toContain("disabled={indicator === 'population'}");
    expect(s).toContain('Not applicable to the population series');
  });

  it('the recompute effect uses effective flags', () => {
    expect(s).toContain("const effPerCapita = perCapita && indicator !== 'population';");
    expect(s).toContain('perCapita: effPerCapita, inflationAdjust: effInflation');
  });
});
