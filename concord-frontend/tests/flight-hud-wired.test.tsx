// Phase CA1 — confirm FlightHUD listens for concordia:flight-state.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'FlightHUD.tsx');

describe('Phase CA1 — Flight HUD wired to flight-physics event', () => {
  const source = readFileSync(FILE, 'utf8');

  it('subscribes to concordia:flight-state', () => {
    expect(source).toMatch(/addEventListener\(\s*['"]concordia:flight-state['"]/);
  });

  it('reads airspeed + heading + vy + roll + pitch + stall from event detail', () => {
    expect(source).toMatch(/airspeed/);
    expect(source).toMatch(/heading/);
    expect(source).toMatch(/vy/);
    expect(source).toMatch(/rollRad/);
    expect(source).toMatch(/pitchRad/);
    expect(source).toMatch(/stalled/);
  });

  it('auto-hides on silence (no event for SILENCE_MS)', () => {
    expect(source).toMatch(/SILENCE_MS/);
    expect(source).toMatch(/setState\(null\)/);
  });

  it('shows stall warning when stalled', () => {
    expect(source).toMatch(/STALL/);
    expect(source).toMatch(/pitch down to recover/);
  });
});
