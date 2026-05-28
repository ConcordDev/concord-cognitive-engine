// Phase CA6 — confirm CorpseMarker polls player corpses.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'CorpseMarker.tsx');

describe('Phase CA6 — Soulslike corpse marker', () => {
  const source = readFileSync(FILE, 'utf8');

  it('polls /api/players/me/corpses', () => {
    expect(source).toMatch(/\/api\/players\/me\/corpses/);
  });

  it('filters corpses to the current world', () => {
    expect(source).toMatch(/c\.world_id\s*===\s*worldId/);
  });

  it('sorts by distance + surfaces the closest', () => {
    expect(source).toMatch(/distance/);
    expect(source).toMatch(/sort/);
  });

  it('renders lost coin count', () => {
    expect(source).toMatch(/coins_lost/);
  });
});
