'use client';

/**
 * useChatProactive — Proactive message system for the Chat Rail.
 *
 * Every message this hook surfaces is either:
 *   - a real, currently-pending initiative from Concord's conversational
 *     initiative engine (server/lib/initiative-engine.js — 8 real trigger
 *     types, rate-limited, quiet-hours-aware), fetched from the same
 *     `GET /api/initiative/pending` endpoint `InitiativeBell.tsx` and
 *     ConKay's `conkayInitiativeStore.ts` use, or pushed live via the
 *     `initiative:new` socket event; or
 *   - a real DTU creation/promotion event (`dtu:created`/`dtu:promoted`),
 *     fed with the real title from that event.
 *
 * This file used to also generate three kinds of "proactive suggestion"
 * from nothing: a time-of-day pick, a lens-navigation pick, and an idle
 * pick — each chosen via `Math.random()` from a hardcoded string array
 * with no real signal behind it (the idle one literally claimed "I
 * noticed some cross-domain connections you might find interesting" when
 * nothing had been noticed at all). That was a real zero-demo-content
 * violation — CLAUDE.md's honest-by-construction invariant, the same one
 * `conkayInitiativeStore.ts`/CK4 was built around. Removed rather than
 * "improved," since there was no real signal to ground it in; the
 * initiative engine already covers the same ground honestly (its
 * `morning_context`/`reflective_followup`/`pending_work` trigger types are
 * the real versions of what those fake generators were approximating).
 */

import { useState, useEffect, useCallback } from 'react';
import type { ProactiveMessage } from './ChatModeTypes';

interface UseChatProactiveOptions {
  currentLens: string;
  messageCount: number;
  enabled: boolean;
  /** Socket event listener — if provided, subscribes to server-pushed initiative events */
  onSocket?: (event: string, handler: (data: unknown) => void) => void;
  /** Socket event unsubscribe */
  offSocket?: (event: string, handler: (data: unknown) => void) => void;
}

interface PendingInitiativeRow {
  id?: string;
  message?: string;
  priority?: string;
  createdAt?: string;
}

function normalizePendingInitiative(row: unknown): ProactiveMessage | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as PendingInitiativeRow;
  if (!r.id || !r.message) return null;
  return {
    id: String(r.id),
    trigger: 'server_initiative',
    content: r.message,
    actionLabel: 'Tell me more',
    actionPayload: r.message,
    dismissed: false,
    timestamp: r.createdAt || new Date().toISOString(),
  };
}

export function useChatProactive({
  enabled,
  onSocket,
  offSocket,
}: UseChatProactiveOptions) {
  const [proactiveMessages, setProactiveMessages] = useState<ProactiveMessage[]>([]);

  // Dismiss a proactive message
  const dismissProactive = useCallback((id: string) => {
    setProactiveMessages(prev =>
      prev.map(m => m.id === id ? { ...m, dismissed: true } : m)
    );
  }, []);

  // Dismiss all proactive messages
  const dismissAll = useCallback(() => {
    setProactiveMessages(prev => prev.map(m => ({ ...m, dismissed: true })));
  }, []);

  // Add a DTU event notification — real, caller-supplied title only.
  const addDTUNotification = useCallback((dtuTitle: string, action: 'created' | 'promoted') => {
    const msg: ProactiveMessage = {
      id: `dtu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trigger: 'dtu_event',
      content: action === 'created'
        ? `New DTU created: "${dtuTitle}". Want to explore it?`
        : `DTU promoted: "${dtuTitle}". It's now available globally.`,
      actionLabel: 'View DTU',
      actionPayload: `Show me details about the DTU "${dtuTitle}"`,
      dismissed: false,
      timestamp: new Date().toISOString(),
    };
    setProactiveMessages(prev => [...prev.slice(-4), msg]); // Keep max 5
  }, []);

  // Real, already-pending initiatives — the same endpoint CK4/InitiativeBell
  // use. Seeds the rail on open so a user doesn't miss something that fired
  // while the rail was closed; the socket listener below covers what fires
  // while it's open.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/initiative/pending', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as { ok?: boolean; initiatives?: unknown[] };
        if (cancelled || !j?.ok || !Array.isArray(j.initiatives)) return;
        const real = j.initiatives
          .map(normalizePendingInitiative)
          .filter((m): m is ProactiveMessage => m !== null);
        if (real.length === 0) return;
        setProactiveMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const merged = [...prev, ...real.filter(m => !existingIds.has(m.id))];
          return merged.slice(-5);
        });
      } catch {
        // Silent — a poll failure must never crash or spam-error the rail.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  // Server-pushed initiative events via WebSocket — real, unchanged.
  useEffect(() => {
    if (!enabled || !onSocket || !offSocket) return;

    const handleInitiative = (data: unknown) => {
      const d = data as {
        id?: string;
        triggerType?: string;
        message?: string;
        priority?: string;
        score?: number;
        metadata?: Record<string, unknown>;
        createdAt?: string;
      };
      if (!d?.id || !d?.message) return;

      const msg: ProactiveMessage = {
        id: d.id,
        trigger: 'server_initiative',
        content: d.message,
        actionLabel: 'Tell me more',
        actionPayload: d.message,
        dismissed: false,
        timestamp: d.createdAt || new Date().toISOString(),
      };
      setProactiveMessages(prev => [...prev.slice(-4), msg]); // Keep max 5
    };

    onSocket('initiative:new', handleInitiative);
    return () => {
      offSocket('initiative:new', handleInitiative);
    };
  }, [enabled, onSocket, offSocket]);

  // No-op, kept for external-caller compatibility (PersistentChatRail.tsx
  // calls this on user activity). It used to reset a timer that gated the
  // fabricated idle suggestion above; there's nothing left for it to do
  // now that generator is gone, but removing the call site is out of
  // scope for this fix.
  const resetIdleTimer = useCallback(() => {}, []);

  const activeProactiveMessages = proactiveMessages.filter(m => !m.dismissed);

  return {
    proactiveMessages: activeProactiveMessages,
    dismissProactive,
    dismissAll,
    addDTUNotification,
    resetIdleTimer,
  };
}
