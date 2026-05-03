'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * PlayerActionMenu — context menu that pops at the cursor when the player
 * clicks another player's avatar mesh in the world.
 *
 * Listens for `concordia:click-player` window events with detail
 * { playerId, playerName, screenX, screenY }. Closes on outside click or Esc.
 *
 * Actions:
 *   - Wave        → broadcasts a wave emote at the local player
 *   - Trade       → POST /api/player-trade/initiate (recipient sees TradeWindow)
 *   - Inspect     → dispatches concordia:inspect-player so the world page can
 *                   open an inspector panel (delegated; no opinion here)
 *   - Invite Party→ POST /api/parties/invite if the user is in a party
 *
 * The action set is the same as SocialActionPanel exposes globally; the
 * difference is that the context menu lets the player target a *specific*
 * other player by clicking them directly, rather than picking from a list.
 */

interface MenuState {
  playerId: string;
  playerName: string;
  x: number;
  y: number;
}

export default function PlayerActionMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const close = useCallback(() => {
    setMenu(null);
    setBusy(null);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  // Open on click-player window event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { playerId?: string; playerName?: string; screenX?: number; screenY?: number }
        | undefined;
      if (!detail?.playerId) return;
      // Clamp to viewport so the menu doesn't appear off-screen on edge clicks
      const margin = 16;
      const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const h = typeof window !== 'undefined' ? window.innerHeight : 768;
      const x = Math.max(margin, Math.min(w - 220, detail.screenX ?? w / 2));
      const y = Math.max(margin, Math.min(h - 240, detail.screenY ?? h / 2));
      setMenu({
        playerId: detail.playerId,
        playerName: detail.playerName ?? detail.playerId.slice(0, 12),
        x,
        y,
      });
    };
    window.addEventListener('concordia:click-player', handler);
    return () => window.removeEventListener('concordia:click-player', handler);
  }, []);

  // Close on Esc or outside click (anywhere except the menu itself)
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-player-action-menu]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    // Defer the document listener so the click that opened us doesn't immediately close
    const t = setTimeout(() => document.addEventListener('click', onDoc), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.removeEventListener('click', onDoc);
    };
  }, [menu, close]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const wave = useCallback(() => {
    if (!menu) return;
    setBusy('wave');
    // Local emote — broadcast via the existing emote channel so other players
    // see us wave too (handled by world page wiring on the next move tick).
    window.dispatchEvent(new CustomEvent('concordia:emote', {
      detail: { emoteId: 'wave', targetPlayerId: menu.playerId },
    }));
    showToast(`You waved at ${menu.playerName}.`);
    close();
  }, [menu, close, showToast]);

  const trade = useCallback(async () => {
    if (!menu) return;
    setBusy('trade');
    try {
      const r = await fetch('/api/player-trade/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ recipientId: menu.playerId }),
      });
      const data = await r.json();
      if (data?.ok) {
        showToast(`Trade request sent to ${menu.playerName}.`);
      } else {
        showToast(data?.error?.replace(/_/g, ' ') ?? 'Trade request failed.');
      }
    } catch {
      showToast('Network error — trade not sent.');
    }
    close();
  }, [menu, close, showToast]);

  const inspect = useCallback(() => {
    if (!menu) return;
    setBusy('inspect');
    window.dispatchEvent(new CustomEvent('concordia:inspect-player', {
      detail: { playerId: menu.playerId, playerName: menu.playerName },
    }));
    close();
  }, [menu, close]);

  const inviteToParty = useCallback(async () => {
    if (!menu) return;
    setBusy('invite');
    try {
      // Need to know the player's current party id — fetch it lazily here
      // rather than maintain another piece of state.
      const me = await fetch('/api/parties/me', { credentials: 'same-origin' })
        .then((r) => r.json()).catch(() => null);
      const partyId = me?.party?.id;
      if (!partyId) {
        showToast('Create a party first (Social panel).');
        close();
        return;
      }
      const r = await fetch(`/api/parties/${partyId}/invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ inviteeId: menu.playerId }),
      });
      const data = await r.json();
      if (data?.ok) {
        showToast(`Party invite sent to ${menu.playerName}.`);
      } else {
        showToast(data?.error?.replace(/_/g, ' ') ?? 'Invite failed.');
      }
    } catch {
      showToast('Network error — invite not sent.');
    }
    close();
  }, [menu, close, showToast]);

  return (
    <>
      {menu && (
        <div
          data-player-action-menu
          className="fixed z-[70] bg-slate-950/95 border border-cyan-500/40 rounded-lg shadow-2xl backdrop-blur-md min-w-[200px] overflow-hidden"
          style={{
            left: menu.x,
            top: menu.y,
            boxShadow: '0 0 24px rgba(34,211,238,0.25), 0 8px 32px rgba(0,0,0,0.7)',
          }}
        >
          <div className="px-3 py-2 border-b border-cyan-500/20 text-xs uppercase tracking-wider text-cyan-300 font-semibold">
            {menu.playerName}
          </div>
          <button
            disabled={!!busy}
            onClick={wave}
            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-cyan-500/15 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <span>👋</span> Wave
          </button>
          <button
            disabled={!!busy}
            onClick={trade}
            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-cyan-500/15 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <span>🤝</span> Trade
          </button>
          <button
            disabled={!!busy}
            onClick={inspect}
            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-cyan-500/15 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <span>👁</span> Inspect
          </button>
          <button
            disabled={!!busy}
            onClick={inviteToParty}
            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-cyan-500/15 disabled:opacity-50 transition-colors flex items-center gap-2 border-t border-white/5"
          >
            <span>➕</span> Invite to Party
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[71] px-4 py-2 rounded-lg bg-cyan-900/90 text-cyan-100 text-sm border border-cyan-500/40 backdrop-blur-md">
          {toast}
        </div>
      )}
    </>
  );
}
