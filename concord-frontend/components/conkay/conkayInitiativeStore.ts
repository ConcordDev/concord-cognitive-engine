'use client';

// concord-frontend/components/conkay/conkayInitiativeStore.ts
//
// CK4 (bridge half) — lets ConKay's ambient widget show a REAL "I have
// something to tell you" signal, sourced from the same tested,
// rate-limited, quiet-hours-respecting backend
// (`server/lib/initiative-engine.js`, "Concord Conversational Initiative
// Engine") that `components/chat/InitiativeBell.tsx` already reads via
// `GET /api/initiative/pending`.
//
// This is deliberately NOT a new suggestion system. `components/chat/
// useChatProactive.ts`'s time-of-day/lens-navigation/idle heuristics
// generate their "proactive" content from `Math.random()` picks over
// hardcoded string arrays with no real signal behind them — that is exactly
// the zero-demo-content violation CLAUDE.md's honest-by-construction
// invariant forbids, and exactly what this file must not become. Every
// initiative surfaced here already passed the real engine's trigger
// evaluation, rate limits (3/day, 10/week, 4h min gap), and quiet-hours
// gate server-side before this store ever sees it.
//
// THE ONE RULE (same discipline as conkayHudStore.ts / conkayAttentionStore.ts):
// the ONLY writer is `useConkayInitiativePoll()` below, a thin poll wrapping
// the real endpoint. Nothing here is invented, re-derived from other UI
// state, or randomly generated.

import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import { useSmartPolling } from '@/hooks/useSmartPolling';

export interface ConkayInitiative {
  id: string;
  triggerType: string;
  message: string;
  priority: string;
  score?: number;
  createdAt: string;
}

interface ConkayInitiativeState {
  /** Real pending initiatives from the backend, in the server's own
   *  score-descending order — never re-sorted or filtered client-side.
   *  Empty until the first successful poll. */
  pending: ConkayInitiative[];
  /** True once at least one poll has completed (success or failure) — lets
   *  a consumer distinguish "definitely zero pending" from "hasn't checked
   *  yet", so the widget never flashes a false "nothing to say" on mount. */
  ready: boolean;

  // ── single-writer action (CALL ONLY FROM useConkayInitiativePoll) ──
  _setPending: (items: ConkayInitiative[]) => void;
}

export const useConkayInitiativeStore = create<ConkayInitiativeState>((set) => ({
  pending: [],
  ready: false,
  _setPending: (items) => set({ pending: items, ready: true }),
}));

/** Real-only shape guard for one row of `GET /api/initiative/pending`'s
 *  `initiatives` array — coerces to strings/undefined, never fabricates a
 *  value for a field the response omitted. */
function normalizeInitiative(raw: unknown): ConkayInitiative | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const message = r.message;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (typeof message !== 'string' || !message) return null;
  const score = typeof r.score === 'number' ? r.score : undefined;
  return {
    id: String(id),
    triggerType: typeof r.triggerType === 'string' ? r.triggerType : (typeof r.trigger === 'string' ? r.trigger : ''),
    message,
    priority: typeof r.priority === 'string' ? r.priority : 'normal',
    score,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : (typeof r.created_at === 'string' ? r.created_at : ''),
  };
}

/**
 * The single writer. Polls the exact same real endpoint
 * `InitiativeBell.tsx` uses (`GET /api/initiative/pending`) — deliberately
 * not a new backend surface. Call this ONCE, from `ConKayWidgetLayer` —
 * never from `ConKayWidget` itself, which stays a pure-prop shell per its
 * own honesty contract (see that file's header).
 */
export function useConkayInitiativePoll(enabled: boolean, intervalMs = 30_000): void {
  const setPending = useConkayInitiativeStore((s) => s._setPending);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useSmartPolling(
    async () => {
      try {
        const path = typeof window !== 'undefined' ? window.location.pathname : '';
        if (path === '/explore' || path.startsWith('/explore/') || path === '/login' || path === '/register') return;
        const r = await fetch('/api/initiative/pending', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as { ok?: boolean; initiatives?: unknown[] };
        if (!mountedRef.current) return;
        if (j?.ok && Array.isArray(j.initiatives)) {
          const items = j.initiatives
            .map(normalizeInitiative)
            .filter((x): x is ConkayInitiative => x !== null);
          setPending(items);
        }
      } catch {
        // Silent — a poll blip must never crash or spam-error the ambient
        // widget. Matches conkayHudStore/conkayAttentionStore's own
        // best-effort posture for anything not on the macro:* lifecycle.
      }
    },
    intervalMs,
    { enabled },
  );
}
