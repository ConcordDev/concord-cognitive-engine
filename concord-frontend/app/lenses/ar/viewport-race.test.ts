// FIX-ar-004: the AR preview init is async (dynamic three import) and a
// re-run while an earlier init was in flight orphaned it — the two inits
// raced to own the viewport container and the stale one could win, so
// Start preview showed the idle scene and the capture viewport kept a
// previous one-object scene. Source-pin: a generation guard orphans any
// superseded init, and the effect cleanup marks disposal directly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'page-client.tsx'), 'utf8');

describe('AR viewport init race (FIX-ar-004)', () => {
  it('inits carry a generation that the await boundary checks', () => {
    expect(SRC).toContain('const gen = ++initGenRef.current;');
    expect(SRC).toContain('if (disposed || gen !== initGenRef.current || !container) return;');
  });

  it('the effect cleanup marks disposal itself', () => {
    expect(SRC).toMatch(/return \(\) => \{\s*\n\s*disposed = true;/);
  });
});
