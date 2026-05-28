// Phase DB1 — Climbing tracker wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CT = path.resolve(__dirname, '..', 'components', 'world', 'ClimbingTracker.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB1 — Climbing tracker', () => {
  const src = readFileSync(CT, 'utf8');

  it('polls /api/players/me/stamina to detect state transitions', () => {
    expect(src).toMatch(/\/api\/players\/me\/stamina/);
  });

  it('records the route via /api/climbing/route on leave', () => {
    expect(src).toMatch(/\/api\/climbing\/route/);
    expect(src).toMatch(/peakAltitude/);
    expect(src).toMatch(/heightClimbed|height_climbed|peakY/);
  });

  it('shows top-route from /api/climbing/world/:worldId/top', () => {
    expect(src).toMatch(/\/api\/climbing\/world\//);
  });

  it('tracks peak altitude during climb', () => {
    expect(src).toMatch(/peakY/);
  });

  it('mounted in world lens (top-left widget cluster)', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/ClimbingTracker/);
    expect(w).toMatch(/<ClimbingTracker/);
  });
});
