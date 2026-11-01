// Stat/form grids must collapse on phones (mobile-layout brief item 6): a bare
// `grid grid-cols-3|4 gap-N` squeezes each cell under ~90px at 390px wide.
// Write `grid grid-cols-1 md:grid-cols-N`. Game HUD directories are exempt.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BARE = /className="grid grid-cols-[34] gap-[0-9.]+(?: (?:mb|mt)-[0-9]+)?"/;
const EXEMPT = ['components/world/', 'components/world-lens/', 'components/concordia/'];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

describe('mobile grid ratchet', () => {
  it('has no bare non-collapsing 3/4-column grid in lens pages or lens components', () => {
    const root = process.cwd();
    const bad = [...walk(join(root, 'app/lenses')), ...walk(join(root, 'components'))]
      .filter((p) => !EXEMPT.some((e) => p.replace(/\\/g, '/').includes(e)))
      .filter((p) => BARE.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(root.length + 1));
    expect(bad).toEqual([]);
  });
});
