// DET-C batch 3 — 10 more real dead-event-listener findings (backend
// broadcasts verified global-scope via the dead-event-listener detector's
// own methodology, not a grep guess): agent:value-drift, world:viability,
// realm:governance-adjusted, lattice:claim-verified, pain:avoidance_created,
// royalty:cross-world, npc:prop-interaction, app:created,
// forge:template:created, forge:template:generated, forge:template:published.
// Wired into EmergentEventFeed's existing generic TRACKED_EVENTS array — the
// same mechanism used for ~70 sibling emergent-simulation events (see the
// sibling pinning test tests/emergent-event-feed-dead-events.test.tsx for
// the prior batch).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'EmergentEventFeed.tsx');

describe('EmergentEventFeed — DET-C batch 3: 10 more previously-dead events now tracked', () => {
  const source = readFileSync(FILE, 'utf8');
  const trackedBlockStart = source.indexOf('const TRACKED_EVENTS');
  const trackedBlockEnd = source.indexOf('\n];', trackedBlockStart);
  const trackedBlock = source.slice(trackedBlockStart, trackedBlockEnd);

  const expectedEvents = [
    'agent:value-drift',
    'world:viability',
    'realm:governance-adjusted',
    'lattice:claim-verified',
    'pain:avoidance_created',
    'royalty:cross-world',
    'npc:prop-interaction',
    'app:created',
    'forge:template:created',
    'forge:template:generated',
    'forge:template:published',
  ];

  for (const evt of expectedEvents) {
    it(`tracks '${evt}'`, () => {
      expect(trackedBlock).toMatch(new RegExp(`name:\\s*'${evt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    });
  }

  it('every newly-tracked event still has a valid channel + label (no malformed entries introduced)', () => {
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
