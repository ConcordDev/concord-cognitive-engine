// Wave 4 finding #8 — window.__concordiaPlayerPos / __concordiaNpcPositions
// were read by 9+ world-lens components but written by nothing (a
// permanently dead global). AvatarSystem3D is a heavy imperative Three.js
// component with no existing test harness (no canvas/WebGL mocking in this
// project's vitest setup), so the actual per-frame publish logic is
// extracted into lib/world-lens/player-position-broadcast.ts and unit
// tested directly here — this proves the real runtime behavior of the
// publish/clear calls AvatarSystem3D wires into its frame loop.

import { describe, it, expect, afterEach } from 'vitest';
import {
  publishPlayerPosition,
  publishNpcPositions,
  clearPlayerPositionBroadcast,
} from '@/lib/world-lens/player-position-broadcast';

afterEach(() => {
  clearPlayerPositionBroadcast();
});

describe('publishPlayerPosition', () => {
  it('writes window.__concordiaPlayerPos with the given coordinates', () => {
    expect(window.__concordiaPlayerPos).toBeUndefined();
    publishPlayerPosition({ x: 12, y: 3, z: -7 });
    expect(window.__concordiaPlayerPos).toEqual({ x: 12, y: 3, z: -7 });
  });

  it('publishes the SAME object reference (no per-call allocation/copy)', () => {
    const pos = { x: 1, y: 2, z: 3 };
    publishPlayerPosition(pos);
    expect(window.__concordiaPlayerPos).toBe(pos);
    // Mutating the source object in place (as AvatarSystem3D's physics
    // loop does every frame) is reflected immediately with no republish.
    pos.x = 99;
    expect(window.__concordiaPlayerPos!.x).toBe(99);
  });

  it('overwrites a stale value on each call', () => {
    publishPlayerPosition({ x: 1, y: 1, z: 1 });
    publishPlayerPosition({ x: 5, y: 5, z: 5 });
    expect(window.__concordiaPlayerPos).toEqual({ x: 5, y: 5, z: 5 });
  });
});

describe('publishNpcPositions', () => {
  it('writes window.__concordiaNpcPositions keyed by npc id', () => {
    publishNpcPositions({
      'npc-1': { x: 10, y: 0, z: 10 },
      'npc-2': { x: -4, y: 0, z: 2 },
    });
    expect(window.__concordiaNpcPositions).toEqual({
      'npc-1': { x: 10, y: 0, z: 10 },
      'npc-2': { x: -4, y: 0, z: 2 },
    });
  });

  it('drops npcs that are no longer present on the next publish (fresh object per frame)', () => {
    publishNpcPositions({ 'npc-1': { x: 0, y: 0, z: 0 } });
    expect(window.__concordiaNpcPositions).toHaveProperty('npc-1');
    publishNpcPositions({ 'npc-2': { x: 0, y: 0, z: 0 } });
    expect(window.__concordiaNpcPositions).not.toHaveProperty('npc-1');
    expect(window.__concordiaNpcPositions).toHaveProperty('npc-2');
  });
});

describe('clearPlayerPositionBroadcast', () => {
  it('deletes both globals so a stale pointer does not leak across lenses', () => {
    publishPlayerPosition({ x: 1, y: 1, z: 1 });
    publishNpcPositions({ 'npc-1': { x: 1, y: 1, z: 1 } });
    expect(window.__concordiaPlayerPos).toBeDefined();
    expect(window.__concordiaNpcPositions).toBeDefined();

    clearPlayerPositionBroadcast();

    expect(window.__concordiaPlayerPos).toBeUndefined();
    expect(window.__concordiaNpcPositions).toBeUndefined();
  });
});
