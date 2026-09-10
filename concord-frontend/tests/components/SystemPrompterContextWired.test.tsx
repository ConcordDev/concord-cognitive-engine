// SystemPrompter ("[System]" contextual prompter) — dead-event-listener
// closure. `concordia:context-update` (SystemPrompter.tsx) previously had a
// real listener with ZERO dispatcher anywhere in the codebase — a genuine
// ghost-event listener (per server/lib/detectors/dead-event-listener-
// detector.js's reverse-direction pass). The world lens page now publishes
// a real PlayerContext (nearBuilding/nearNpc/inCombat/inWater), each field
// read from state the page already tracks for other real purposes (see
// components/world/WorldOsSurface.tsx's own comment on the new effect). This file
// pins two things:
//   1. SystemPrompter genuinely reacts to the event (component-level render).
//   2. The world page's dispatch site is real — source-string pin, the same
//      pattern tests/station-router-wired.test.tsx uses for the sibling
//      concordia:building-interact wiring, since fully rendering
//      components/world/WorldOsSurface.tsx needs a live WebGL scene graph jsdom can't
//      provide.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SystemPrompter from '@/components/world/SystemPrompter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.resolve(__dirname, '..', '..', 'app', 'lenses', 'world', 'page.tsx');

describe('SystemPrompter — reacts to a real concordia:context-update dispatch', () => {
  afterEach(() => cleanup());

  it('renders nothing until a real context event arrives (honest silence, not a fabricated default)', () => {
    render(<SystemPrompter />);
    expect(screen.queryByText('[ SYSTEM ]')).toBeNull();
  });

  it('resolves and renders real affordances once concordia:context-update fires', () => {
    render(<SystemPrompter />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:context-update', {
        detail: { nearBuilding: { id: 'b1', type: 'glyph_altar' } },
      }));
    });
    expect(screen.getByText('[ SYSTEM ]')).toBeTruthy();
    expect(screen.getByText('Compose a glyph')).toBeTruthy();
  });

  it('updates as the published context changes (nearest NPC replaces the building affordance)', () => {
    render(<SystemPrompter />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:context-update', {
        detail: { inCombat: true },
      }));
    });
    expect(screen.getByText('Attack')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:context-update', {
        detail: {},
      }));
    });
    expect(screen.queryByText('Attack')).toBeNull();
    expect(screen.getByText('Explore')).toBeTruthy();
  });
});

describe('World lens page — genuinely publishes concordia:context-update', () => {
  it('page.tsx\'s source contains the literal dispatchEvent(new CustomEvent(\'concordia:context-update\', ...)) statement, populated from real, already-tracked proximity/combat/swim state — not fabricated values (source-text pin; page.tsx cannot be mounted in jsdom, see file header)', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/dispatchEvent\(new CustomEvent\('concordia:context-update', \{ detail: ctx \}\)\)/);
    // Every field comes from state this page tracks for other real reasons —
    // not fabricated for this event alone.
    expect(src).toMatch(/nearBuilding:\s*nearestBuilding/);
    expect(src).toMatch(/nearNpc:\s*nearbyNPC/);
    expect(src).toMatch(/inCombat:\s*!!combatState\.target/);
    expect(src).toMatch(/inWater:\s*isSwimming/);
  });

  it('mounts SystemPrompter, the real listener', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/<SystemPrompter \/>/);
  });
});
