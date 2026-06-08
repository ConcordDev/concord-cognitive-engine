// ConKay HUD store — Track B Phase 2 "honest by construction" contract.
//
// The store is the single binding between the REAL macro:* lifecycle events
// and the holographic scene. These tests pin that:
//   - inFlight tracks real started-minus-completed runs (rings spin IFF > 0)
//   - telemetry[] holds only real return facts (domain.action / ok / ms),
//     newest-first, capped — never a guessed/ambient value
//   - reset clears everything (no rings persisting after close)

import { describe, it, expect, beforeEach } from 'vitest';
import { useConkayHudStore, TELEMETRY_CAP } from '@/components/conkay/conkayHudStore';

const fresh = () =>
  useConkayHudStore.setState({
    inFlight: 0,
    activeLabel: null,
    last: null,
    telemetry: [],
    startedAt: null,
    _runIds: new Set<string>(),
  });

describe('ConKay HUD store (honest-by-construction binding)', () => {
  beforeEach(() => fresh());

  it('inFlight rises on macro:started and falls on macro:completed', () => {
    const s = useConkayHudStore.getState();
    s.macroStarted({ runId: 'r1', domain: 'math', action: 'naturalQuery' });
    expect(useConkayHudStore.getState().inFlight).toBe(1);
    expect(useConkayHudStore.getState().activeLabel).toBe('math.naturalQuery');
    s.macroCompleted({ runId: 'r1', domain: 'math', action: 'naturalQuery', ok: true, ms: 42 });
    expect(useConkayHudStore.getState().inFlight).toBe(0);
  });

  it('dedupes repeated starts for the same runId', () => {
    const s = useConkayHudStore.getState();
    s.macroStarted({ runId: 'r1', domain: 'd', action: 'a' });
    s.macroStarted({ runId: 'r1', domain: 'd', action: 'a' });
    expect(useConkayHudStore.getState().inFlight).toBe(1);
  });

  it('records the real return facts into telemetry, newest first', () => {
    const s = useConkayHudStore.getState();
    s.macroCompleted({ runId: 'r1', domain: 'math', action: 'solve', ok: true, ms: 12 });
    s.macroCompleted({ runId: 'r2', domain: 'reason', action: 'verify', ok: false, ms: 99 });
    const t = useConkayHudStore.getState().telemetry;
    expect(t[0]).toEqual({ domain: 'reason', action: 'verify', ok: false, ms: 99 });
    expect(t[1]).toEqual({ domain: 'math', action: 'solve', ok: true, ms: 12 });
    expect(useConkayHudStore.getState().last).toEqual(t[0]);
  });

  it('caps telemetry history at TELEMETRY_CAP', () => {
    const s = useConkayHudStore.getState();
    for (let i = 0; i < TELEMETRY_CAP + 4; i++) {
      s.macroCompleted({ runId: `r${i}`, domain: 'd', action: `a${i}`, ok: true, ms: i });
    }
    expect(useConkayHudStore.getState().telemetry.length).toBe(TELEMETRY_CAP);
    // newest kept, oldest dropped
    expect(useConkayHudStore.getState().telemetry[0].action).toBe(`a${TELEMETRY_CAP + 3}`);
  });

  it('ms is null when the event omits it (no fabricated timing)', () => {
    const s = useConkayHudStore.getState();
    s.macroCompleted({ runId: 'r1', domain: 'd', action: 'a', ok: true });
    expect(useConkayHudStore.getState().telemetry[0].ms).toBeNull();
  });

  it('reset clears all HUD state', () => {
    const s = useConkayHudStore.getState();
    s.macroStarted({ runId: 'r1', domain: 'd', action: 'a' });
    s.macroCompleted({ runId: 'r1', domain: 'd', action: 'a', ok: true, ms: 5 });
    s.reset();
    const st = useConkayHudStore.getState();
    expect(st.inFlight).toBe(0);
    expect(st.telemetry).toEqual([]);
    expect(st.last).toBeNull();
    expect(st.activeLabel).toBeNull();
  });
});
