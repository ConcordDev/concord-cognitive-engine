// Chunk 3 — Link-scan: on-demand contextual scanner over the Layer-7 signal
// substrate. Backend already wired (embodied.signals_for_player); this pins the
// overlay's discipline (on-demand, contextual, edge-docked).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('link-scan contextual overlay', () => {
  const src = read('components/world/LinkScanOverlay.tsx');
  it('reads the player local signals via the already-wired macro (no new backend)', () => {
    expect(src).toMatch(/domain: 'embodied', name: 'signals_for_player'/);
  });
  it('is on-demand (toggle V), not always-on (the anti-Starfield discipline)', () => {
    expect(src).toMatch(/'v'|'V'/);
    expect(src).toMatch(/if \(!enabled \|\| !ENV_ON \|\| !open\) return null/);
  });
  it('only polls while open (no wasted network when closed)', () => {
    expect(src).toMatch(/if \(!open\)/);
  });
  it('has a kill-switch + surfaces the signal channels', () => {
    expect(src).toMatch(/NEXT_PUBLIC_CONCORD_LINK_SCAN/);
    expect(src).toMatch(/Temp/);
    expect(src).toMatch(/Air/);
    expect(src).toMatch(/Noise/);
  });
  it('is mounted in the world lens', () => {
    const page = read('app/lenses/world/page.tsx');
    expect(page).toMatch(/import\('@\/components\/world\/LinkScanOverlay'\)/);
    expect(page).toMatch(/<LinkScanOverlay worldId=/);
  });
});
