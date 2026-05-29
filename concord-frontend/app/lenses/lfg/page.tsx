'use client';

/**
 * /lenses/lfg — Looking For Group board.
 *
 * Post a request: "I'm a healer in tunya, looking for 2 DPS."
 * Browse open requests filtered by world + role. Click invite → the
 * party is created if you're not in one, the poster gets invited.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users2, Filter, RefreshCcw, Send, Plus, Check, AlertCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

type Role = 'tank' | 'healer' | 'dps' | 'support' | 'any';

interface LfgRow {
  id: string;
  userId: string;
  worldId: string;
  role: Role;
  partyType: 'normal' | 'raid';
  note: string;
  createdAt: number;
  expiresAt: number;
  partyMaxSize: number;
  currentSize: number;
}

const ROLES: Role[] = ['tank', 'healer', 'dps', 'support', 'any'];
const WORLDS = ['concordia-hub', 'tunya', 'sovereign-ruins', 'crime', 'cyber', 'superhero', 'fantasy', 'lattice-crucible'];

export default function LfgLensPage() {
  const [requests, setRequests] = useState<LfgRow[]>([]);
  const [filterWorld, setFilterWorld] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<Role | 'all'>('all');
  const [postForm, setPostForm] = useState({ worldId: 'concordia-hub', role: 'any' as Role, partyType: 'normal' as 'normal' | 'raid', note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterWorld !== 'all') params.set('worldId', filterWorld);
      if (filterRole !== 'all') params.set('role', filterRole);
      const r = await fetch(`/api/lfg/open?${params.toString()}`).then((x) => x.json());
      if (r?.ok) setRequests(r.requests || []);
    } catch { /* network blip */ }
  }, [filterWorld, filterRole]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 8_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handlePost = useCallback(async () => {
    setBusy('post');
    try {
      const r = await fetch('/api/lfg/post', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(postForm),
      });
      const j = await r.json();
      if (j.ok) { showFlash('ok', 'Request posted.'); refresh(); setPostForm({ ...postForm, note: '' }); }
      else showFlash('err', j.error || 'post failed');
    } finally { setBusy(null); }
  }, [postForm, refresh, showFlash]);

  const handleInvite = useCallback(async (lfgId: string) => {
    setBusy(`invite-${lfgId}`);
    try {
      const r = await fetch(`/api/lfg/${lfgId}/invite`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j.ok) showFlash('ok', 'Invite sent.');
      else showFlash('err', j.error || 'invite failed');
      refresh();
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  return (
    <LensShell lensId="lfg" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
        <header className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
              <Users2 className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Looking For Group</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Find or post group requests across all worlds.</p>
            </div>
            <button onClick={refresh} aria-label="Refresh" className="rounded-full border border-cyan-500/30 bg-cyan-500/10 p-1.5 text-cyan-300 hover:bg-cyan-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          {flash && (
            <div className={`mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md px-3 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {flash.msg}
            </div>
          )}
        </header>

        <section className="mx-auto grid max-w-screen-2xl gap-4 px-3 py-4 sm:grid-cols-[2fr_1fr] sm:px-6 sm:py-5">
          {/* Open requests */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Filter className="h-4 w-4" /> Open requests
            </h2>
            <div className="mb-3 flex flex-wrap gap-1">
              <select value={filterWorld} onChange={(e) => setFilterWorld(e.target.value)} className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-100">
                <option value="all">All worlds</option>
                {WORLDS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <select value={filterRole} onChange={(e) => setFilterRole(e.target.value as Role | 'all')} className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-100">
                <option value="all">All roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <ul className="space-y-2">
              {requests.length === 0 && (
                <li className="rounded-md border border-slate-700 bg-slate-900/30 p-3 text-center text-[11px] text-slate-500">No open requests. Post one yourself.</li>
              )}
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                      <span className="rounded bg-cyan-500/20 px-1 text-cyan-200">{r.role}</span>
                      <span className="rounded bg-slate-700/50 px-1 text-slate-300">{r.partyType}</span>
                      <span className="rounded bg-slate-700/50 px-1 text-slate-300">{r.worldId}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-cyan-100">{r.userId.slice(0, 14)}</div>
                    {r.note && <p className="mt-0.5 text-[11px] text-cyan-200/80">{r.note}</p>}
                  </div>
                  <button onClick={() => handleInvite(r.id)} disabled={busy === `invite-${r.id}`} className="shrink-0 rounded-md bg-emerald-500/20 px-3 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40">
                    <Send className="inline h-3 w-3 mr-1" />
                    Invite
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Post form */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
              <Plus className="h-4 w-4" /> Post your own
            </h2>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">World</span>
              <select value={postForm.worldId} onChange={(e) => setPostForm({ ...postForm, worldId: e.target.value })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                {WORLDS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Your role</span>
              <select value={postForm.role} onChange={(e) => setPostForm({ ...postForm, role: e.target.value as Role })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Party type</span>
              <select value={postForm.partyType} onChange={(e) => setPostForm({ ...postForm, partyType: e.target.value as 'normal' | 'raid' })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                <option value="normal">Normal (8 max)</option>
                <option value="raid">Raid (40 max)</option>
              </select>
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Note (optional)</span>
              <textarea value={postForm.note} onChange={(e) => setPostForm({ ...postForm, note: e.target.value })} rows={3} maxLength={240} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100" />
            </label>
            <button onClick={handlePost} disabled={busy === 'post'} className="w-full rounded-md border border-fuchsia-500/40 bg-fuchsia-500/20 px-2 py-1 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40">
              Post request
            </button>
          </div>
        </section>
      </main>
    </LensShell>
  );
}
