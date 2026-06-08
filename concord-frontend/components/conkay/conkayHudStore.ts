'use client';

// concord-frontend/components/conkay/conkayHudStore.ts
//
// The ConKay HUD store — the load-bearing "honest by construction" binding for
// the Phase-2 holographic scene.
//
// THE ONE RULE (do not break it): the ONLY writer of this store is the ConKay
// macro:* socket adapter — i.e. the lifecycle effect in ConKayOverlay that
// subscribes to the REAL `macro:started` / `macro:completed` events the server
// emits to the user's room (Phase 0). Every field here is therefore a pure
// function of a real backend event:
//   - `inFlight`     = how many of ConKay's macro runs the backend currently
//                      reports as started-but-not-completed. The scene's rings
//                      spin IFF this is > 0. No setInterval, no fake progress —
//                      motion ⟺ real work.
//   - `activeLabel`  = the domain.action the backend most recently reported started.
//   - `last`         = the real return facts (ok + elapsed ms) of the last
//                      completed run — the telemetry the HUD shows is the actual
//                      value the system reported, never a guess.
//
// The scene + any HUD readouts are READ-ONLY consumers (selectors / getState).
// If you find yourself calling a mutator from anywhere other than that socket
// adapter, you are about to fake something — stop.

import { create } from 'zustand';

export interface ConkayTelemetry {
  /** Macro domain the backend ran (e.g. "math"). */
  domain: string;
  /** Macro action the backend ran (e.g. "naturalQuery"). */
  action: string;
  /** Whether the real call succeeded — straight from the event. */
  ok: boolean;
  /** Real elapsed wall-clock ms the server reported, or null if absent. */
  ms: number | null;
}

interface MacroStartEvent {
  runId?: string;
  domain?: string;
  action?: string;
}
interface MacroDoneEvent {
  runId?: string;
  domain?: string;
  action?: string;
  ok?: boolean;
  ms?: number;
}

interface ConkayHudState {
  /** Count of ConKay macro runs the backend currently reports in flight. */
  inFlight: number;
  /** domain.action of the most recent real `macro:started`, or null. */
  activeLabel: string | null;
  /** Return facts of the most recent real `macro:completed`, or null. */
  last: ConkayTelemetry | null;
  /** Recent completed runs (newest first, capped at TELEMETRY_CAP) — the source
   *  for the scene's telemetry panels. Each entry is a real `macro:completed`
   *  fact, never a guess. */
  telemetry: ConkayTelemetry[];
  /** perf.now() of the most recent start — lets the scene ramp ring spin-up honestly. */
  startedAt: number | null;
  /** Internal: the set of run ids currently in flight (dedupes repeat events). */
  _runIds: Set<string>;

  // ── single-writer adapter actions (CALL ONLY FROM the macro:* socket adapter) ──
  /** A real `macro:started` arrived for one of ConKay's runs. */
  macroStarted: (d: MacroStartEvent) => void;
  /** A real `macro:completed` arrived for one of ConKay's runs. */
  macroCompleted: (d: MacroDoneEvent) => void;
  /** Clear all HUD state (call when ConKay closes so rings don't persist). */
  reset: () => void;
}

const labelOf = (d: { domain?: string; action?: string }) =>
  `${d.domain ?? '?'}.${d.action ?? '?'}`;

/** How many recent runs the scene's telemetry panels show. */
export const TELEMETRY_CAP = 6;

export const useConkayHudStore = create<ConkayHudState>((set) => ({
  inFlight: 0,
  activeLabel: null,
  last: null,
  telemetry: [],
  startedAt: null,
  _runIds: new Set<string>(),

  macroStarted: (d) =>
    set((s) => {
      // A run with no id can't be tracked precisely — treat it as a single
      // anonymous in-flight unit so the rings still reflect real work.
      const id = d.runId ?? `anon:${labelOf(d)}`;
      if (s._runIds.has(id)) return s; // dedupe repeat starts
      const next = new Set(s._runIds);
      next.add(id);
      return {
        ...s,
        _runIds: next,
        inFlight: next.size,
        activeLabel: labelOf(d),
        startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      };
    }),

  macroCompleted: (d) =>
    set((s) => {
      const id = d.runId ?? `anon:${labelOf(d)}`;
      const next = new Set(s._runIds);
      next.delete(id);
      const fact: ConkayTelemetry = {
        domain: d.domain ?? '?',
        action: d.action ?? '?',
        ok: d.ok !== false,
        ms: typeof d.ms === 'number' ? d.ms : null,
      };
      return {
        ...s,
        _runIds: next,
        inFlight: next.size,
        last: fact,
        // Newest first, capped — the panels render the real return facts only.
        telemetry: [fact, ...s.telemetry].slice(0, TELEMETRY_CAP),
      };
    }),

  reset: () =>
    set(() => ({
      inFlight: 0,
      activeLabel: null,
      last: null,
      telemetry: [],
      startedAt: null,
      _runIds: new Set<string>(),
    })),
}));
