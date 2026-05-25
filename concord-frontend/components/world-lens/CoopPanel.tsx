'use client';

/**
 * CoopPanel
 *
 * Three-tab UI for the cooperative mechanics backed by /api/coop/*:
 *   • Party  — see members, invite, leave
 *   • Stash  — view shared inventory, deposit / withdraw, leader can change permissions
 *   • Raid   — start a raid, contribute progress, see live progress bar
 *
 * Mounted from the world page when showPanel === 'party'.
 */

import { useEffect, useState, useCallback } from 'react';

interface PartyMember { userId: string; name: string; isLeader: boolean }
interface StashItem { id: string; name: string; kind: string; depositedBy: string; ts: number }
interface Raid { raidId: string; target: string; threshold: number; progress: number; state: string; contributors: { userId: string; amount: number }[] }

interface CoopPanelProps {
  partyId?: string;
  userId: string;
  isLeader?: boolean;
  onClose?: () => void;
  onPartyCreated?: (partyId: string) => void;
}

const TAB = (active: boolean) =>
  `px-3 py-1.5 text-xs rounded ${active ? 'bg-violet-600 text-white' : 'bg-black/40 text-gray-400 hover:text-white'}`;

const PANEL = 'rounded-lg border border-violet-500/30 bg-black/85 backdrop-blur-sm';

export default function CoopPanel({ partyId: partyIdProp, userId, isLeader = false, onClose, onPartyCreated }: CoopPanelProps) {
  const [resolvedPartyId, setResolvedPartyId] = useState<string | undefined>(partyIdProp);
  const [creating, setCreating] = useState(false);
  const [partyName, setPartyName] = useState('');
  const partyId = resolvedPartyId;

  // If no partyId was provided, ask the server if the user is already in a
  // party — they might have rejoined after a logout.
  useEffect(() => {
    if (resolvedPartyId) return;
    fetch('/api/parties/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const id = d?.party?.id ?? d?.id;
        if (id) setResolvedPartyId(id);
      })
      .catch(() => { /* silent */ });
  }, [resolvedPartyId]);

  const createParty = useCallback(async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/parties/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: partyName || 'My Party' }),
      });
      const data = await r.json();
      const id = data?.party?.id ?? data?.id;
      if (id) {
        setResolvedPartyId(id);
        onPartyCreated?.(id);
      }
    } finally {
      setCreating(false);
    }
  }, [partyName, onPartyCreated]);

  const [tab, setTab] = useState<'party' | 'stash' | 'raid'>('party');
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [stash, setStash] = useState<StashItem[]>([]);
  const [stashPerm, setStashPerm] = useState<'open' | 'leader_only' | 'vote'>('open');
  const [activeRaid, setActiveRaid] = useState<Raid | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [raidTarget, setRaidTarget] = useState('Frontier: Anomaly Surge');

  const refresh = useCallback(async () => {
    if (!partyId) return;
    Promise.all([
      fetch(`/api/parties/${encodeURIComponent(partyId)}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch(`/api/coop/stash/${encodeURIComponent(partyId)}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch(`/api/coop/raids?partyId=${encodeURIComponent(partyId)}&state=active`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([p, s, r]) => {
      setMembers((p?.members ?? p?.party?.members ?? []) as PartyMember[]);
      setStash((s?.stash?.items ?? []) as StashItem[]);
      setStashPerm((s?.stash?.permission ?? 'open') as typeof stashPerm);
      setActiveRaid((r?.raids ?? [])[0] as Raid ?? null);
    });
  }, [partyId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live updates via party-room socket events.
  useEffect(() => {
    if (!partyId) return;
    type SocketLike = {
      on: (e: string, h: (p: unknown) => void) => void;
      off: (e: string, h: (p: unknown) => void) => void;
      disconnect?: () => void;
    };
    let socket: SocketLike | null = null;
    let mounted = true;
    (async () => {
      try {
        const { io } = await import('socket.io-client');
        if (!mounted) return;
        socket = io('/', { withCredentials: true, transports: ['websocket', 'polling'] }) as unknown as SocketLike;
        const refreshOnEvent = () => { void refresh(); };
        socket?.on('coop:stash:withdraw', refreshOnEvent);
        socket?.on('coop:raid:progress', (payload: unknown) => setActiveRaid(payload as Raid));
        socket?.on('coop:raid:completed', (payload: unknown) => {
          setActiveRaid(payload as Raid);
          setTimeout(() => refresh(), 1500);
        });
      } catch { /* socket optional */ }
    })();
    return () => { mounted = false; try { socket?.disconnect?.(); } catch { /* ok */ } };
  }, [partyId, refresh]);

  const invite = useCallback(async () => {
    if (!partyId || !inviteName) return;
    await fetch(`/api/parties/${encodeURIComponent(partyId)}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ targetUsername: inviteName }),
    }).catch(() => { /* invite silent */ });
    setInviteName('');
    refresh();
  }, [partyId, inviteName, refresh]);

  const leaveParty = useCallback(async () => {
    if (!partyId) return;
    await fetch(`/api/parties/${encodeURIComponent(partyId)}/leave`, { method: 'POST', credentials: 'include' }).catch(() => { /* silent */ });
    refresh();
  }, [partyId, refresh]);

  const withdraw = useCallback(async (itemId: string) => {
    if (!partyId) return;
    await fetch('/api/coop/stash/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ partyId, itemId, isLeader }),
    }).catch(() => { /* silent */ });
    refresh();
  }, [partyId, isLeader, refresh]);

  const setPermission = useCallback(async (perm: typeof stashPerm) => {
    if (!partyId || !isLeader) return;
    await fetch('/api/coop/stash/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ partyId, isLeader: true, permission: perm }),
    }).catch(() => { /* silent */ });
    refresh();
  }, [partyId, isLeader, refresh]);

  const startRaid = useCallback(async () => {
    if (!partyId) return;
    await fetch('/api/coop/raid/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ partyId, target: raidTarget, threshold: 100, worlds: ['concordia'] }),
    }).catch(() => { /* silent */ });
    refresh();
  }, [partyId, raidTarget, refresh]);

  const contribute = useCallback(async () => {
    if (!activeRaid) return;
    await fetch('/api/coop/raid/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ raidId: activeRaid.raidId, worldId: 'concordia', amount: 5 }),
    }).catch(() => { /* silent */ });
  }, [activeRaid]);

  if (!partyId) {
    return (
      <div className={`${PANEL} p-4 max-w-md`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-violet-300 font-semibold">Cooperative</h3>
          {onClose && <button onClick={onClose} className="text-gray-400 text-sm">close</button>}
        </div>
        <p className="text-gray-400 text-sm mb-3">
          Form a party to unlock coop build sites, a shared stash, and cross-world raids.
        </p>
        <div className="flex gap-2">
          <input
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            placeholder="Party name"
            className="flex-1 bg-black/60 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200"
          />
          <button
            type="button"
            onClick={createParty}
            disabled={creating}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm"
          >
            {creating ? 'Creating…' : 'Create Party'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${PANEL} p-4 max-w-md w-full`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-violet-300 font-semibold">Cooperative</h3>
        {onClose && <button onClick={onClose} className="text-gray-400 text-sm">close</button>}
      </div>

      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setTab('party')} className={TAB(tab === 'party')}>Party</button>
        <button type="button" onClick={() => setTab('stash')} className={TAB(tab === 'stash')}>Stash</button>
        <button type="button" onClick={() => setTab('raid')}  className={TAB(tab === 'raid')}>Raid</button>
      </div>

      {tab === 'party' && (
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Members ({members.length})</div>
          {members.length === 0 ? (
            <div className="text-gray-400 italic text-sm">No members yet.</div>
          ) : (
            <ul className="space-y-1 mb-3">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-200">{m.name || m.userId}</span>
                  {m.isLeader && <span className="text-[9px] uppercase tracking-wider bg-amber-700/50 text-amber-200 px-1.5 rounded">Leader</span>}
                  {m.userId === userId && <span className="text-[9px] uppercase tracking-wider bg-cyan-700/50 text-cyan-200 px-1.5 rounded">You</span>}
                </li>
              ))}
            </ul>
          )}
          {isLeader && (
            <div className="flex gap-2 mb-3">
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Username"
                className="flex-1 bg-black/60 border border-white/10 rounded px-2 py-1 text-sm"
              />
              <button onClick={invite} className="px-3 py-1 bg-violet-600 hover:bg-violet-500 rounded text-white text-xs">invite</button>
            </div>
          )}
          <button onClick={leaveParty} className="text-xs text-rose-400 hover:text-rose-300">Leave party</button>
        </div>
      )}

      {tab === 'stash' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400 uppercase tracking-wider">Shared stash</div>
            {isLeader && (
              <select
                value={stashPerm}
                onChange={(e) => setPermission(e.target.value as typeof stashPerm)}
                className="bg-black/60 border border-white/10 text-xs rounded px-1 py-0.5 text-gray-300"
              >
                <option value="open">open</option>
                <option value="leader_only">leader-only</option>
                <option value="vote">vote</option>
              </select>
            )}
          </div>
          {stash.length === 0 ? (
            <div className="text-gray-400 italic text-sm">Empty.</div>
          ) : (
            <ul className="space-y-1 max-h-[260px] overflow-y-auto">
              {stash.map((it) => (
                <li key={it.id} className="flex items-center gap-2 text-sm border-b border-white/5 py-1">
                  <span className="flex-1 truncate text-gray-200">{it.name}</span>
                  <span className="text-[9px] text-gray-400">{it.kind}</span>
                  <button
                    onClick={() => withdraw(it.id)}
                    className="text-[10px] bg-violet-700/40 hover:bg-violet-600/50 px-2 py-0.5 rounded text-violet-200"
                  >
                    withdraw
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'raid' && (
        <div>
          {activeRaid ? (
            <div>
              <div className="text-amber-200 font-medium mb-1">{activeRaid.target}</div>
              <div className="h-2 bg-stone-800 rounded overflow-hidden mb-2">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${Math.round((activeRaid.progress / activeRaid.threshold) * 100)}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mb-3">
                {activeRaid.progress} / {activeRaid.threshold} · {activeRaid.contributors?.length ?? 0} contributors · {activeRaid.state}
              </div>
              {activeRaid.state === 'active' && (
                <button
                  onClick={contribute}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-white text-xs"
                >
                  Contribute (+5)
                </button>
              )}
            </div>
          ) : isLeader ? (
            <div>
              <input
                value={raidTarget}
                onChange={(e) => setRaidTarget(e.target.value)}
                placeholder="Raid target"
                className="w-full mb-2 bg-black/60 border border-white/10 rounded px-2 py-1 text-sm"
              />
              <button onClick={startRaid} className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-white text-xs">
                Start raid
              </button>
            </div>
          ) : (
            <div className="text-gray-400 italic text-sm">No active raid. Leader can start one.</div>
          )}
        </div>
      )}
    </div>
  );
}
