/**
 * FIX-forestry-011 — forestry helper text and stand metadata sat at
 * zinc-500 on the dark theme (below AA for 10px text). The four
 * text instances — the InciWeb source line, the per-fire mapped
 * metadata, the growth formula note, and the stand id — are raised
 * to zinc-400, the platform's readable step from the §3 bundles.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-forestry-011 — forestry contrast', () => {
  it('no zinc-500 text remains anywhere in the forestry tree', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'forestry')).filter((x) => x.endsWith('.tsx')).map((x) => `components/forestry/${x}`),
      'app/lenses/forestry/page.tsx',
    ];
    for (const f of files) {
      expect(read(f).includes('text-zinc-500'), `${f}: zinc-500 remains`).toBe(false);
    }
  });

  it('the four named instances carry zinc-400', () => {
    expect(read('components/forestry/FireIncidents.tsx')).toContain('Source: InciWeb');
    expect(read('components/forestry/FireIncidents.tsx').includes('text-zinc-400')).toBe(true);
    expect(read('components/forestry/GrowthProjectionPanel.tsx').includes('text-zinc-400')).toBe(true);
    expect(read('components/forestry/StandManager.tsx')).toContain('stand id');
    expect(read('components/forestry/StandManager.tsx').includes('text-zinc-400')).toBe(true);
  });
});
