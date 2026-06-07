// POLISH_AUDIT T2.7 (completion) — knockback + hit-reaction dedup authorities.
// Mirrors hit-pause.test.ts: one strike = one knockback and one wince per entity
// (the second, from the other combat event for the same strike, is suppressed),
// distinct entities are independent, and after the window a fresh strike fires.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  requestKnockback,
  requestHitReaction,
  _resetStrikeFx,
  STRIKE_FX_DEDUP_WINDOW_MS,
} from '@/lib/concordia/strike-fx-dedup';

const kb = (entityId: string, magnitude = 100, now?: number) =>
  requestKnockback({ entityId, direction: { x: 1, z: 0 }, magnitude }, now != null ? { now } : {});

describe('T2.7 — requestKnockback dedup (no double shove)', () => {
  beforeEach(() => _resetStrikeFx());

  it('first knockback for an entity fires', () => {
    expect(kb('p1', 100, 1000)).toBe(true);
  });

  it('a second knockback within the window is suppressed (one strike, one shove)', () => {
    expect(kb('p1', 100, 1000)).toBe(true);   // combat:impact (feel) path
    expect(kb('p1', 90, 1010)).toBe(false);   // combat:hit (momentum) path, same strike
  });

  it('distinct entities are independent', () => {
    expect(kb('p1', 100, 1000)).toBe(true);
    expect(kb('p2', 100, 1000)).toBe(true);
  });

  it('after the window elapses a fresh strike fires again', () => {
    expect(kb('p1', 100, 1000)).toBe(true);
    expect(kb('p1', 100, 1000 + STRIKE_FX_DEDUP_WINDOW_MS)).toBe(true);
  });

  it('ignores empty entity or non-positive magnitude', () => {
    expect(kb('', 100, 1000)).toBe(false);
    expect(kb('p1', 0, 1000)).toBe(false);
  });
});

describe('T2.7 — requestHitReaction dedup (no double wince)', () => {
  beforeEach(() => _resetStrikeFx());

  it('first wince for a target fires; a second within the window is suppressed', () => {
    expect(requestHitReaction({ targetId: 't1', severity: 'heavy' }, { now: 1000 })).toBe(true);
    expect(requestHitReaction({ targetId: 't1', severity: 'crit' }, { now: 1010 })).toBe(false);
  });

  it('distinct targets independent; fresh strike after the window fires', () => {
    expect(requestHitReaction({ targetId: 't1', severity: 'light' }, { now: 1000 })).toBe(true);
    expect(requestHitReaction({ targetId: 't2', severity: 'light' }, { now: 1000 })).toBe(true);
    expect(requestHitReaction({ targetId: 't1', severity: 'light' }, { now: 1000 + STRIKE_FX_DEDUP_WINDOW_MS })).toBe(true);
  });

  it('ignores empty target', () => {
    expect(requestHitReaction({ targetId: '', severity: 'light' }, { now: 1000 })).toBe(false);
  });
});
