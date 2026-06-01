// Chunk 2 — radial quick-wheel wired to the player's REAL skills (anti-Starfield:
// surface what's actually possible), each spoke firing the canonical cast.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('skill radial wheel wiring', () => {
  const src = read('components/world/concordia-hud/SkillWheelMount.tsx');
  it('fetches the player real skills (not hardcoded)', () => {
    expect(src).toMatch(/\/api\/worlds\/skills\/mine/);
  });
  it('each spoke fires the canonical concordia:spell-cast (same path as the hotbar)', () => {
    expect(src).toMatch(/concordia:spell-cast/);
    expect(src).toMatch(/spellId: skill\.id/);
  });
  it('falls back to ActionWheel defaults when the player has no skills', () => {
    expect(src).toMatch(/setSpokes\(undefined\)/);
    expect(src).toMatch(/variant="skill"/);
  });
  it('refreshes when a skill is learned/evolved', () => {
    expect(src).toMatch(/skill:evolved|concordia:skill-learned/);
  });
  it('replaces the hardcoded skill wheel in the world lens', () => {
    const page = read('app/lenses/world/page.tsx');
    expect(page).toMatch(/SkillWheelMount/);
    expect(page).toMatch(/<ConcordiaHUD\.SkillWheel \/>/);
    // the bare hardcoded skill wheel is gone
    expect(page).not.toMatch(/ActionWheel variant="skill"/);
  });
});
