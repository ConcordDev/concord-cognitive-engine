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

// Unit F7 extension — `lastFea` (substrate for the K3 Forward-Sim panel): a
// third narrow single-writer exception, same spirit as F2's. A completed FEA
// solve's full result (displacements / utilization / stresses) does NOT flow
// over the macro:* socket events either — `macro:completed` carries only
// {domain, action, ok, ms}. The real payload comes back ONLY on the direct
// `lensRun('engineering','runFEA',...)` return inside ConKayOverlay's
// `executeMacro`, which is ALSO the one place the run's INPUT model (nodes +
// members) still exists. So `setLastFea` is called ONLY from there, right where
// both halves are in hand — never a new arbitrary write site. `feaResultFromRun`
// (exported below, pinned by a test) does the pure, deterministic reshape of
// {input model} + {real solver return} into the exact shape FEAResultViewer's
// props want; it returns null unless BOTH halves are real, so a partial or
// failed run can never produce a half-real preview. No fabrication — the panel
// renders the solver's own numbers or nothing.

// Unit F9 extension — `lastArtifact` (substrate for the K5 Artifact Viewer
// panel): a fourth narrow single-writer exception, same spirit as F2's/F7's. A
// real macro artifact (an ar.render scene / a runFEA solve / a foundry.preview
// world / a forge.sandbox app) does NOT flow over the macro:* socket events —
// those carry only {domain, action, ok, ms}. The real payload comes back ONLY on
// the direct `lensRun(...)` return inside ConKayOverlay's `executeMacro`, which
// is ALSO the one place the run's INPUT object still exists (the fea-frame kind
// needs it for geometry). So `setLastArtifact` is called ONLY from there, right
// after a real return, via the pure `detectArtifact(domain, macro, input,
// result)` registry (lib/conkay/artifact-kinds.ts) — which returns null unless
// the result genuinely matches a kind's real shape, so a non-artifact run can
// never produce a fabricated preview. FEA is one of the registry's kinds, so a
// runFEA run populates BOTH `lastFea` (for the untouched ForwardSimPanel) and
// `lastArtifact` from the SAME pure `feaResultFromRun` — no divergence.

import { create } from 'zustand';
import type { ConkayArtifact } from '@/lib/conkay/artifact-kinds';

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

/** A completed FEA solve reshaped for the Forward-Sim panel's FEAResultViewer
 *  embed — structurally the exact shape that component's props expect
 *  (`FEANode` / `FEAMember` / `FEADisplacement`). Every value here is real
 *  solver output (see `feaResultFromRun`), never fabricated. */
export interface ConkayFeaResult {
  /** Structural geometry, straight from the run's input model. */
  nodes: { id: string; x: number; y: number; z: number }[];
  /** Input connectivity merged with the solver's real utilization + stress. */
  members: { id: string; nodeI: string; nodeJ: string; utilization: number; stress: number }[];
  /** Per-node deflection, straight from the solver return (1:1 shape). */
  displacements: { nodeId: string; dx: number; dy: number; dz: number }[];
  /** The solver's own summary (maxUtilization / allPass / …), or null. */
  summary: Record<string, unknown> | null;
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
  /** The most recent completed `engineering.runFEA` result, reshaped for the
   *  Forward-Sim panel's FEAResultViewer embed, or null until one lands. Set
   *  ONLY from ConKayOverlay's `executeMacro` (see header — the one site where
   *  the real return + its input model both exist). */
  lastFea: ConkayFeaResult | null;
  /** The most recent real macro artifact normalized into the canonical
   *  `ConkayArtifact` shape (ar.render / runFEA / foundry.preview /
   *  forge.sandbox / a building-shaped result), or null until one lands.
   *  Substrate for the K5 Artifact Viewer panel. Set ONLY from ConKayOverlay's
   *  `executeMacro` (see header — the one site where the real return + its input
   *  object both exist), via the pure `detectArtifact` registry. */
  lastArtifact: ConkayArtifact | null;
  /** True once the socket has been confirmed disconnected past its grace period
   *  (a real backend death, not a transient blip — see socket.ts's
   *  `onConnectionLost`). Set by `markConnectionLost` / cleared by
   *  `markReconnected` (and by a fresh `macroStarted`). Lets the HUD say WHY the
   *  rings stopped rather than silently going idle — going idle on a real
   *  backend death without saying so is itself a small honesty gap. */
  connectionLost: boolean;

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
  /** The real FEA solve just returned by `engineering.runFEA` (or null to
   *  clear). Called ONLY from ConKayOverlay's `executeMacro`. */
  setLastFea: (r: ConkayFeaResult | null) => void;
  /** The real macro artifact just detected from a `lensRun` return (or null to
   *  clear). Called ONLY from ConKayOverlay's `executeMacro`. */
  setLastArtifact: (a: ConkayArtifact | null) => void;

  // ── connection-lifecycle actions (CALL ONLY FROM the socket-lifecycle
  //    adapter in ConKayOverlay — the `onConnectionLost`/`onReconnected`
  //    subscriptions, siblings of the macro:* adapter) ──
  /** The backend was confirmed gone (grace period elapsed with no reconnect):
   *  clear all in-progress state so the scene's rings stop, and flag WHY. */
  markConnectionLost: () => void;
  /** The socket reconnected — clear the connection-lost flag. In-progress state
   *  stays whatever the real macro:* events since have made it. */
  markReconnected: () => void;
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
  lastFea: null,
  lastArtifact: null,
  connectionLost: false,

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
        // A real macro started ⟹ the backend is reachable — any prior
        // connection-lost flag is stale.
        connectionLost: false,
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
      lastFea: null,
      lastArtifact: null,
      connectionLost: false,
    })),

  setLastVerify: (v) => set(() => ({ lastVerify: v })),
  setRunDtuRefs: (refs) => set(() => ({ runDtuRefs: Array.isArray(refs) ? refs : [] })),
  setLastFea: (r) => set(() => ({ lastFea: r })),
  setLastArtifact: (a) => set(() => ({ lastArtifact: a })),

  markConnectionLost: () =>
    set((s) => ({
      // Confirmed backend death: clear ALL in-progress state so the scene's
      // rings stop (motion ⟺ real in-flight work). Completed telemetry facts
      // (`last`, `telemetry`, `lastVerify`, `runDtuRefs`, `lastFea`,
      // `lastArtifact`) are REAL history — they stay (preserved by the `...s`
      // spread), because clearing them would lose truth for no
      // honesty gain. The flag records WHY motion stopped.
      ...s,
      inFlight: 0,
      activeLabel: null,
      startedAt: null,
      stage: null,
      _runIds: new Set<string>(),
      connectionLost: true,
    })),

  markReconnected: () => set(() => ({ connectionLost: false })),
}));

// ── FEA reshape (pure, exported for pinning) ─────────────────────────────────
// Map an `engineering.runFEA` INPUT model + its REAL return into the exact
// FEAResultViewer prop shape. Defensive by construction: returns null unless
// BOTH halves carry the arrays it needs, so a partial/failed run can never
// produce a half-real preview. Mirrors the backend's own `model = data.model
// || data` convention (server/domains/engineering.js#runFEA) and the solver's
// row shapes (server/lib/simulation/fea-solver.js): displacements are 1:1
// (nodeId/dx/dy/dz), member utilization + stress are joined by member id from
// the solver's `utilization[]` and `stresses[].combinedStress`.

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
}

export function feaResultFromRun(input: unknown, result: unknown): ConkayFeaResult | null {
  const inObj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  // Backend does `model = data.model || data` — mirror it exactly.
  const modelRaw = (inObj.model && typeof inObj.model === 'object' ? inObj.model : inObj) as Record<string, unknown>;
  const res = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};

  const inNodes = asRecordArray(modelRaw.nodes);
  const inMembers = asRecordArray(modelRaw.members);
  const displacements = asRecordArray(res.displacements);
  const utilization = asRecordArray(res.utilization);
  const stresses = asRecordArray(res.stresses);

  // Both halves must be real: an input geometry AND a solver return. Otherwise
  // there's nothing honest to preview.
  if (inNodes.length === 0 || inMembers.length === 0 || displacements.length === 0) return null;

  const utilById = new Map<string, number>();
  for (const u of utilization) utilById.set(String(u.id), num(u.utilization));
  const stressById = new Map<string, number>();
  for (const s of stresses) stressById.set(String(s.id), num(s.combinedStress));

  const nodes = inNodes.map((n) => ({ id: String(n.id), x: num(n.x), y: num(n.y), z: num(n.z) }));
  const members = inMembers.map((m) => {
    const id = String(m.id);
    return {
      id,
      nodeI: String(m.nodeI),
      nodeJ: String(m.nodeJ),
      utilization: utilById.get(id) ?? 0,
      stress: stressById.get(id) ?? 0,
    };
  });
  const disp = displacements.map((d) => ({
    nodeId: String(d.nodeId),
    dx: num(d.dx),
    dy: num(d.dy),
    dz: num(d.dz),
  }));
  const summary = res.summary && typeof res.summary === 'object' ? (res.summary as Record<string, unknown>) : null;

  return { nodes, members, displacements: disp, summary };
}
