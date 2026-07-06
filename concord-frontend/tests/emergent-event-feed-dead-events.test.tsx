// Verification-audit fix — pinning test for 11 real dead-event-listener
// findings: real server broadcasts (world:boss-spawn, scheme:player_
// assassinated, plague:resolved, faction:collapse-cascade, scheme:cross_
// world, creature:predation, career:shift, world:npc-event, secret:
// weaponised, combat:npc-combo-evolved, spouse:reaction) with zero
// frontend consumer anywhere. Wired into EmergentEventFeed's existing
// generic TRACKED_EVENTS array — the same mechanism that already surfaces
// ~60 sibling emergent-simulation events.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'EmergentEventFeed.tsx');

describe('EmergentEventFeed — 11 previously-dead events now tracked', () => {
  const source = readFileSync(FILE, 'utf8');
  const trackedBlockStart = source.indexOf('const TRACKED_EVENTS');
  const trackedBlockEnd = source.indexOf('\n];', trackedBlockStart);
  const trackedBlock = source.slice(trackedBlockStart, trackedBlockEnd);

  const expectedEvents = [
    'world:boss-spawn',
    'scheme:player_assassinated',
    'plague:resolved',
    'faction:collapse-cascade',
    'scheme:cross_world',
    'creature:predation',
    'career:shift',
    'world:npc-event',
    'secret:weaponised',
    'combat:npc-combo-evolved',
    'spouse:reaction',
  ];

  for (const evt of expectedEvents) {
    it(`tracks '${evt}'`, () => {
      expect(trackedBlock).toMatch(new RegExp(`name:\\s*'${evt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    });
  }

  it('every tracked event still has a valid channel + label (no malformed entries introduced)', () => {
    const entryRe = /\{\s*name:\s*'([^']+)'[^,]*,\s*channel:\s*'([^']+)',\s*label:\s*'([^']+)'/g;
    let match;
    let count = 0;
    while ((match = entryRe.exec(trackedBlock))) {
      count++;
      expect(match[2].length).toBeGreaterThan(0);
      expect(match[3].length).toBeGreaterThan(0);
    }
    expect(count).toBeGreaterThanOrEqual(expectedEvents.length);
  });
});
