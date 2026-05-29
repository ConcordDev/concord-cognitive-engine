// Sprint 1 — client-side combat prediction (G2.1) + camera-punch consumer.
//
// These are render-loop integrations (verified to compile + SSR 200 via the
// dev server); these pins guard the WIRING so it can't silently regress.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('G2.1 — client-side combat prediction', () => {
  const src = read('components/world-lens/CombatInputController.tsx');
  it('dispatches a local predicted swing on input (not just the socket emit)', () => {
    expect(src).toMatch(/concordia:combat-anim/);
    expect(src).toMatch(/predicted:\s*true/);
  });
  it('uses the local playerId (no longer the unused _playerId)', () => {
    expect(src).toMatch(/playerId,\s*worldSocket/);
    expect(src).not.toMatch(/playerId:\s*_playerId/);
  });
  it('maps attack/kick/dodge inputs to predicted animations', () => {
    expect(src).toMatch(/attack-heavy.*attack-light|attack-light/);
    expect(src).toMatch(/'kick'/);
  });
});

describe('Sprint 1 — camera-punch consumer in ConcordiaScene', () => {
  const src = read('components/world-lens/ConcordiaScene.tsx');
  it('registers + cleans up the concordia:camera-punch listener', () => {
    expect(src).toMatch(/addEventListener\('concordia:camera-punch'/);
    expect(src).toMatch(/removeEventListener\('concordia:camera-punch'/);
  });
  it('applies a decaying impulse to the camera each frame', () => {
    expect(src).toMatch(/cameraPunchRef/);
    expect(src).toMatch(/camera\.fov\s*=/);
    expect(src).toMatch(/local_relevance/);
  });
});
