// Verification-audit fix — pinning tests for 2 real name-mismatch
// dead-listener findings: the frontend subscribed to an event name the
// server never emits (a differently-spelled real event exists instead).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('AdaptiveMusicBridge — npc:scheme-resolved (was npc:scheme_revealed, never emitted)', () => {
  const src = readFileSync(path.resolve(__dirname, '..', 'components', 'world', 'AdaptiveMusicBridge.tsx'), 'utf8');

  it('subscribes to the real hyphenated event name', () => {
    expect(src).toMatch(/subscribe\('npc:scheme-resolved'/);
  });

  it('no longer subscribes to the never-emitted underscored name', () => {
    expect(src).not.toMatch(/subscribe\('npc:scheme_revealed'/);
  });
});

describe('world lens — concordia:terrain-deformed (was world:deformation, never emitted)', () => {
  const src = readFileSync(path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx'), 'utf8');

  it('subscribes to and unsubscribes from the real event name', () => {
    expect(src).toMatch(/worldSocket\.on\('concordia:terrain-deformed'/);
    expect(src).toMatch(/worldSocket\.off\('concordia:terrain-deformed'/);
  });

  it('no longer references the never-emitted name', () => {
    expect(src).not.toMatch(/worldSocket\.(on|off)\('world:deformation'/);
  });
});

describe('server/domains/terrain.js — dig emits a real DeformationRecord-shaped payload', () => {
  const src = readFileSync(path.resolve(__dirname, '..', '..', 'server', 'domains', 'terrain.js'), 'utf8');

  it('emits under the name the frontend actually listens for', () => {
    expect(src).toMatch(/emit\?\.\("concordia:terrain-deformed"/);
  });

  it('payload includes the fields DeformationRecord requires', () => {
    const emitStart = src.indexOf('"concordia:terrain-deformed"');
    const block = src.slice(emitStart, emitStart + 400);
    expect(block).toMatch(/id:\s*crypto\.randomUUID\(\)/);
    expect(block).toMatch(/type:\s*"terrain_excavated"/);
    expect(block).toMatch(/entityId:/);
    expect(block).toMatch(/x:\s*wx/);
    expect(block).toMatch(/z:\s*wz/);
    expect(block).toMatch(/timestamp:\s*Date\.now\(\)/);
  });
});
