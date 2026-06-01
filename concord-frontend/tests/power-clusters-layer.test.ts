// PowerClusterLayer — the SR4/Crackdown pickup loop rendered in 3D. Pins the
// WIRING (the orb render itself needs a real-GPU check).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('power-cluster 3D pickup layer', () => {
  const src = read('components/world/PowerClusterLayer.tsx');
  it('polls unclaimed clusters for the world via the macro', () => {
    expect(src).toMatch(/domain: 'power-clusters', name: 'list'/);
    expect(src).toMatch(/unclaimedOnly: true/);
    expect(src).toMatch(/__concordiaScene/);
  });
  it('claims on walk-into proximity using the player position', () => {
    expect(src).toMatch(/__concordiaPlayerPos/);
    expect(src).toMatch(/name: 'claim'/);
    expect(src).toMatch(/CLAIM_R/);
  });
  it('pops the orb + plays discovery juice on a successful claim', () => {
    expect(src).toMatch(/discoveryJuice\(\)/);
    expect(src).toMatch(/disposeGroup/);
  });
  it('is mounted in the world lens 3D view', () => {
    const page = read('app/lenses/world/page.tsx');
    expect(page).toMatch(/import\('@\/components\/world\/PowerClusterLayer'\)/);
    expect(page).toMatch(/<PowerClusterLayer worldId=/);
  });
});
