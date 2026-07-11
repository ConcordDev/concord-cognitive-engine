// NPCSchemeOverhearTip's 30m earshot gate. Before Wave 4 finding #8's fix,
// window.__concordiaPlayerPos was permanently null (nothing ever wrote it),
// so the gate's `if (playerPos && npcPos)` block never ran and every
// scheme-resolution toast fired regardless of distance — the OPPOSITE of
// a fail-closed proximity check. Now that AvatarSystem3D actually
// publishes both window.__concordiaPlayerPos and __concordiaNpcPositions,
// this pins that the gate (a) engages once a player position exists, and
// (b) fails CLOSED (suppresses the toast) when the NPC's position can't be
// verified, rather than silently skipping the whole gate.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NPCSchemeOverhearTip } from '@/components/world/NPCSchemeOverhearTip';

interface SchemeEvent {
  schemeId: string;
  plotterKind: 'npc' | 'player';
  plotterId: string;
  targetKind: string;
  targetId: string;
  kind: string;
  outcome: 'complete' | 'exposed' | 'abandoned';
}

function resolveScheme(detail: SchemeEvent) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:npc-scheme-resolved', { detail }));
  });
}

function baseScheme(overrides: Partial<SchemeEvent> = {}): SchemeEvent {
  return {
    schemeId: 'scheme-1',
    plotterKind: 'npc',
    plotterId: 'npc-1',
    targetKind: 'player',
    targetId: 'player-1',
    kind: 'rumour',
    outcome: 'complete',
    ...overrides,
  };
}

afterEach(() => {
  delete (window as { __concordiaPlayerPos?: unknown }).__concordiaPlayerPos;
  delete (window as { __concordiaNpcPositions?: unknown }).__concordiaNpcPositions;
});

describe('NPCSchemeOverhearTip earshot gate', () => {
  it('shows the toast when no player position is known at all (non-world surface)', () => {
    render(<NPCSchemeOverhearTip />);
    resolveScheme(baseScheme({ schemeId: 'no-pos' }));
    expect(screen.getByText(/You overhear murmuring/)).toBeTruthy();
  });

  it('shows the toast when player and plotting NPC are within 30m', () => {
    (window as { __concordiaPlayerPos?: { x: number; y: number; z: number } }).__concordiaPlayerPos = { x: 0, y: 0, z: 0 };
    (window as { __concordiaNpcPositions?: Record<string, { x: number; y: number; z: number }> }).__concordiaNpcPositions = {
      'npc-1': { x: 10, y: 0, z: 0 },
    };
    render(<NPCSchemeOverhearTip />);
    resolveScheme(baseScheme({ schemeId: 'in-range' }));
    expect(screen.getByText(/You overhear murmuring/)).toBeTruthy();
  });

  it('suppresses the toast when player and plotting NPC are more than 30m apart', () => {
    (window as { __concordiaPlayerPos?: { x: number; y: number; z: number } }).__concordiaPlayerPos = { x: 0, y: 0, z: 0 };
    (window as { __concordiaNpcPositions?: Record<string, { x: number; y: number; z: number }> }).__concordiaNpcPositions = {
      'npc-1': { x: 500, y: 0, z: 0 },
    };
    render(<NPCSchemeOverhearTip />);
    resolveScheme(baseScheme({ schemeId: 'out-of-range' }));
    expect(screen.queryByText(/You overhear murmuring/)).toBeNull();
  });

  it('fails CLOSED (suppresses) when player position is known but the plotting NPC position cannot be verified', () => {
    // This is the regression pin: pre-fix, `if (playerPos && npcPos)` meant
    // a missing npcPos skipped the whole gate and showed the toast anyway.
    (window as { __concordiaPlayerPos?: { x: number; y: number; z: number } }).__concordiaPlayerPos = { x: 0, y: 0, z: 0 };
    (window as { __concordiaNpcPositions?: Record<string, { x: number; y: number; z: number }> }).__concordiaNpcPositions = {};
    render(<NPCSchemeOverhearTip />);
    resolveScheme(baseScheme({ schemeId: 'unknown-npc-pos', plotterId: 'npc-not-tracked' }));
    expect(screen.queryByText(/You overhear murmuring/)).toBeNull();
  });
});
