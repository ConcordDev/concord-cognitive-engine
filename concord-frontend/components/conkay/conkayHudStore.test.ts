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
