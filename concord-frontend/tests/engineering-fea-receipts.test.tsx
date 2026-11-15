/**
 * FIX-engineering-011 — the FEA summary strip showed displacement,
 * utilization and PASS only, although the solver returns support
 * reactions and per-member end moments with every run. The page now
 * also receipts the factor of safety (1 ÷ max utilization), the max
 * bending moment, and the support reactions by node.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-engineering-011 — FEA receipts', () => {
  const s = read('app/lenses/engineering/page.tsx');

  it('shows factor of safety, max moment, and reactions', () => {
    expect(s).toContain('Factor of Safety');
    expect(s).toContain('1 / summary.maxUtilization');
    expect(s).toContain('Max Bending Moment');
    expect(s).toContain('Support Reactions');
    expect(s).toContain('reactionsByNode');
  });
});
