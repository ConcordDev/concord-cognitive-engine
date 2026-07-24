// DET-C batch 8 — qualia:policy (server/existential/engine.js fires this
// when an entity's existential-OS channel crosses an authored policy
// threshold) had zero frontend consumers. Wired into EmergentEventFeed's
// existing generic TRACKED_EVENTS array, matching the mechanism used for
// ~80 sibling emergent-simulation events (see the sibling pinning tests
// tests/emergent-event-feed-dead-events.test.tsx and
// tests/emergent-event-feed-det-c-batch3.test.tsx for prior batches).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'EmergentEventFeed.tsx');

describe('EmergentEventFeed — DET-C batch 8: qualia:policy now tracked', () => {
  const source = readFileSync(FILE, 'utf8');
  const trackedBlockStart = source.indexOf('const TRACKED_EVENTS');
  const trackedBlockEnd = source.indexOf('\n];', trackedBlockStart);
  const trackedBlock = source.slice(trackedBlockStart, trackedBlockEnd);

  it("tracks 'qualia:policy'", () => {
    expect(trackedBlock).toMatch(/name:\s*'qualia:policy'/);
  });

  it("'qualia:policy' is on the default-visible 'agent' channel (matches its sibling qualia/pain/agent events)", () => {
    const match = trackedBlock.match(/\{\s*name:\s*'qualia:policy'[^,]*,\s*channel:\s*'([^']+)'/);
    expect(match?.[1]).toBe('agent');
  });
});
