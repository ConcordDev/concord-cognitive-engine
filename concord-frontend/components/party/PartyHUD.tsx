'use client';

/**
 * Party HUD — Phase 9 of polish-to-ten.
 *
 * Shows current party members, leader badge, leave button. Subscribes to
 * party:member_joined, party:member_left, party:leader_changed,
 * party:chat for live updates. Refetches /api/parties/me on those events
 * since member detail (name, role) lives server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

interface PartyMember {
  user_id: string;
  role: 'leader' | 'member';
  joined_at: number;
}

interface Party {
  id: string;
  leader_id: string;
  name: string | null;
  max_size: number;
  loot_policy: string;
  members: PartyMember[];
  role: 'leader' | 'member';
}

export function PartyHUD({ myUserId }: { myUserId: string }) {
  const [party, setParty] = useState<Party | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/parties/me');
      const json = await res.json();
      if (json.ok) setParty(json.party);
    } catch { /* network errors leave party state stale */ }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  useEffect(() => {
    const addToast = useUIStore.getState().addToast;
    const offJoin = subscribe<{ partyId: string; userId: string }>('party:member_joined', () => {
      fetchMe();
      addToast({ type: 'info', message: 'A new member joined the party', duration: 4000 });
    });
    const offLeft = subscribe<{ partyId: string; userId: string; kicked?: boolean }>('party:member_left', (msg) => {
      fetchMe();
      addToast({ type: 'info', message: msg.kicked ? 'A member was removed from the party' : 'A member left the party', duration: 4000 });
    });
    const offLead = subscribe<{ partyId: string; newLeaderId: string }>('party:leader_changed', (msg) => {
      fetchMe();
      addToast({
        type: 'info',
        message: msg.newLeaderId === myUserId ? 'You are now the party leader' : 'The party has a new leader',
        duration: 5000,
      });
    });
    const offKick = subscribe<{ partyId: string; by: string }>('party:kicked', () => {
      setParty(null);
      addToast({ type: 'warning', message: 'You were removed from the party', duration: 6000 });
    });
    return () => { offJoin(); offLeft(); offLead(); offKick(); };
  }, [fetchMe, myUserId]);

  const handleLeave = useCallback(async () => {
    if (!party) return;
    await fetch(`/api/parties/${party.id}/leave`, { method: 'POST' });
    setParty(null);
  }, [party]);

  if (!party) return null;

  return (
    <div className="bg-gray-900/80 border border-gray-700 rounded p-3 w-64 text-sm" data-testid="party-hud">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-cyan-300">{party.name || 'Party'}</h3>
        <span className="text-[10px] text-gray-500">{party.members.length}/{party.max_size}</span>
      </div>
      <ul className="space-y-1 mb-2">
        {party.members.map((m) => (
          <li key={m.user_id} className="flex justify-between text-xs">
            <span className={m.user_id === myUserId ? 'text-white' : 'text-gray-300'}>
              {m.user_id.slice(0, 8)}
              {m.user_id === myUserId && ' (you)'}
            </span>
            {m.role === 'leader' && <span className="text-yellow-400">★</span>}
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-gray-500 mb-2">
        Loot: <span className="text-gray-300">{party.loot_policy.replace(/_/g, ' ')}</span>
      </div>
      <button
        onClick={handleLeave}
        className="w-full px-2 py-1 rounded bg-red-900/30 text-red-300 hover:bg-red-900/50 text-xs"
      >
        Leave party
      </button>
    </div>
  );
}
