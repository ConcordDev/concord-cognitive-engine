/**
 * FIX-materials-012 — materials muted subtitles and labels sat at
 * zinc-500 on the dark theme. The text instances — the fractography
 * reference line, the periodic-table placeholder, placeholder-cell
 * labels, "not authoritatively known", the search helper note,
 * material ids, and field labels — are raised to zinc-400.
 * Decorative icon glyphs are untouched.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-materials-012 — materials contrast', () => {
  it('the two text-bearing files carry no zinc-500 text classes', () => {
    for (const f of ['components/materials/FractographyPanel.tsx']) {
      expect(read(f).includes('text-zinc-500'), `${f} zinc-500`).toBe(false);
    }
    const pt = read('components/materials/PeriodicTable.tsx');
    // the only surviving zinc-500 is the decorative Search icon
    const hits = pt.split('\n').filter((l) => l.includes('text-zinc-500'));
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('Search className');
    expect(pt.includes('placeholder:text-zinc-500')).toBe(false);
  });

  it('labels and placeholders are raised to zinc-400', () => {
    const pt = read('components/materials/PeriodicTable.tsx');
    expect(pt).toContain('placeholder:text-zinc-400');
    expect(pt).toContain('uppercase tracking-wider text-zinc-400');
    expect(read('components/materials/FractographyPanel.tsx')).toContain('text-[9px] text-zinc-400');
  });
});
