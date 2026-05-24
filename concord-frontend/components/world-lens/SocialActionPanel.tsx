'use client';

/**
 * SocialActionPanel — UX next-pass surface for trade initiation + party
 * creation/invites. Pinned bottom-right floating button → opens a panel.
 *
 * Receiver sides are already wired in SocialOverlay (trade:request opens
 * TradeWindow; party:invite shows toast). This panel is the *sender* side
 * that was the last open UX gap.
 *
 * Design: one panel with two sections — "Nearby players" (per-player Trade
 * + Invite-to-party buttons) and "My party" (Create party button if not in
 * one; member count + leave if in one — though PartyHUD already covers the
 * member view, this is the create-side affordance).
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, X } from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { usePipe } from '@/components/panel-polish';

interface NearbyPlayer {
  id: string;
  name: string;
}

interface SocialActionPanelProps {
  myUserId: string;
  nearbyPlayers: NearbyPlayer[];
}

export function SocialActionPanel({ myUserId, nearbyPlayers }: SocialActionPanelProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasParty, setHasParty] = useState<boolean | null>(null);
  const pipe = usePipe();

  const filteredPlayers = nearbyPlayers.filter((p) => p.id !== myUserId);

  // Refresh "do I have a party?" state when the panel opens or after an
  // action that might change it.
  const refreshPartyState = useCallback(async () => {
    try {
      const res = await fetch('/api/parties/me', { credentials: 'same-origin' });
      const json = await res.json();
      setHasParty(!!json?.party);
    } catch { /* network silent */ }
  }, []);

  useEffect(() => {
    if (open) refreshPartyState();
  }, [open, refreshPartyState]);

  const initiateTrade = useCallback(async (recipientId: string) => {
    const addToast = useUIStore.getState().addToast;
    setBusy(`trade:${recipientId}`);
    try {
      const res = await fetch('/api/player-trade/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ recipientId }),
      });
      const json = await res.json();
      if (!json?.ok) {
        addToast({
          type: 'error',
          message: json?.error || 'Trade request failed',
          duration: 4000,
        });
      } else {
        pipe.publish('world.tradeRequestSent', { recipientId }, { label: `trade → ${recipientId.slice(0, 8)}` });
        addToast({
          type: 'info',
          message: `Trade request sent — waiting for ${recipientId.slice(0, 8)} to accept`,
          duration: 5000,
        });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error', duration: 4000 });
    } finally {
      setBusy(null);
    }
  }, [pipe]);

  const createParty = useCallback(async () => {
    const addToast = useUIStore.getState().addToast;
    setBusy('create-party');
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: null, lootPolicy: 'free_for_all', maxSize: 8 }),
      });
      const json = await res.json();
      if (!json?.ok) {
        addToast({ type: 'error', message: json?.error || 'Could not create party', duration: 4000 });
      } else {
        pipe.publish('world.partyCreated', json?.party ?? { ok: true }, { label: 'party created' });
        addToast({ type: 'success', message: 'Party created — invite players from this panel', duration: 5000 });
        setHasParty(true);
      }
    } catch {
      addToast({ type: 'error', message: 'Network error', duration: 4000 });
    } finally {
      setBusy(null);
    }
  }, [pipe]);

  const inviteToParty = useCallback(async (invitedId: string) => {
    const addToast = useUIStore.getState().addToast;
    if (!hasParty) {
      addToast({ type: 'warning', message: 'Create a party first', duration: 3500 });
      return;
    }
    setBusy(`invite:${invitedId}`);
    try {
      const me = await fetch('/api/parties/me', { credentials: 'same-origin' });
      const meJson = await me.json();
      const partyId = meJson?.party?.id;
      if (!partyId) {
        addToast({ type: 'error', message: 'No active party', duration: 3500 });
        return;
      }
      const res = await fetch(`/api/parties/${encodeURIComponent(partyId)}/invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ invitedId }),
      });
      const json = await res.json();
      if (!json?.ok) {
        addToast({ type: 'error', message: json?.error || 'Invite failed', duration: 4000 });
      } else {
        pipe.publish('world.partyInviteSent', { partyId, invitedId }, { label: `invite → ${invitedId.slice(0, 8)}` });
        addToast({ type: 'info', message: `Invite sent to ${invitedId.slice(0, 8)}`, duration: 4000 });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error', duration: 4000 });
    } finally {
      setBusy(null);
    }
  }, [hasParty, pipe]);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-30 pointer-events-auto bg-cyan-600 hover:bg-cyan-500 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg"
        title={open ? 'Close social panel' : 'Open social panel'}
        aria-label="Social actions"
      >
        {open ? <X className="w-5 h-5" /> : <Users className="w-5 h-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-30 pointer-events-auto bg-gray-900/90 border border-gray-700 rounded p-4 w-72 max-h-[60vh] overflow-y-auto backdrop-blur-sm">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-cyan-300">My party</h3>
              {hasParty === false && (
                <button
                  onClick={createParty}
                  disabled={busy === 'create-party'}
                  className="text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/40 border border-cyan-500/40 disabled:opacity-50"
                >
                  {busy === 'create-party' ? '…' : 'Create'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-400">
              {hasParty === null && 'Loading…'}
              {hasParty === true && 'Active — see HUD bottom-left. Invite below.'}
              {hasParty === false && 'No active party. Create one to start inviting.'}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-cyan-300 mb-2">Nearby players</h3>
            {filteredPlayers.length === 0 && (
              <p className="text-xs text-gray-400 italic">No other players in range</p>
            )}
            <ul className="space-y-1.5">
              {filteredPlayers.map((p) => (
                <li
                  key={p.id}
                  className="flex justify-between items-center text-xs bg-gray-800/60 rounded px-2 py-1.5"
                >
                  <span className="text-gray-200 truncate flex-1">{p.name || p.id.slice(0, 8)}</span>
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={() => initiateTrade(p.id)}
                      disabled={busy === `trade:${p.id}`}
                      className="text-[10px] px-2 py-0.5 rounded bg-yellow-600/30 text-yellow-200 hover:bg-yellow-600/50 border border-yellow-500/40 disabled:opacity-50"
                      title="Send trade request"
                    >
                      {busy === `trade:${p.id}` ? '…' : 'Trade'}
                    </button>
                    <button
                      onClick={() => inviteToParty(p.id)}
                      disabled={busy === `invite:${p.id}` || hasParty === false}
                      className="text-[10px] px-2 py-0.5 rounded bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 border border-purple-500/40 disabled:opacity-50"
                      title={hasParty === false ? 'Create a party first' : 'Invite to party'}
                    >
                      {busy === `invite:${p.id}` ? '…' : 'Invite'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
