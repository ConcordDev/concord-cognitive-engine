'use client';

/**
 * /lenses/lfg — Looking For Group board.
 *
 * Post a request: "I'm a healer in tunya, looking for 2 DPS."
 * Browse open requests filtered by world + role. Click invite → the
 * party is created if you're not in one, the poster gets invited.
 *
 * Four honest UX states for the request list: loading / error (with
 * retry) / empty / populated. No mock or seed data — every row comes
 * from the real /api/lfg/open route (server/lib/lfg.js).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users2, Filter, RefreshCcw, Send, Plus, Check, AlertCircle, Loader2, X } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useSmartPolling } from '@/hooks/useSmartPolling';

type Role = 'tank' | 'healer' | 'dps' | 'support' | 'any';
type LoadState = 'loading' | 'error' | 'ready';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [reloadKey, setReloadKey] = useState(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const hasRows = useRef(false);
  const [requests, setRequests] = useState<LfgRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterWorld, setFilterWorld] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<Role | 'all'>('all');
  const [postForm, setPostForm] = useState({ worldId: 'concordia-hub', role: 'any' as Role, partyType: 'normal' as 'normal' | 'raid', note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  // Track which posts belong to this session so the owner can cancel them
  // (the open list is anonymous — userIds are opaque, so we remember ids
  // we just created rather than guessing identity).
  const [ownPosts, setOwnPosts] = useState<ReadonlySet<string>>(() => new Set());

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (filterWorld !== 'all') params.set('worldId', filterWorld);
    if (filterRole !== 'all') params.set('role', filterRole);
    fetch(`/api/lfg/open?${params.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        const j = await res.json();
        if (!j?.ok) throw new Error(j?.error || 'request failed');
        return Array.isArray(j.requests) ? (j.requests as LfgRow[]) : [];
      })
      .then((rows) => {
        if (cancelled) return;
        hasRows.current = rows.length > 0;
        setRequests(rows);
        setLoadError(null);
        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        // Background polls keep the last-known list visible; only flip to the
        // error panel when there is nothing to show.
        setLoadError(err instanceof Error ? err.message : 'network error');
        setLoadState((prev) => (hasRows.current ? prev : 'error'));
      });
    return () => { cancelled = true; };
  }, [filterWorld, filterRole, reloadKey]);

  const retry = useCallback(() => {
    setLoadState('loading');
    setReloadKey((k) => k + 1);
  }, []);

  // Background refresh — tab-visibility-paused + jittered.
  useSmartPolling(refresh, 8_000, { immediate: false });

  const handlePost = useCallback(async () => {
    setBusy('post');
    try {
      const r = await fetch('/api/lfg/post', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(postForm),
      });
      const j = await r.json();
      if (j.ok) {
        if (j.id) setOwnPosts((prev) => new Set(prev).add(j.id));
        showFlash('ok', 'Request posted.');
        refresh();
        setPostForm({ ...postForm, note: '' });
      } else showFlash('err', j.error || j.reason || 'post failed');
    } catch {
      showFlash('err', 'network error');
    } finally { setBusy(null); }
  }, [postForm, refresh, showFlash]);

  const handleInvite = useCallback(async (lfgId: string) => {
    setBusy(`invite-${lfgId}`);
    try {
      const r = await fetch(`/api/lfg/${lfgId}/invite`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j.ok) showFlash('ok', 'Invite sent.');
      else showFlash('err', j.error || j.reason || 'invite failed');
      refresh();
    } catch {
      showFlash('err', 'network error');
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleCancel = useCallback(async (lfgId: string) => {
    setBusy(`cancel-${lfgId}`);
    try {
      const r = await fetch(`/api/lfg/${lfgId}/cancel`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j.ok) { setOwnPosts((prev) => { const n = new Set(prev); n.delete(lfgId); return n; }); showFlash('ok', 'Request cancelled.'); }
      else showFlash('err', j.error || j.reason || 'cancel failed');
      refresh();
    } catch {
      showFlash('err', 'network error');
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  return (
    <LensShell lensId="lfg" asMain={false}>
      <NorthStarFrame
        lensId="lfg"
        crumb="Looking for group"
        title={`Who is looking, ${who || 'traveller'}`}
        subtitle="Find or post group requests across every world. Invite a poster and a party forms."
        actions={(
          <button onClick={refresh} aria-label="Refresh requests" className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-300 hover:bg-white/10">
            <RefreshCcw className="h-4 w-4" />
          </button>
        )}
        cta={{ label: 'Post a request', icon: Users2, onClick: () => noteRef.current?.focus(), title: 'Jump to the post form' }}
      >
        {flash && (
          <div role="status" className={`mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
            {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {flash.msg}
          </div>
        )}
        <section className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          {/* Open requests */}
          <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Filter className="h-4 w-4" /> Open requests
            </h2>
            <div className="mb-3 flex flex-wrap gap-1">
              <label className="sr-only" htmlFor="lfg-filter-world">Filter by world</label>
              <select id="lfg-filter-world" aria-label="Filter by world" value={filterWorld} onChange={(e) => setFilterWorld(e.target.value)} className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-100">
                <option value="all">All worlds</option>
                {WORLDS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <label className="sr-only" htmlFor="lfg-filter-role">Filter by role</label>
              <select id="lfg-filter-role" aria-label="Filter by role" value={filterRole} onChange={(e) => setFilterRole(e.target.value as Role | 'all')} className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-100">
                <option value="all">All roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* STATE: loading (first load only) */}
            {loadState === 'loading' && (
              <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900/30 p-6 text-[11px] text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading open requests…
              </div>
            )}

            {/* STATE: error (honest message + retry) */}
            {loadState === 'error' && (
              <div role="alert" className="flex flex-col items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-6 text-center text-[11px] text-rose-200">
                <AlertCircle className="h-5 w-5" aria-hidden="true" />
                <p>Could not load requests{loadError ? `: ${loadError}` : '.'}</p>
                <button onClick={retry} className="mt-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-100 hover:bg-rose-500/20">
                  <RefreshCcw className="mr-1 inline h-3 w-3" aria-hidden="true" /> Retry
                </button>
              </div>
            )}

            {/* STATE: empty */}
            {loadState === 'ready' && requests.length === 0 && (
              <div role="status" className="rounded-md border border-slate-700 bg-slate-900/30 p-6 text-center text-[11px] text-slate-500">
                No open requests in this filter. Post one yourself →
              </div>
            )}

            {/* STATE: populated */}
            {loadState === 'ready' && requests.length > 0 && (
              <ul className="space-y-2" aria-label="Open group requests">
                {requests.map((r) => {
                  const mine = ownPosts.has(r.id);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                          <span className="rounded bg-cyan-500/20 px-1 text-cyan-200">{r.role}</span>
                          <span className="rounded bg-slate-700/50 px-1 text-slate-300">{r.partyType}</span>
                          <span className="rounded bg-slate-700/50 px-1 text-slate-300">{r.worldId}</span>
                          <span className="rounded bg-slate-700/50 px-1 text-slate-300">{r.currentSize}/{r.partyMaxSize}</span>
                          {mine && <span className="rounded bg-fuchsia-500/20 px-1 text-fuchsia-200">you</span>}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-cyan-100">{r.userId.slice(0, 14)}</div>
                        {r.note && <p className="mt-0.5 text-[11px] text-cyan-200/80">{r.note}</p>}
                      </div>
                      {mine ? (
                        <button onClick={() => handleCancel(r.id)} disabled={busy === `cancel-${r.id}`} aria-label="Cancel your request" className="shrink-0 rounded-md bg-rose-500/20 px-3 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30 disabled:opacity-40">
                          <X className="mr-1 inline h-3 w-3" aria-hidden="true" /> Cancel
                        </button>
                      ) : (
                        <button onClick={() => handleInvite(r.id)} disabled={busy === `invite-${r.id}`} aria-label={`Invite ${r.role} from ${r.worldId}`} className="shrink-0 rounded-md bg-emerald-500/20 px-3 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40">
                          <Send className="mr-1 inline h-3 w-3" aria-hidden="true" /> Invite
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Post form */}
          <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
              <Plus className="h-4 w-4" /> Post your own
            </h2>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">World</span>
              <select aria-label="Post world" value={postForm.worldId} onChange={(e) => setPostForm({ ...postForm, worldId: e.target.value })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                {WORLDS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Your role</span>
              <select aria-label="Post role" value={postForm.role} onChange={(e) => setPostForm({ ...postForm, role: e.target.value as Role })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Party type</span>
              <select aria-label="Party type" value={postForm.partyType} onChange={(e) => setPostForm({ ...postForm, partyType: e.target.value as 'normal' | 'raid' })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100">
                <option value="normal">Normal (8 max)</option>
                <option value="raid">Raid (40 max)</option>
              </select>
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Note (optional)</span>
              <textarea ref={noteRef} aria-label="Request note" value={postForm.note} onChange={(e) => setPostForm({ ...postForm, note: e.target.value })} rows={3} maxLength={240} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100" />
            </label>
            <button onClick={handlePost} disabled={busy === 'post'} className="flex w-full items-center justify-center gap-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/20 px-2 py-1 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40">
              {busy === 'post' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              Post request
            </button>
            <p className="mt-2 text-[10px] text-slate-500">Posting again in the same world replaces your previous open request.</p>
          </div>
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
