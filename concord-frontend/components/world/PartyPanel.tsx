'use client';

/**
 * PartyPanel — Phase U5.
 *
 * Slide-out panel similar shape to FriendsPresencePanel. Bottom-right
 * corner trigger. Shows current party + members + leader controls.
 * Pending invites surface inline with Accept / Decline.
 *
 * Mounted in /lenses/world next to the friends panel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Users2, X, Crown, UserMinus, LogOut, ShieldOff, Send, AlertCircle, Check } from 'lucide-react';

interface PartyMember { userId: string; role: 'leader' | 'member'; joinedAt: number; }
interface PartyInfo {
  party_id: string;
  myRole: 'leader' | 'member';
  name: string;
  leaderId: string;
  maxSize: number;
  partyType: 'normal' | 'raid';
  privacy: string;
  members: PartyMember[];
}
interface IncomingInvite {
  id: string;
  partyId: string;
  fromUser: string;
  partyName: string;
  partyType: 'normal' | 'raid';
  createdAt: number;
}

export function PartyPanel() {
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<PartyInfo | null>(null);
  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [createForm, setCreateForm] = useState({ name: '', partyType: 'normal' as 'normal' | 'raid' });
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/parties/me', { credentials: 'include' }).then((x) => x.json());
      if (r?.ok) {
        setParty(r.party);
        setInvites(r.incomingInvites || []);
      }
    } catch { /* network blip */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [open, refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    for (const ev of ['party:invite-received', 'party:member-joined', 'party:member-left', 'party:disbanded', 'lfg:matched']) {
      window.addEventListener(ev, handler);
    }
    return () => {
      for (const ev of ['party:invite-received', 'party:member-joined', 'party:member-left', 'party:disbanded', 'lfg:matched']) {
        window.removeEventListener(ev, handler);
      }
    };
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!createForm.name.trim()) return;
    setBusy('create');
    try {
      const r = await fetch('/api/parties', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const j = await r.json();
      if (j.ok) { showFlash('ok', 'Party created.'); refresh(); }
      else showFlash('err', j.error || 'create failed');
    } finally { setBusy(null); }
  }, [createForm, refresh, showFlash]);

  const handleAccept = useCallback(async (inviteId: string) => {
    setBusy(`accept-${inviteId}`);
    try {
      const r = await fetch(`/api/parties/invites/${inviteId}/accept`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j.ok) { showFlash('ok', 'Joined party.'); refresh(); }
      else showFlash('err', j.error || 'accept failed');
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleLeave = useCallback(async () => {
    if (!party) return;
    setBusy('leave');
    try {
      await fetch(`/api/parties/${party.party_id}/leave`, { method: 'POST', credentials: 'include' });
      showFlash('ok', 'Left party.');
      refresh();
    } finally { setBusy(null); }
  }, [party, refresh, showFlash]);

  const handleKick = useCallback(async (targetUserId: string) => {
    if (!party) return;
    setBusy(`kick-${targetUserId}`);
    try {
      await fetch(`/api/parties/${party.party_id}/kick`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });
      refresh();
    } finally { setBusy(null); }
  }, [party, refresh]);

  const handleDisband = useCallback(async () => {
    if (!party) return;
    setBusy('disband');
    try {
      await fetch(`/api/parties/${party.party_id}/disband`, { method: 'POST', credentials: 'include' });
      showFlash('ok', 'Party disbanded.');
      refresh();
    } finally { setBusy(null); }
  }, [party, refresh, showFlash]);

  const memberCount = party?.members.length ?? 0;
  const pendingCount = invites.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Party (${memberCount} members${pendingCount > 0 ? `, ${pendingCount} invites` : ''})`}
        className={`fixed bottom-2 right-32 z-30 flex items-center gap-2 rounded-full border border-emerald-500/40 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-emerald-200 shadow-lg backdrop-blur transition hover:bg-slate-900/80 ${open ? 'ring-2 ring-emerald-400/40' : ''}`}
      >
        <Users2 className="h-3.5 w-3.5" />
        <span>{party ? `${memberCount}/${party.maxSize}` : 'Party'}</span>
        {pendingCount > 0 && (
          <span className="ml-1 rounded-full bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">{pendingCount}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          className="fixed bottom-12 right-32 z-30 flex max-h-[70vh] w-[320px] flex-col rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur"
        >
          <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
              <Users2 className="h-4 w-4" /> Party
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800">
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
            {/* Invites */}
            {invites.length > 0 && (
              <div className="mb-3">
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">Invites</h3>
                {invites.map((inv) => (
                  <div key={inv.id} className="mb-1.5 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-amber-100">{inv.partyName}</div>
                      <div className="text-[10px] text-amber-300/60">from {inv.fromUser.slice(0, 12)} · {inv.partyType}</div>
                    </div>
                    <button onClick={() => handleAccept(inv.id)} disabled={busy === `accept-${inv.id}`} className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Current party */}
            {party ? (
              <>
                <h3 className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  <span>{party.name}</span>
                  <span className="text-emerald-300/70">{party.partyType}</span>
                </h3>
                <ul className="space-y-1">
                  {party.members.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between rounded-md bg-slate-900/40 px-2 py-1">
                      <div className="flex min-w-0 items-center gap-2">
                        {m.role === 'leader' && <Crown className="h-3 w-3 text-yellow-400" />}
                        <span className="truncate font-mono text-[11px] text-slate-200">{m.userId.slice(0, 14)}</span>
                      </div>
                      {party.myRole === 'leader' && m.role !== 'leader' && (
                        <button onClick={() => handleKick(m.userId)} disabled={busy === `kick-${m.userId}`} aria-label="Kick" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300">
                          <UserMinus className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-1">
                  <button onClick={handleLeave} disabled={busy === 'leave'} className="flex items-center gap-1 rounded bg-slate-700/50 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-600/50 disabled:opacity-40">
                    <LogOut className="h-3 w-3" />
                    Leave
                  </button>
                  {party.myRole === 'leader' && (
                    <button onClick={handleDisband} disabled={busy === 'disband'} className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/30 disabled:opacity-40">
                      <ShieldOff className="h-3 w-3" />
                      Disband
                    </button>
                  )}
                  <Link href="/lenses/lfg" className="ml-auto flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/30">
                    <Send className="h-3 w-3" />
                    LFG
                  </Link>
                </div>
              </>
            ) : (
              /* No party yet — create form */
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">You're not in a party.</h3>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="Party name"
                  className="mb-2 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100 focus:border-emerald-500/50 focus:outline-none"
                />
                <select
                  value={createForm.partyType}
                  onChange={(e) => setCreateForm({ ...createForm, partyType: e.target.value as 'normal' | 'raid' })}
                  className="mb-2 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100 focus:border-emerald-500/50 focus:outline-none"
                >
                  <option value="normal">Normal (max 8)</option>
                  <option value="raid">Raid (max 40)</option>
                </select>
                <button onClick={handleCreate} disabled={busy === 'create'} className="w-full rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40">
                  Create party
                </button>
                <Link href="/lenses/lfg" className="mt-2 block w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-center text-[11px] text-cyan-200 hover:bg-cyan-500/20">
                  Browse LFG board
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
