import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Palette-cohesion guard (W5 visual-cohesion SHELL): MyDashboard is the DEFAULT
// authenticated home surface and must match the login/lattice aesthetic. The
// orphan zinc-* palette was mapped onto lattice + gray tokens; this source-grep
// guard (mirroring the Sidebar purge-safety guard) asserts no zinc-* class
// leaks back in.
describe('MyDashboard palette cohesion', () => {
  it('MyDashboard.tsx has no zinc-* color classes left', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../../components/home/MyDashboard.tsx'), 'utf8');
    // Strip comments so a doc-comment mentioning the antipattern can't trip it.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/zinc-/);
  });
});
