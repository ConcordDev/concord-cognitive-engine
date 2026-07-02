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
//
// Unit F2 extension — `lastVerify` + `runDtuRefs` (substrate for the upcoming
// K3 verification panels): these two fields are the exception to "socket
// adapter only", and it's a narrow one. reason.verify's verdict does NOT flow
// over the macro:* socket events (macro:completed only carries {domain,
// action, ok, ms}) — it's the direct `lensRun('reason','verify',...)` return
// that ConKayOverlay's `verifyMessage` already uses to stamp a message's
// `verifyVerdict`/`verifyMode`/`verifyConfidence`. So `setLastVerify` /
// `setRunDtuRefs` are called ONLY from inside that same `verifyMessage`
// function, right where it computes those message fields — never a new
// arbitrary write site, just the one legitimate producer of a real verify
// result also mirroring the fact into the store. `runDtuRefs` carries the
// exact `{id, title, tier}` shape ConKay skills already attach to messages
// as `dtuRefs` (see `conkay-skills.ts#ConKaySkillResult`) — not re-invented.

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
interface MacroStageEvent {
  runId?: string;
  /** A real sub-step the backend macro reported reaching (e.g. "judging"). */
  stage?: string;
  detail?: string;
}

/** The real reason.verify verdict — straight from the macro's return, never a guess. */
export interface ConkayVerifyVerdict {
  /** grounded | citations_resolve | unsupported | fabricated_citation | unverified | proven | refuted */
  verdict: string;
  /** How the verdict was reached ('council' | 'proof' | 'deterministic'), or null if unreported. */
  mode: string | null;
  /** The council/proof confidence [0..1] the macro reported, or null. */
  confidence: number | null;
}

/** A DTU reference in the exact shape ConKay skills already attach to messages
 *  (`conkay-skills.ts#ConKaySkillResult.dtuRefs`) — reused verbatim, not re-shaped. */
export interface ConkayDtuRef {
  id: string;
  title: string | null;
  tier: string | null;
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
  /** The most recent real `macro:stage` sub-step name while a run is in flight,
   *  or null. Cleared on start + completion — never lingers as fake progress. */
  stage: string | null;
  /** Internal: the set of run ids currently in flight (dedupes repeat events). */
  _runIds: Set<string>;
  /** The most recent real `reason.verify` verdict, or null until one has
   *  completed. Substrate for the upcoming K3 verification panels. */
  lastVerify: ConkayVerifyVerdict | null;
  /** The DTU refs the most recent verify call checked the claim against — the
   *  real refs a message already carries, mirrored here for the cockpit. */
  runDtuRefs: ConkayDtuRef[];

  // ── single-writer adapter actions (CALL ONLY FROM the macro:* socket adapter) ──
  /** A real `macro:started` arrived for one of ConKay's runs. */
  macroStarted: (d: MacroStartEvent) => void;
  /** A real `macro:stage` arrived — a genuine sub-step the macro reached. */
  macroStage: (d: MacroStageEvent) => void;
  /** A real `macro:completed` arrived for one of ConKay's runs. */
  macroCompleted: (d: MacroDoneEvent) => void;
  /** Clear all HUD state (call when ConKay closes so rings don't persist). */
  reset: () => void;

  // ── single-writer extension (CALL ONLY FROM ConKayOverlay's `verifyMessage`,
  //    right after it computes the real reason.verify return — see the file
  //    header for why this is a narrow, documented exception) ──
  /** The real reason.verify verdict just returned for the live claim. */
  setLastVerify: (v: ConkayVerifyVerdict | null) => void;
  /** The real DTU refs the live verify call was checked against. */
  setRunDtuRefs: (refs: ConkayDtuRef[]) => void;
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
  stage: null,
  _runIds: new Set<string>(),
  lastVerify: null,
  runDtuRefs: [],

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
        stage: null, // a fresh run starts with no sub-step reported yet
      };
    }),

  macroStage: (d) =>
    set((s) => {
      // Honest: only reflect a stage for a run the backend currently reports in
      // flight (or an anonymous one). A stage with no live run is ignored — we
      // never show a sub-step for work that isn't actually running.
      const id = d.runId ?? '';
      const live = s.inFlight > 0 && (!d.runId || s._runIds.has(id));
      if (!live || !d.stage) return s;
      return { ...s, stage: String(d.stage) };
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
        // A completed run has no live sub-step — clear it so the HUD never shows
        // a stage for finished work.
        stage: next.size > 0 ? s.stage : null,
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
      stage: null,
      _runIds: new Set<string>(),
      lastVerify: null,
      runDtuRefs: [],
    })),

  setLastVerify: (v) => set(() => ({ lastVerify: v })),
  setRunDtuRefs: (refs) => set(() => ({ runDtuRefs: Array.isArray(refs) ? refs : [] })),
}));
