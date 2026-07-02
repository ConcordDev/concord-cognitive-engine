/**
 * conkayHudStore — the "honest by construction" HUD store. Every field is a pure
 * function of a real macro:* socket event; the scene's rings/holoshell/telemetry
 * read it. These tests pin the Phase-2 macro:stage contract: a stage is shown
 * ONLY while the backend reports a matching run in flight, and is cleared the
 * moment work starts or finishes — it can never linger as fake progress.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useConkayHudStore } from './conkayHudStore';

const store = () => useConkayHudStore.getState();

beforeEach(() => { store().reset(); });

describe('conkayHudStore macro:stage (honest sub-step)', () => {
  it('starts with no in-flight work and no stage', () => {
    expect(store().inFlight).toBe(0);
    expect(store().stage).toBeNull();
  });

  it('reflects a stage only while the matching run is in flight', () => {
    store().macroStarted({ runId: 'r1', domain: 'reason', action: 'verify' });
    expect(store().inFlight).toBe(1);
    expect(store().stage).toBeNull(); // a fresh run has no sub-step yet

    store().macroStage({ runId: 'r1', stage: 'judging' });
    expect(store().stage).toBe('judging');
  });

  it('IGNORES a stage for a run that is not in flight (no fake progress)', () => {
    // No started run → a stray stage must not paint a sub-step.
    store().macroStage({ runId: 'ghost', stage: 'judging' });
    expect(store().stage).toBeNull();

    // A stage for a DIFFERENT run than the one in flight is also ignored.
    store().macroStarted({ runId: 'r1', domain: 'reason', action: 'verify' });
    store().macroStage({ runId: 'other', stage: 'proving' });
    expect(store().stage).toBeNull();
  });

  it('clears the stage when the run completes (no lingering sub-step)', () => {
    store().macroStarted({ runId: 'r1', domain: 'reason', action: 'verify' });
    store().macroStage({ runId: 'r1', stage: 'judging' });
    expect(store().stage).toBe('judging');

    store().macroCompleted({ runId: 'r1', domain: 'reason', action: 'verify', ok: true, ms: 12 });
    expect(store().inFlight).toBe(0);
    expect(store().stage).toBeNull();
    // the real return facts are recorded as telemetry
    expect(store().last).toMatchObject({ domain: 'reason', action: 'verify', ok: true, ms: 12 });
  });

  it('keeps a stage while OTHER runs remain in flight', () => {
    store().macroStarted({ runId: 'r1' });
    store().macroStarted({ runId: 'r2' });
    store().macroStage({ runId: 'r2', stage: 'proving' });
    expect(store().stage).toBe('proving');
    // r1 finishes but r2 is still running → the stage stays.
    store().macroCompleted({ runId: 'r1', ok: true });
    expect(store().inFlight).toBe(1);
    expect(store().stage).toBe('proving');
  });

  it('reset clears stage and all in-flight state', () => {
    store().macroStarted({ runId: 'r1' });
    store().macroStage({ runId: 'r1', stage: 'judging' });
    store().reset();
    expect(store().inFlight).toBe(0);
    expect(store().stage).toBeNull();
    expect(store().telemetry).toEqual([]);
  });
});

describe('conkayHudStore lastVerify + runDtuRefs (Unit F2 — verify substrate)', () => {
  it('starts null/empty', () => {
    expect(store().lastVerify).toBeNull();
    expect(store().runDtuRefs).toEqual([]);
  });

  it('setLastVerify records the real reason.verify verdict', () => {
    store().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.87 });
    expect(store().lastVerify).toEqual({ verdict: 'grounded', mode: 'council', confidence: 0.87 });
  });

  it('setLastVerify accepts null (e.g. a fresh reset)', () => {
    store().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.87 });
    store().setLastVerify(null);
    expect(store().lastVerify).toBeNull();
  });

  it('setRunDtuRefs records the real dtuRefs shape (id/title/tier)', () => {
    const refs = [
      { id: 'dtu-1', title: 'Federation poll cadence', tier: 'regular' },
      { id: 'dtu-2', title: null, tier: 'mega' },
    ];
    store().setRunDtuRefs(refs);
    expect(store().runDtuRefs).toEqual(refs);
  });

  it('setRunDtuRefs defensively coerces a non-array to empty (never throws)', () => {
    // @ts-expect-error — deliberately calling with a malformed value to pin the guard
    store().setRunDtuRefs(null);
    expect(store().runDtuRefs).toEqual([]);
  });

  it('reset clears both lastVerify and runDtuRefs', () => {
    store().setLastVerify({ verdict: 'unsupported', mode: 'council', confidence: 0.4 });
    store().setRunDtuRefs([{ id: 'dtu-1', title: 'x', tier: 'regular' }]);
    store().reset();
    expect(store().lastVerify).toBeNull();
    expect(store().runDtuRefs).toEqual([]);
  });

  it('are ONLY settable via their documented actions — no other action mutates them', () => {
    // Pin the single-writer contract the same way the rest of this file does:
    // exercise every OTHER mutator and confirm lastVerify/runDtuRefs are untouched.
    store().setLastVerify({ verdict: 'grounded', mode: 'proof', confidence: 1 });
    store().setRunDtuRefs([{ id: 'dtu-9', title: 'pinned', tier: 'regular' }]);
    store().macroStarted({ runId: 'r1', domain: 'reason', action: 'verify' });
    store().macroStage({ runId: 'r1', stage: 'judging' });
    store().macroCompleted({ runId: 'r1', domain: 'reason', action: 'verify', ok: true, ms: 5 });
    // Untouched by any of the socket-adapter actions above.
    expect(store().lastVerify).toEqual({ verdict: 'grounded', mode: 'proof', confidence: 1 });
    expect(store().runDtuRefs).toEqual([{ id: 'dtu-9', title: 'pinned', tier: 'regular' }]);
    // reset() is the one exception (it clears everything), pinned separately above.
  });
});
