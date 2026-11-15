/**
 * FIX-export-009 — switching Toolkit/Gallery flashed the previous
 * tab half-faded over the new one: the page wrapped panels in an
 * AnimatePresence crossfade. Tab content now renders instantly on
 * switch.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-export-009 — instant tab switches', () => {
  const s = read('app/lenses/export/page.tsx');

  it('no crossfade wraps the tab panels', () => {
    expect(s).not.toContain('AnimatePresence');
    expect(s).not.toContain('motion.div');
    expect(s).toContain('<Panel />');
  });
});
