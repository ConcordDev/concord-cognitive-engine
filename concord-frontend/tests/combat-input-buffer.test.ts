// A2 / F3.3 — input buffering + animation-cancel windows.
//
// Pins the pure model CombatInputController consumes:
//   - a press is held for the buffer window then expires
//   - latest-wins (a buffered heavy overrides a buffered light)
//   - take() consumes; peek() doesn't
//   - cancel opens at ≥ the recovery threshold

import { describe, it, expect } from 'vitest';
import {
  createInputBuffer, canCancel, cancelState, DEFAULT_BUFFER_MS, CANCEL_THRESHOLD,
} from '@/lib/concordia/combat-input-buffer';

describe('A2 — input buffer', () => {
  it('holds a press for the window then expires', () => {
    const b = createInputBuffer(110);
    b.push('e', 1000, 'tap');
    expect(b.peek(1050)?.action).toBe('e');     // within window
    expect(b.peek(1200)).toBeNull();            // expired (200ms > 110ms)
  });

  it('latest press wins (buffered heavy overrides buffered light)', () => {
    const b = createInputBuffer(110);
    b.push('e', 1000, 'tap');
    b.push('r', 1010, 'hold');
    const v = b.peek(1020);
    expect(v?.action).toBe('r');
    expect(v?.variant).toBe('hold');
  });

  it('take() consumes; a second take is null', () => {
    const b = createInputBuffer(110);
    b.push('q', 1000);
    expect(b.take(1010)?.action).toBe('q');
    expect(b.take(1020)).toBeNull();
  });

  it('clear empties the buffer', () => {
    const b = createInputBuffer();
    b.push('e', 1000);
    b.clear();
    expect(b.peek(1000)).toBeNull();
    expect(DEFAULT_BUFFER_MS).toBeGreaterThan(0);
  });
});

describe('A2 — cancel windows', () => {
  it('cancel opens at/after the threshold', () => {
    expect(canCancel(0.3)).toBe(false);
    expect(canCancel(0.5)).toBe(true);
    expect(canCancel(0.9)).toBe(true);
    expect(CANCEL_THRESHOLD).toBe(0.5);
  });
  it('cancelState reports recovery fraction + cancellable', () => {
    const early = cancelState(20, 100);
    expect(early.recoveryFraction).toBe(0.2);
    expect(early.cancellable).toBe(false);
    const late = cancelState(70, 100);
    expect(late.recoveryFraction).toBe(0.7);
    expect(late.cancellable).toBe(true);
  });
});
