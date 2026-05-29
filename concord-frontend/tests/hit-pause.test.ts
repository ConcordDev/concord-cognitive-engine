// POLISH_AUDIT T2.7 — hit-pause dedup authority.
// Pins: one strike = one freeze (a second hit-pause for the same entity within
// the window is suppressed), distinct entities are independent, and after the
// window a fresh strike fires again. Pure logic (window dispatch is guarded).

import { describe, it, expect, beforeEach } from 'vitest';
import { requestHitPause, _resetHitPause, HIT_PAUSE_DEDUP_WINDOW_MS } from '@/lib/concordia/hit-pause';

describe('T2.7 — requestHitPause dedup', () => {
  beforeEach(() => _resetHitPause());

  it('first request for an entity fires', () => {
    expect(requestHitPause('npc1', 80, { now: 1000 })).toBe(true);
  });

  it('a second request within the window is suppressed (one strike, one freeze)', () => {
    expect(requestHitPause('npc1', 80, { now: 1000 })).toBe(true);   // impact path
    expect(requestHitPause('npc1', 35, { now: 1010 })).toBe(false);  // legacy path, same strike
  });

  it('distinct entities are independent', () => {
    expect(requestHitPause('npc1', 80, { now: 1000 })).toBe(true);
    expect(requestHitPause('npc2', 80, { now: 1000 })).toBe(true);
  });

  it('after the window elapses a fresh strike fires again', () => {
    expect(requestHitPause('npc1', 80, { now: 1000 })).toBe(true);
    expect(requestHitPause('npc1', 80, { now: 1000 + HIT_PAUSE_DEDUP_WINDOW_MS })).toBe(true);
  });

  it('ignores empty entity or non-positive duration', () => {
    expect(requestHitPause(undefined, 80, { now: 1000 })).toBe(false);
    expect(requestHitPause('npc1', 0, { now: 1000 })).toBe(false);
  });
});
