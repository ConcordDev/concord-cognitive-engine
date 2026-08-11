// concord-frontend/components/conkay/sessionContextBudget.ts
//
// Pure derivation layer for ConKay's session-context budget UI.
//
// THE HONESTY CONTRACT — same discipline as the rest of components/conkay/:
//   - Every number shown to the user comes from a REAL backend endpoint
//     (GET /api/chat/context-budget/:sessionId), never a fabricated guess.
//   - The four displayed states are pure functions of {messageCount,
//     threshold, batchSize} and the polling result's freshness. No
//     state is faked when the endpoint is unreachable; the badge says
//     so.
//   - The 'recommendation' copy ("say 'compress'") is the ACTUAL fix
//     against the actual backend (chat.summary macro →
//     compressRollingWindow in lib/conversation-memory.js). It is not
//     a UI hint that does nothing — it's a real command.
//
// This file is intentionally renderer-free (no React, no fetch, no DOM).
// It exports `deriveBudgetState(budget, freshnessMs)` and `formatBadge`
// so the derived logic is testable without JSDOM, and so the same
// function can power the HUD chip, the proactive toast, and the
// "I'm at 73%" reply-insert in ConKay's voice reply.
//
// IMPORTANT: thresholds and copy are pinned by tests at
// tests/components/sessionContextBudget.test.ts.

/** Wire shape from GET /api/chat/context-budget/:sessionId. */
export interface ContextBudgetWire {
  ok: true;
  sessionId: string;
  messageCount: number;
  /** Auto-compression fires when messageCount >= threshold. */
  threshold: number;
  /** How many oldest messages one compression pass removes. */
  batchSize: number;
  /** 0-100 fill of the budget (capped; never reads 240%). */
  usagePct: number;
  /** True iff messageCount >= threshold (i.e. auto-compress is due). */
  atOrOverThreshold: boolean;
  /** threshold - messageCount. Negative means "already past the wire." */
  turnsUntilAuto: number;
}

/** What the wire returned in its last successful fetch (or 'never'). */
export type FetchFreshness = 'fresh' | 'stale' | 'never-fetched' | 'unreachable';

/** The four honest UI states, derived from the wire + freshness. */
export type BudgetKind =
  | 'unreachable' // endpoint errored or never returned; chip says so
  | 'empty' // messageCount === 0 (genuinely a brand-new session)
  | 'green' // below 50% of threshold
  | 'yellow' // 50%..84%
  | 'red' // 85%..100% (under threshold but full enough to nudge)
  | 'over'; // at-or-over threshold — auto-compress is due

export interface BudgetDerivation {
  kind: BudgetKind;
  /** The literal text the badge shows to the user. */
  label: string;
  /** True iff the user is being encouraged to say "compress" (50%+). */
  recommendCompress: boolean;
  /** True iff auto-compression is CURRENTLY due (>= threshold). */
  autoCompressionDue: boolean;
  /** Hint shown to ConKay's voice reply when recommending compression
   *  (e.g. "Your session is 73% full. Say 'compress' to compress the
   *  oldest turns into a summary DTU."). Empty string when not
   *  recommending. */
  voiceHint: string;
}

/** Pure derivation — no IO, no fetch, no React. */
export function deriveBudgetState(
  budget: ContextBudgetWire | null | undefined,
  freshness: FetchFreshness,
  nowMs: number = Date.now(),
  lastFetchMs: number | null = null,
): BudgetDerivation {
  // unreachable / never fetched → always "unreachable" regardless of any
  // locally-cached budget object. Honesty rule: if the latest fetch
  // didn't come back from the real endpoint, we cannot claim a fill %.
  if (freshness === 'unreachable' || freshness === 'never-fetched') {
    return {
      kind: 'unreachable',
      label: freshness === 'never-fetched' ? 'Context: not loaded' : 'Context: unreachable',
      recommendCompress: false,
      autoCompressionDue: false,
      voiceHint: '',
    };
  }

  // freshness === 'fresh' or 'stale' but with a budget to render.
  // When stale > 2 minutes old, treat as unreachable for the chip's
  // purposes — we won't recommend on possibly-stale data.
  if (!budget || !budget.ok) {
    return {
      kind: 'unreachable',
      label: 'Context: unreachable',
      recommendCompress: false,
      autoCompressionDue: false,
      voiceHint: '',
    };
  }
  const STALE_MS = 2 * 60_000;
  if (freshness === 'stale' && lastFetchMs !== null && nowMs - lastFetchMs > STALE_MS) {
    return {
      kind: 'unreachable',
      label: 'Context: stale (>2m)',
      recommendCompress: false,
      autoCompressionDue: false,
      voiceHint: '',
    };
  }

  const { messageCount, threshold, batchSize, usagePct, atOrOverThreshold, turnsUntilAuto } = budget;

  if (messageCount === 0) {
    return {
      kind: 'empty',
      label: 'Context: 0 turns',
      recommendCompress: false,
      autoCompressionDue: false,
      voiceHint: '',
    };
  }
  if (atOrOverThreshold) {
    // "over" is the loud state — auto-compression is CURRENTLY due.
    const turnsLabel =
      turnsUntilAuto <= 0
        ? 'Compressing automatically'
        : `${turnsUntilAuto} turns past`;
    return {
      kind: 'over',
      label: `Context: ${messageCount} turns · ${usagePct}% (auto-compress due)`,
      recommendCompress: true,
      autoCompressionDue: true,
      voiceHint: `Your session is past the ${threshold}-turn threshold with ${messageCount} turns and ${batchSize} older ones queued. Say "compress" to summarize them now into a DTU.`,
    };
  }
  if (usagePct >= 85) {
    return {
      kind: 'red',
      label: `Context: ${messageCount} turns · ${usagePct}% (say "compress")`,
      recommendCompress: true,
      autoCompressionDue: false,
      voiceHint: `Your session is ${usagePct}% full with ${threshold - messageCount} turns before auto-compression. Say "compress" to summarize the oldest turns now.`,
    };
  }
  if (usagePct >= 50) {
    return {
      kind: 'yellow',
      label: `Context: ${messageCount} turns · ${usagePct}%`,
      recommendCompress: true,
      autoCompressionDue: false,
      voiceHint: `Your session is ${usagePct}% full. Say "compress" to summarize the oldest turns now.`,
    };
  }
  return {
    kind: 'green',
    label: `Context: ${messageCount} turns · ${usagePct}%`,
    recommendCompress: false,
    autoCompressionDue: false,
    voiceHint: '',
  };
}
