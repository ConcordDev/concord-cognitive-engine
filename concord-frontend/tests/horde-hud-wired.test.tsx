// Phase DB4 — Horde wave HUD wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUD = path.resolve(__dirname, '..', 'components', 'world', 'HordeWaveHUD.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB4 — Horde wave HUD', () => {
  const src = readFileSync(HUD, 'utf8');

  it('polls /api/horde/active', () => {
    expect(src).toMatch(/\/api\/horde\/active/);
  });

  it('next wave call posts to /api/horde/:id/wave', () => {
    expect(src).toMatch(/\/api\/horde\/\$\{[^}]+\}\/wave/);
  });

  it('upgrade pick posts to /api/horde/:id/upgrade', () => {
    expect(src).toMatch(/\/api\/horde\/\$\{[^}]+\}\/upgrade/);
  });

  it('end run posts to /api/horde/:id/end', () => {
    expect(src).toMatch(/\/api\/horde\/\$\{[^}]+\}\/end/);
  });

  it('surfaces wave / kills / score', () => {
    expect(src).toMatch(/wave/);
    expect(src).toMatch(/kills/);
    expect(src).toMatch(/score/);
  });

  it('upgrade picker reads upgradeChoices', () => {
    expect(src).toMatch(/upgradeChoices/);
  });

  it('mounted in world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/HordeWaveHUD/);
    expect(w).toMatch(/<HordeWaveHUD/);
  });
});
