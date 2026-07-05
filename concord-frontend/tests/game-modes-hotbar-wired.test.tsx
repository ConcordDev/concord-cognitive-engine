// Phase DA4 — Game modes hotbar tests.
//
// "responds to concordia:start-mode events from the command palette" used to
// only regex-check that the source mentions the event name — it would have
// passed even if the palette never dispatched the event (the real bug the
// verification audit found, fixed alongside this test in Fix 7). It's now a
// real render + dispatch + assert test against the actual DOM.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GameModesHotbarGroup } from '@/components/world/GameModesHotbarGroup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HB = path.resolve(__dirname, '..', 'components', 'world', 'GameModesHotbarGroup.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DA4 — Game modes hotbar', () => {
  const src = readFileSync(HB, 'utf8');

  afterEach(() => {
    cleanup();
  });

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

  it('opens the confirm modal for the mode named in a dispatched concordia:start-mode event', () => {
    render(<GameModesHotbarGroup worldId="test-world" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'extraction' } }));
    });
    // Real behavioral assertion: the component actually reacted to the
    // dispatched DOM event and opened its confirm modal for the right mode —
    // not just "the string concordia:start-mode appears somewhere".
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Start Extraction?')).toBeInTheDocument();
  });

  it('ignores a concordia:start-mode event naming an unrecognized mode id', () => {
    render(<GameModesHotbarGroup worldId="test-world" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'not-a-real-mode' } }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mounted in the world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/GameModesHotbarGroup/);
    expect(w).toMatch(/<GameModesHotbarGroup/);
  });
});
