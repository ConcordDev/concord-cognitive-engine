// Phase DA2 — StationInteractionRouter frontend wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTER = path.resolve(__dirname, '..', 'components', 'world', 'StationInteractionRouter.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DA2 — Station interaction router', () => {
  it('listens for concordia:building-interact', () => {
    const src = readFileSync(ROUTER, 'utf8');
    expect(src).toMatch(/addEventListener\(\s*['"]concordia:building-interact['"]/);
  });

  it('maps 11 building_type keys to overlay components', () => {
    const src = readFileSync(ROUTER, 'utf8');
    const keys = [
      'farm_plot', 'restaurant', 'trivia_kiosk', 'karaoke_booth',
      'mahjong_table', 'hacking_terminal', 'programming_console',
      'factory_workbench', 'attraction_booth', 'creature_pen', 'glyph_altar',
    ];
    for (const k of keys) {
      expect(src).toMatch(new RegExp(k));
    }
  });

  it('proximity-gates at 4m', () => {
    const src = readFileSync(ROUTER, 'utf8');
    expect(src).toMatch(/PROXIMITY_GATE_M\s*=\s*4/);
    expect(src).toMatch(/Math\.hypot/);
  });

  it('lazy-loads overlays (Suspense + lazy)', () => {
    const src = readFileSync(ROUTER, 'utf8');
    expect(src).toMatch(/lazy\(/);
    expect(src).toMatch(/Suspense/);
  });

  it('world lens dispatches concordia:building-interact on raycaster hit', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/concordia:building-interact/);
    expect(src).toMatch(/playerX/);
    expect(src).toMatch(/playerZ/);
  });

  it('StationInteractionRouter mounted in world lens', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/import\('@\/components\/world\/StationInteractionRouter'\)/);
    expect(src).toMatch(/<StationInteractionRouter \/>/);
  });
});
