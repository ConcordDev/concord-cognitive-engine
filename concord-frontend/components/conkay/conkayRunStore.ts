'use client';

// concord-frontend/components/conkay/conkayRunStore.ts
//
// Unit A4 — the ConKay "mission-control" run store. The load-bearing "honest by
// construction" binding for the mission-control cockpit panel
// (ConKayMissionControl).
//
// THE ONE RULE (do not break it): the ONLY writer of this store is
// ConKayOverlay's free-form agent-loop SSE reader (`chatWithBrain`). Every field
// here is therefore a pure function of a REAL Server-Sent Event the overlay
// already receives from `/api/chat-agent/stream`:
//   - `runStarted()`      ⟵ the moment a free-form run begins streaming
//                            (mirrors the overlay's `beginWork('Thinking…')`).
//   - `toolCallReceived()` ⟵ ONE real `tool_call` SSE event. Each is a truthful
//                            AFTER-THE-FACT RECEIPT — server/lib/chat-agent.js
//                            already executed the tool server-side before the
//                            event was emitted (see the overlay's tool_call
//                            handler comment). The payload is the executeToolCall
//                            return: { tool, ok, domain?, action?, input?,
//                            result?, error? }.
//   - `runFinished()`     ⟵ the real `done` SSE event (or a stream error).
//
// This store is DISTINCT from `conkayHudStore` on purpose: that store mirrors the
// `macro:*` SOCKET lifecycle of CLIENT-INITIATED macro runs (those tagged with an
// x-conkay-run-id). The free-form agent loop's tool calls arrive over a DIFFERENT
// channel (the SSE token stream) and carry no such run-id, so they never reach the
// HUD store. This store is the honest home for that second, real signal.
//
// The panel is a READ-ONLY consumer (selectors / getState). If you find yourself
// calling a mutator from anywhere other than that SSE reader, you are about to
// fake something — stop. No field is ever set from a timer/interval; a step
// exists here ONLY because a real `tool_call` event carried it.

import { create } from 'zustand';

/** The real reason.verify verdict a `reason.verify` tool call returned, or null.
 *  Straight from the tool_call `result` payload — never a guess. */
export interface ConkayRunVerify {
  /** grounded | citations_resolve | unsupported | fabricated_citation | unverified | proven | refuted */
  verdict: string;
  /** How the verdict was reached ('council' | 'proof' | 'deterministic'), or null. */
  mode: string | null;
  /** The council/proof confidence [0..1] the macro reported, or null. */
  confidence: number | null;
}

/** One real tool call, promoted from a `tool_call` SSE receipt into a plan step. */
export interface ConkayRunStep {
  /** 1-based execution order (the order the SSE events arrived = execution order). */
  seq: number;
  /** The tool name the agent invoked, e.g. "run_lens_action" / "web_search". */
  tool: string;
  /** The lens domain (run_lens_action only), or null. */
  domain: string | null;
  /** The lens action (run_lens_action only), or null. */
  action: string | null;
  /** Whether the real call succeeded — straight from the event's `ok`, or null. */
  ok: boolean | null;
  /** A compact one-line summary of the REAL input the tool ran with, or null. */
  inputSummary: string | null;
  /** The real error string the tool returned on failure, or null. */
  error: string | null;
  /** The real reason.verify verdict this step produced (reason.verify only), or null. */
  verify: ConkayRunVerify | null;
}

/** The subset of a `tool_call` SSE payload this store reads (executeToolCall's
 *  return shape — server/lib/chat-agent.js#executeToolCall). */
export interface RawToolCall {
  tool?: string;
  ok?: boolean;
  key?: string;
  domain?: string;
  action?: string;
  input?: unknown;
  params?: unknown;
  result?: unknown;
  error?: string;
}

interface ConkayRunState {
  /** The ordered real tool calls of the CURRENT (or most recent) free-form run. */
  steps: ConkayRunStep[];
  /** True while a run is actively streaming (runStarted → runFinished). Drives the
   *  header's "running" affordance — a CSS pulse, never a timer. */
  active: boolean;
  /** The real `done`/error outcome of the last finished run, or null while active. */
  finalError: string | null;
  /** Monotonic step counter for the current run (reset on runStarted). */
  _seq: number;

  // ── single-writer actions (CALL ONLY FROM ConKayOverlay's chatWithBrain SSE reader) ──
  /** A free-form run began streaming — clear the prior plan and go active. */
  runStarted: () => void;
  /** A real `tool_call` SSE event arrived — append it as the next ordered step. */
  toolCallReceived: (raw: RawToolCall) => void;
  /** The real `done` event (or a stream error) landed — stop the running state. */
  runFinished: (outcome?: { ok?: boolean; error?: string }) => void;
  /** Clear all run state (e.g. when ConKay tears down). */
  reset: () => void;
}

/** Compact, honest one-line summary of a real tool input. Renders only what the
 *  event actually carried — returns null when there is no input to show, so the
 *  panel never prints an empty "()" for a tool that reported no input. */
export function summarizeInput(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'object') {
    const s = String(input).trim();
    return s ? (s.length > 120 ? s.slice(0, 120) + '…' : s) : null;
  }
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;
  const parts = keys.slice(0, 4).map((k) => {
    const v = obj[k];
    let vs: string;
    if (v == null) vs = 'null';
    else if (typeof v === 'string') vs = v;
    else if (Array.isArray(v)) vs = `[${v.length}]`;
    else if (typeof v === 'object') vs = '{…}';
    else vs = String(v);
    if (vs.length > 40) vs = vs.slice(0, 40) + '…';
    return `${k}: ${vs}`;
  });
  let out = parts.join(', ');
  if (keys.length > 4) out += `, +${keys.length - 4} more`;
  return out;
}

/** Extract a real reason.verify verdict from a tool_call receipt, or null. Only
 *  fires for a run_lens_action against `reason.verify`; reads the verdict from the
 *  real `result` payload (the LENS_ACTIONS handler return), defending against both
 *  the bare `{verdict}` and nested `{result:{verdict}}` handler shapes. Never
 *  fabricates — absent/malformed result ⇒ null. */
export function extractVerify(raw: RawToolCall): ConkayRunVerify | null {
  if (raw.domain !== 'reason' || raw.action !== 'verify') return null;
  const res = raw.result;
  if (!res || typeof res !== 'object') return null;
  const outer = res as Record<string, unknown>;
  const inner =
    typeof outer.verdict === 'string'
      ? outer
      : outer.result && typeof outer.result === 'object'
        ? (outer.result as Record<string, unknown>)
        : outer;
  if (typeof inner.verdict !== 'string' || !inner.verdict) return null;
  return {
    verdict: inner.verdict,
    mode: typeof inner.mode === 'string' ? inner.mode : null,
    confidence: typeof inner.confidence === 'number' ? inner.confidence : null,
  };
}

/** Pure builder: a raw `tool_call` receipt + its sequence number → a plan step.
 *  Exported for direct unit pinning. Never invents a field the event didn't
 *  carry — `run_lens_action` gets a domain/action, everything else leaves them
 *  null; `input` falls back to `params` (only run_lens_action carries `input`). */
export function toRunStep(raw: RawToolCall, seq: number): ConkayRunStep {
  const tool = String(raw.tool || 'tool');
  const isLens = tool === 'run_lens_action';
  return {
    seq,
    tool,
    domain: isLens && raw.domain ? String(raw.domain) : null,
    action: isLens && raw.action ? String(raw.action) : null,
    ok: typeof raw.ok === 'boolean' ? raw.ok : null,
    inputSummary: summarizeInput(raw.input ?? raw.params),
    error: typeof raw.error === 'string' && raw.error ? raw.error : null,
    verify: extractVerify(raw),
  };
}

export const useConkayRunStore = create<ConkayRunState>((set) => ({
  steps: [],
  active: false,
  finalError: null,
  _seq: 0,

  runStarted: () =>
    set(() => ({ steps: [], active: true, finalError: null, _seq: 0 })),

  toolCallReceived: (raw) =>
    set((s) => {
      const seq = s._seq + 1;
      return { ...s, _seq: seq, steps: [...s.steps, toRunStep(raw, seq)] };
    }),

  runFinished: (outcome) =>
    set((s) => ({
      ...s,
      active: false,
      finalError:
        outcome && outcome.ok === false ? String(outcome.error || 'run failed') : null,
    })),

  reset: () => set(() => ({ steps: [], active: false, finalError: null, _seq: 0 })),
}));
