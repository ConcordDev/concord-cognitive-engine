'use client';

// DET-C dead-event fix — server/routes/wagers.js emits 'wager:proposed' /
// 'wager:accepted' / 'wager:declined' / 'wager:resolved' (real, real-money-
// affecting realtimeEmit calls — see the 3rd-arg targeting fix made
// alongside this component) but NOTHING on the frontend ever subscribed to
// them. WagerModal (components/concordia/economy/WagerModal.tsx) could
// PROPOSE a wager, but the opponent had no way to ever find out — and
// IncomingWagerPrompt, the exact component built for that job, was never
// mounted anywhere. This component is the minimal honest consumer: it
// listens for the bridged window events (see hooks/useSocket.ts's
// `concordia:wager-*` rename branch) and surfaces IncomingWagerPrompt for
// an incoming challenge, plus a small outcome toast for the proposer/
// opponent when the other side accepts/declines/resolves.
//
// Pattern mirrors BrawlInviteToast (components/world/BrawlInviteToast.tsx):
// optimistic window-event insert + a slow REST backstop poll so a missed
// socket message or reconnect gap still self-heals within one poll.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useAuth } from '@/hooks/useAuth';
import { IncomingWagerPrompt } from '@/components/concordia/economy/WagerModal';

interface IncomingWager {
  wagerId: string;
  proposerId: string;
  amount: number;
  currency: 'sparks' | 'cc';
  duelType: string;
  expiresAt: number;
}

// Same-order-of-magnitude poll as BrawlInviteToast's brawlInviteMs default —
// not wired to useClientConfig() to keep this fix's file surface disjoint
// from client-config.js; a future pass can promote it to a real server dial
// if wagers warrant their own cadence.
const BACKSTOP_POLL_MS = 5000;
const OUTCOME_FLASH_MS = 4000;

export function WagerInviteToast() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<IncomingWager[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), OUTCOME_FLASH_MS);
  }, []);

  // REST backstop — folds in any still-pending wagers where I'm the
  // opponent that the socket push might have missed (dropped message,
  // reconnect race). Additive-only, same discipline as BrawlInviteToast.
  const refreshFromServer = useCallback(async () => {
    if (!user?.id) return;
    try {
      const r = await fetch('/api/wagers', { credentials: 'include' });
      const j = await r.json();
      if (!j?.ok || !Array.isArray(j.wagers)) return;
      setIncoming((prev) => {
        const known = new Set(prev.map((w) => w.wagerId));
        const additions: IncomingWager[] = j.wagers
          .filter((w: { id?: string; status?: string; opponent_id?: string }) =>
            w?.id && !known.has(w.id) && w.status === 'pending' && w.opponent_id === user.id)
          .map((w: { id: string; proposer_id: string; amount: number; currency: 'sparks' | 'cc'; duel_type: string; expires_at: number }) => ({
            wagerId: w.id,
            proposerId: w.proposer_id,
            amount: w.amount,
            currency: w.currency,
            duelType: w.duel_type,
            expiresAt: w.expires_at * 1000,
          }));
        return additions.length ? [...prev, ...additions] : prev;
      });
    } catch { /* backstop is best-effort */ }
  }, [user?.id]);
  useRealtimeRefresh(['wager:proposed'], refreshFromServer, { backstopMs: BACKSTOP_POLL_MS });

  // Real-time incoming challenge.
  useEffect(() => {
    function onProposed(e: Event) {
      const detail = (e as CustomEvent<IncomingWager>).detail;
      if (!detail?.wagerId) return;
      setIncoming((prev) => [
        ...prev.filter((w) => w.wagerId !== detail.wagerId),
        detail,
      ]);
    }
    window.addEventListener('concordia:wager-proposed', onProposed);
    return () => window.removeEventListener('concordia:wager-proposed', onProposed);
  }, []);

  // Outcome notifications for the proposer (accepted/declined) and both
  // participants (resolved).
  useEffect(() => {
    function onAccepted() { showFlash('Your wager was accepted!'); }
    function onDeclined() { showFlash('Your wager was declined.'); }
    function onResolved(e: Event) {
      const detail = (e as CustomEvent<{ winnerId?: string; payout?: number; currency?: string }>).detail;
      if (!detail) return;
      const won = user?.id && detail.winnerId === user.id;
      showFlash(won
        ? `You won the wager — +${detail.payout} ${detail.currency === 'cc' ? '💎' : '⚡'}`
        : `The wager resolved — ${detail.payout} ${detail.currency === 'cc' ? '💎' : '⚡'} to your opponent`);
    }
    window.addEventListener('concordia:wager-accepted', onAccepted);
    window.addEventListener('concordia:wager-declined', onDeclined);
    window.addEventListener('concordia:wager-resolved', onResolved);
    return () => {
      window.removeEventListener('concordia:wager-accepted', onAccepted);
      window.removeEventListener('concordia:wager-declined', onDeclined);
      window.removeEventListener('concordia:wager-resolved', onResolved);
    };
  }, [user?.id, showFlash]);

  // Prune expired incoming challenges (accept window closed server-side).
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setIncoming((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.filter((w) => w.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const dismiss = useCallback((wagerId: string) => {
    setIncoming((prev) => prev.filter((w) => w.wagerId !== wagerId));
  }, []);

  return (
    <>
      {/* IncomingWagerPrompt is itself `position: fixed` (own bottom/right
       * offset via stackIndex) — no wrapping fixed container here, that
       * would double-position it. */}
      {incoming.map((w, i) => (
        <IncomingWagerPrompt
          key={w.wagerId}
          wagerId={w.wagerId}
          proposerName={w.proposerId}
          amount={w.amount}
          currency={w.currency}
          duelType={w.duelType}
          expiresAt={w.expiresAt}
          stackIndex={i}
          onAccept={() => dismiss(w.wagerId)}
          onDecline={() => dismiss(w.wagerId)}
        />
      ))}
      {flash && (
        <div className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-md border border-amber-500/40 bg-zinc-950/95 px-3 py-1.5 text-xs text-amber-200 shadow-lg backdrop-blur">
          {flash}
        </div>
      )}
    </>
  );
}

export default WagerInviteToast;
