'use client';

// Phase DB2 — Brawl invite toast + active brawl HUD.
//
// Two surfaces wired to /api/combat/brawl/*:
//   - BrawlInviteToast: bottom-right toast when receiving an invite
//     (real-time event from server: 'concordia:brawl-invited').
//   - BrawlActiveHUD: top-center banner while in an active brawl
//     (polls /api/combat/brawl/invites and getBrawlOpponent).
//
// Invite send happens via the NPC menu (DA1).

import { useCallback, useEffect, useState } from 'react';
import { Swords, X, Check } from 'lucide-react';
import { sfx, juice } from '@/lib/concordia/juice';

interface BrawlInvite {
  inviteId: string;
  fromUserId: string;
  fromUserName?: string;
  receivedAt: number;
}

const INVITE_TTL_MS = 60_000;

export function BrawlInviteToast() {
  const [invites, setInvites] = useState<BrawlInvite[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  // Listen for real-time brawl-invited socket events.
  useEffect(() => {
    function onInvite(e: Event) {
      const detail = (e as CustomEvent<{ inviteId: string; from: string; fromUserName?: string }>).detail;
      if (!detail) return;
      setInvites((prev) => [
        ...prev.filter((x) => x.inviteId !== detail.inviteId),
        {
          inviteId: detail.inviteId,
          fromUserId: detail.from,
          fromUserName: detail.fromUserName,
          receivedAt: Date.now(),
        },
      ]);
      sfx('ui_brawl_invite');
      juice('discovery');
    }
    window.addEventListener('concordia:brawl-invited', onInvite);
    return () => window.removeEventListener('concordia:brawl-invited', onInvite);
  }, []);

  // Periodically prune expired invites.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setInvites((prev) => prev.filter((x) => now - x.receivedAt < INVITE_TTL_MS));
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const accept = useCallback(async (inviteId: string) => {
    try {
      const r = await fetch('/api/combat/brawl/accept', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      const j = await r.json();
      setInvites((prev) => prev.filter((x) => x.inviteId !== inviteId));
      if (j?.ok) {
        sfx('ui_brawl_accept');
        juice('milestone');
      }
      setFlash(j?.ok ? 'Brawl started — sifu_brawler profile' : (j?.error || 'accept failed'));
      setTimeout(() => setFlash(null), 3000);
    } catch { setFlash('network error'); setTimeout(() => setFlash(null), 3000); }
  }, []);

  const decline = useCallback(async (inviteId: string) => {
    try {
      await fetch('/api/combat/brawl/decline', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
    } catch { /* swallow */ }
    setInvites((prev) => prev.filter((x) => x.inviteId !== inviteId));
  }, []);

  return (
    <>
      <div className="pointer-events-auto fixed bottom-32 right-4 z-30 space-y-2">
        {invites.map((inv) => (
          <div key={inv.inviteId} className="concordia-toast w-72 rounded-lg border border-rose-500/40 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
            <header className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-200">
              <Swords size={14} />
              Brawl challenge
            </header>
            <p className="mb-2 text-[12px] text-zinc-200">
              {inv.fromUserName || inv.fromUserId} wants to brawl.
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => accept(inv.inviteId)}
                className="flex-1 rounded bg-rose-500/30 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-500/40"
              >
                <Check className="inline h-3 w-3 mr-1" /> Accept
              </button>
              <button
                onClick={() => decline(inv.inviteId)}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
              >
                <X className="inline h-3 w-3 mr-1" /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
      {flash && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-md border border-rose-500/40 bg-zinc-950/95 px-3 py-1.5 text-xs text-rose-200 shadow-lg backdrop-blur">
          {flash}
        </div>
      )}
      <style jsx global>{`
        @keyframes concordiaToastIn {
          0% { opacity: 0; transform: translateX(20px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        .concordia-toast {
          animation: concordiaToastIn 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </>
  );
}

interface ActiveBrawl {
  opponent: string;
  startedAt: number;
}

const POLL_MS = 5000;

export function BrawlActiveHUD() {
  const [active, setActive] = useState<ActiveBrawl | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/combat/brawl/invites', { credentials: 'include' });
      const j = await r.json();
      // The /invites endpoint returns OPEN invites; we use a side
      // dispatch from the accept call to populate active state.
      if (!j?.ok) return;
    } catch { /* swallow */ }
  }, []);

  // Listen for the accept-side success event.
  useEffect(() => {
    function onBrawlStart(e: Event) {
      const detail = (e as CustomEvent<{ opponent: string }>).detail;
      if (!detail) return;
      setActive({ opponent: detail.opponent, startedAt: Date.now() });
    }
    function onBrawlEnd() { setActive(null); }
    window.addEventListener('concordia:brawl-started', onBrawlStart);
    window.addEventListener('concordia:brawl-ended', onBrawlEnd);
    return () => {
      window.removeEventListener('concordia:brawl-started', onBrawlStart);
      window.removeEventListener('concordia:brawl-ended', onBrawlEnd);
    };
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (!active) return null;

  const endBrawl = async () => {
    try {
      await fetch('/api/combat/brawl/end', { method: 'POST', credentials: 'include' });
    } catch { /* swallow */ }
    setActive(null);
    window.dispatchEvent(new CustomEvent('concordia:brawl-ended'));
  };

  return (
    <div className="pointer-events-auto fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-rose-500/50 bg-rose-500/15 px-4 py-1.5 text-sm text-rose-100 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2">
        <Swords size={14} />
        <span className="font-medium">Brawl: vs {active.opponent}</span>
        <span className="text-[10px] text-rose-300/70">· sifu_brawler · fist only</span>
        <button onClick={endBrawl} className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 text-[10px] hover:bg-rose-500/50">End</button>
      </div>
    </div>
  );
}
