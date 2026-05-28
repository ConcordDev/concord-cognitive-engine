// Phase DA4 — Game modes hotbar tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HB = path.resolve(__dirname, '..', 'components', 'world', 'GameModesHotbarGroup.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DA4 — Game modes hotbar', () => {
  const src = readFileSync(HB, 'utf8');

  it('declares 6 modes', () => {
    for (const id of ['roguelite', 'horde', 'extraction', 'horror-ghost', 'time-loop', 'brawl']) {
      expect(src).toMatch(new RegExp(`id:\\s*['"]${id}['"]`));
    }
  });

  it('each mode has a start endpoint matching its substrate', () => {
    expect(src).toMatch(/\/api\/roguelite\/run\/start/);
    expect(src).toMatch(/\/api\/horde\/start/);
    expect(src).toMatch(/\/api\/extraction\/start/);
    expect(src).toMatch(/\/api\/horror\/session\/start/);
    expect(src).toMatch(/\/api\/time-loop\/start/);
  });

  it('responds to concordia:start-mode events from the command palette', () => {
    expect(src).toMatch(/concordia:start-mode/);
  });

  it('mounted in the world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/GameModesHotbarGroup/);
    expect(w).toMatch(/<GameModesHotbarGroup/);
  });
});
