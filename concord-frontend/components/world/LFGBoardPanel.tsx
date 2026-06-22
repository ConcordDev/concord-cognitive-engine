'use client';

// Phase E7 — LFG (Looking-For-Group) board.
// Modal listens for `concordia:open-lfg-board` (dispatched from
// the command palette's "Find a group" curated action). Shows open
// LFG requests in the current world; lets the player post their own.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Users, X, Plus, Loader2 } from 'lucide-react';
import { successJuice, failureJuice } from '@/lib/concordia/juice';

interface LfgRequest {
  id: string;
  user_id: string;
  user_name?: string;
  world_id: string;
  role: 'tank' | 'healer' | 'dps' | 'support' | 'any';
  party_size: number;
  note?: string;
  created_at: number;
}

const ROLES: Array<LfgRequest['role']> = ['any', 'tank', 'healer', 'dps', 'support'];

export function LFGBoardPanel() {
  const [open, setOpen] = useState(false);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [requests, setRequests] = useState<LfgRequest[]>([]);
  const [filterRole, setFilterRole] = useState<LfgRequest['role']>('any');
  const [postRole, setPostRole] = useState<LfgRequest['role']>('any');
  const [postSize, setPostSize] = useState(4);
  const [postNote, setPostNote] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(w);
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('concordia:open-lfg-board', handler);
    return () => window.removeEventListener('concordia:open-lfg-board', handler);
  }, []);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const params = new URLSearchParams({ worldId });
      if (filterRole !== 'any') params.set('role', filterRole);
      const j = await fetch(`/api/lfg?${params.toString()}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setRequests(j.requests || []);
    } catch { /* swallow */ }
  }, [worldId, filterRole]);

  useRealtimeRefresh(['lfg:board-update'], refresh, { backstopMs: 20_000, enabled: open });

  const post = useCallback(async () => {
    if (!worldId) return;
    setPending(true);
    try {
      const r = await fetch('/api/lfg', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          worldId,
          role: postRole,
          partySize: postSize,
          note: postNote.slice(0, 240),
        }),
      });
      const j = await r.json();
      if (j?.ok) {
        successJuice('ui_lfg_posted');
        setPostNote('');
        refresh();
      } else {
        failureJuice();
      }
    } finally { setPending(false); }
  }, [worldId, postRole, postSize, postNote, refresh]);

  const cancel = useCallback(async (lfgId: string) => {
    setPending(true);
    try {
      await fetch(`/api/lfg/${lfgId}/cancel`, { method: 'POST', credentials: 'include' });
      refresh();
    } finally { setPending(false); }
  }, [refresh]);

  if (!open) return null;

  return (
    <div
      className="concordia-hud-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur"
      onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-emerald-500/40 bg-zinc-950/95 p-4 shadow-2xl">
        <header className="mb-3 flex items-center justify-between border-b border-emerald-500/20 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
            <Users size={14} /> Looking for a group · {worldId || '?'}
          </h2>
          <button aria-label="Open" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X size={14} />
          </button>
        </header>

        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] uppercase text-emerald-300/70">filter</span>
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setFilterRole(r)}
              className={[
                'rounded px-2 py-1 text-[10px]',
                filterRole === r ? 'bg-emerald-500/40 text-emerald-50' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
              ].join(' ')}
            >{r}</button>
          ))}
        </div>

        <div className="mb-3 max-h-72 space-y-1 overflow-y-auto">
          {requests.length === 0 && <p className="text-center text-xs text-zinc-400">No open requests in this world.</p>}
          {requests.map((req) => (
            <div key={req.id} className="flex items-center justify-between rounded border border-emerald-500/20 bg-emerald-950/20 p-2 text-xs">
              <div>
                <div className="text-emerald-100">{req.user_name || req.user_id.slice(0, 14)}</div>
                <div className="text-[10px] text-emerald-300/70">{req.role} · size {req.party_size}</div>
                {req.note && <div className="mt-1 text-[10px] text-zinc-300">{req.note}</div>}
              </div>
              <button
                onClick={() => cancel(req.id)}
                disabled={pending}
                className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                title="Cancel (own requests only — server filters)"
              >
                cancel
              </button>
            </div>
          ))}
        </div>

        <div className="rounded border border-emerald-500/30 bg-emerald-950/30 p-3">
          <div className="mb-2 text-[10px] uppercase text-emerald-300/70">post your own</div>
          <div className="grid grid-cols-2 gap-2">
            <select value={postRole} onChange={(e) => setPostRole(e.target.value as LfgRequest['role'])} className="rounded border border-emerald-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-emerald-100">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={postSize} onChange={(e) => setPostSize(Number(e.target.value))} className="rounded border border-emerald-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-emerald-100">
              {[2, 3, 4, 5, 6, 8, 10, 20, 40].map((n) => <option key={n} value={n}>party {n}</option>)}
            </select>
          </div>
          <input
            value={postNote}
            onChange={(e) => setPostNote(e.target.value)}
            placeholder="Optional note (240 chars max)"
            maxLength={240}
            className="mt-2 w-full rounded border border-emerald-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-emerald-100"
          />
          <button
            onClick={post}
            disabled={pending}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-emerald-500/40 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-500/60 disabled:opacity-50"
          >
            {pending ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />} Post LFG
          </button>
        </div>
      </div>
    </div>
  );
}
