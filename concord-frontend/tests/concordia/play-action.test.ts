import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playAction, playActionAtPlayer } from '@/lib/concordia/play-action';

// WS1.5 — the dispatch every station/labor verb now calls. Pin that it emits a
// concordia:action-anim with a resolved descriptor, and that playActionAtPlayer
// anchors the VFX at the live player position when one is known.

describe('WS1.5 — playAction dispatch', () => {
  let events: CustomEvent[];
  const listener = (e: Event) => events.push(e as CustomEvent);

  beforeEach(() => {
    events = [];
    window.addEventListener('concordia:action-anim', listener);
  });
  afterEach(() => {
    window.removeEventListener('concordia:action-anim', listener);
    delete (window as { __concordiaPlayerPos?: unknown }).__concordiaPlayerPos;
    vi.restoreAllMocks();
  });

  it('playAction emits an action-anim event carrying verb + resolved descriptor', () => {
    const d = playAction('forge');
    expect(d).toBeTruthy();
    expect(d.archetype).toBeTruthy();
    expect(events.length).toBe(1);
    expect(events[0].detail.verb).toBe('forge');
    expect(events[0].detail.descriptor.archetype).toBe(d.archetype);
  });

  it('an unknown verb still dispatches (category fallback, never silent)', () => {
    const d = playAction('zorp-the-thing');
    expect(d).toBeTruthy();
    expect(events.length).toBe(1);
  });

  it('playActionAtPlayer anchors pos at window.__concordiaPlayerPos when set', () => {
    (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos = { x: 12, z: -7 };
    playActionAtPlayer('plant');
    expect(events[0].detail.pos).toEqual({ x: 12, y: 1, z: -7 });
  });

  it('playActionAtPlayer omits pos gracefully when player pos unknown', () => {
    playActionAtPlayer('harvest');
    expect(events[0].detail.pos).toBeUndefined();
  });
});
