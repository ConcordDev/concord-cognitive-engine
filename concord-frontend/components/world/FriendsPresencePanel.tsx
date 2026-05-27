'use client';

/**
 * FriendsPresencePanel — Phase Meet-Up.
 *
 * Slide-out sidebar showing the user's friends, their current world,
 * and per-friend actions:
 *   - Join — travel to their world (calls /api/worlds/travel).
 *   - Invite — pull them to your world (POST /api/worlds/invites).
 *   - Add — send a friend request to a new user-id (input field).
 *
 * Refreshes presence every 8s while open. Hides the panel completely
 * when the user has no friends + no pending requests (zero-state nudge).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Send, X, Globe, ChevronRight, AlertCircle, Check, Mail } from 'lucide-react';
import { useWorldTravel, ACTIVE_WORLD_KEY } from '@/hooks/useWorldTravel';

interface FriendPresence {
  friendUserId: string;
  friendshipId: string;
  displayName: string;
  online: boolean;
  worldId?: string | null;
  cityId?: string | null;
  since?: number;
}

interface IncomingRequest {
  id: string;
  fromUser: string;
  fromDisplayName: string;
  created_at: number;
}

interface FriendsPresencePanelProps {
  /** Current world the local player is in — drives "Invite to my world" button. */
  myWorldId: string;
}

export function FriendsPresencePanel({ myWorldId }: FriendsPresencePanelProps) {
  const [open, setOpen] = useState(false);
  const [presence, setPresence] = useState<FriendPresence[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [addInput, setAddInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const travelHook = useWorldTravel();

  const refresh = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        fetch('/api/friends/presence', { credentials: 'include' }).then((x) => x.json()).catch(() => null),
        fetch('/api/friends/requests', { credentials: 'include' }).then((x) => x.json()).catch(() => null),
      ]);
      if (p?.ok) setPresence(p.presence || []);
      if (r?.ok) setIncoming(r.incoming || []);
    } catch { /* network blip */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(refresh, 8_000);
    return () => clearInterval(id);
  }, [open, refresh]);

  // Realtime push — incoming friend-request socket events drive a re-fetch.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('friend:request-received', handler);
    window.addEventListener('friend:request-accepted', handler);
    window.addEventListener('world:invite-received', handler);
    return () => {
      window.removeEventListener('friend:request-received', handler);
      window.removeEventListener('friend:request-accepted', handler);
      window.removeEventListener('world:invite-received', handler);
    };
  }, [refresh]);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  // Actions —

  const handleAddFriend = useCallback(async () => {
    const target = addInput.trim();
    if (!target) return;
    setBusy('add');
    try {
      const r = await fetch('/api/friends/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toUserId: target }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', j.status === 'accepted' ? 'Already friends.' : 'Friend request sent.');
        setAddInput('');
        refresh();
      } else {
        showFlash('err', j.error || 'request failed');
      }
    } finally { setBusy(null); }
  }, [addInput, refresh, showFlash]);

  const handleAccept = useCallback(async (requestId: string) => {
    setBusy(`accept-${requestId}`);
    try {
      const r = await fetch(`/api/friends/${requestId}/accept`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j.ok) { showFlash('ok', 'Friend added.'); refresh(); }
      else showFlash('err', j.error || 'accept failed');
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleDecline = useCallback(async (requestId: string) => {
    setBusy(`decline-${requestId}`);
    try {
      const r = await fetch(`/api/friends/${requestId}/decline`, { method: 'POST', credentials: 'include' });
      if ((await r.json()).ok) refresh();
    } finally { setBusy(null); }
  }, [refresh]);

  const handleJoinFriend = useCallback(async (friend: FriendPresence) => {
    if (!friend.worldId) return;
    setBusy(`join-${friend.friendUserId}`);
    try {
      await travelHook.travel(friend.worldId);
      showFlash('ok', `Travelling to ${friend.displayName}'s world…`);
      setOpen(false);
    } catch (e) {
      showFlash('err', (e as Error)?.message ?? 'travel failed');
    } finally { setBusy(null); }
  }, [travelHook, showFlash]);

  const handleInviteToMyWorld = useCallback(async (friend: FriendPresence) => {
    if (!myWorldId) { showFlash('err', 'enter a world first'); return; }
    setBusy(`invite-${friend.friendUserId}`);
    try {
      const r = await fetch('/api/worlds/invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toUserId: friend.friendUserId,
          worldId: myWorldId,
          worldName: myWorldId.replace(/-/g, ' '),
        }),
      });
      const j = await r.json();
      if (j.ok) showFlash('ok', `Invited ${friend.displayName} to your world.`);
      else showFlash('err', j.error || 'invite failed');
    } finally { setBusy(null); }
  }, [myWorldId, showFlash]);

  const totalPending = incoming.length;
  const onlineCount = useMemo(() => presence.filter((p) => p.online).length, [presence]);
  const hasAny = presence.length > 0 || incoming.length > 0;

  return (
    <>
      {/* Trigger button — bottom-right corner, with badge */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Friends (${onlineCount} online${totalPending > 0 ? `, ${totalPending} pending requests` : ''})`}
        className={`fixed bottom-2 right-2 z-30 flex items-center gap-2 rounded-full border border-cyan-500/40 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-cyan-200 shadow-lg backdrop-blur transition hover:bg-slate-900/80 ${open ? 'ring-2 ring-cyan-400/40' : ''}`}
      >
        <Users className="h-3.5 w-3.5" />
        <span>{onlineCount}</span>
        {totalPending > 0 && (
          <span className="ml-1 rounded-full bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
            {totalPending}
          </span>
        )}
      </button>

      {/* Slide-out panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Friends and presence"
          className="fixed bottom-12 right-2 z-30 flex max-h-[70vh] w-[340px] flex-col rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur"
        >
          <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
              <Users className="h-4 w-4" /> Friends
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Close friends panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          {flash && (
            <div className={`mx-3 mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {flash.msg}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-3 py-2 text-[12px]">
            {/* Incoming requests */}
            {incoming.length > 0 && (
              <div className="mb-3">
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                  Pending requests
                </h3>
                {incoming.map((r) => (
                  <div
                    key={r.id}
                    className="mb-1.5 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5"
                  >
                    <span className="truncate text-amber-100">{r.fromDisplayName}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleAccept(r.id)}
                        disabled={busy === `accept-${r.id}`}
                        className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecline(r.id)}
                        disabled={busy === `decline-${r.id}`}
                        className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/30 disabled:opacity-40"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Friends list */}
            {presence.length > 0 && (
              <div className="mb-3">
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                  {onlineCount} online · {presence.length} total
                </h3>
                {presence
                  .slice()
                  .sort((a, b) => Number(b.online) - Number(a.online))
                  .map((f) => (
                    <div
                      key={f.friendUserId}
                      className={`mb-1.5 rounded-md border px-2 py-1.5 ${f.online ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-slate-700 bg-slate-900/40 opacity-60'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${f.online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                          <span className="truncate text-cyan-100">{f.displayName}</span>
                        </div>
                        {f.online && f.worldId && (
                          <span className="ml-2 flex items-center gap-1 truncate text-[10px] text-cyan-300">
                            <Globe className="h-3 w-3" />
                            {f.worldId.replace(/-/g, ' ')}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {f.online && f.worldId && f.worldId !== myWorldId && (
                          <button
                            type="button"
                            onClick={() => handleJoinFriend(f)}
                            disabled={busy === `join-${f.friendUserId}`}
                            className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                          >
                            <ChevronRight className="h-3 w-3" />
                            Join {f.worldId.replace(/-/g, ' ')}
                          </button>
                        )}
                        {f.online && myWorldId && (
                          <button
                            type="button"
                            onClick={() => handleInviteToMyWorld(f)}
                            disabled={busy === `invite-${f.friendUserId}`}
                            className="flex items-center gap-1 rounded bg-fuchsia-500/20 px-2 py-0.5 text-[10px] text-fuchsia-200 hover:bg-fuchsia-500/30 disabled:opacity-40"
                          >
                            <Send className="h-3 w-3" />
                            Invite here
                          </button>
                        )}
                        {/* Mail works whether the friend is online or offline. */}
                        <a
                          href={`/lenses/mail?to=${encodeURIComponent(f.friendUserId)}`}
                          className="flex items-center gap-1 rounded bg-slate-700/40 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-600/40"
                        >
                          <Mail className="h-3 w-3" />
                          Mail
                        </a>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Zero-state */}
            {!hasAny && (
              <p className="mb-3 px-1 text-[11px] text-slate-400">
                No friends yet. Add by user id below — when they accept, you can see what world they\'re in and join them.
              </p>
            )}

            {/* Add by id */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddFriend();
              }}
              className="mt-2 flex gap-1"
            >
              <input
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                placeholder="user-id or username"
                aria-label="Add friend by user id"
                className="flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100 placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!addInput.trim() || busy === 'add'}
                className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
              >
                <UserPlus className="h-3 w-3" />
                Add
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
