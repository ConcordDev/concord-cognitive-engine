'use client';

/**
 * CommunesPanel — Communes: "a federated peer-set + shared lens-anchor
 * pool" (server/server.js:75704 comment). Real DB-backed group membership
 * (`communes` + `commune_members` tables, created lazily on first use),
 * wired to `federation.commune_create/join/list/status` — 4 real macros
 * registered directly in server.js (Phase 6.2), never surfaced anywhere in
 * the frontend before this pass. Distinct from the `federation` LENS_ACTION
 * moderation/policy/relay/trust/metrics cluster in
 * `server/domains/federation.js` (already well-surfaced) — communes are a
 * social-grouping primitive, not an instance-to-instance peering control.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Users2, Plus, Loader2, LogIn, ChevronRight, Crown } from 'lucide-react';

interface CommuneSummary {
  id: number;
  name: string;
  description: string;
  visibility: string;
  created_at: number;
  member_count: number;
}

interface CommuneMember { user_id: string; role: string; joined_at: number }
interface CommuneDetail {
  commune: CommuneSummary;
  members: CommuneMember[];
  memberCount: number;
  isMember: boolean;
}

export function CommunesPanel() {
  const [communes, setCommunes] = useState<CommuneSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CommuneDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ ok: boolean; communes: CommuneSummary[] }>('federation', 'commune_list', { limit: 25 });
      if (r.data.ok && r.data.result?.communes) setCommunes(r.data.result.communes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const r = await lensRun<{ ok: boolean; communeId?: number; reason?: string }>('federation', 'commune_create', {
        name: name.trim(), description: description.trim(), visibility: 'public',
      });
      if (r.data.ok && r.data.result?.ok !== false) {
        setName(''); setDescription('');
        await load();
      } else {
        setErr(r.data.result?.reason || r.data.error || 'create failed');
      }
    } finally {
      setCreating(false);
    }
  }, [name, description, load]);

  const open = useCallback(async (id: number) => {
    const r = await lensRun<CommuneDetail>('federation', 'commune_status', { communeId: id });
    if (r.data.ok && r.data.result) setDetail(r.data.result);
  }, []);

  const join = useCallback(async (id: number) => {
    setBusyId(id);
    try {
      const r = await lensRun('federation', 'commune_join', { communeId: id });
      if (r.data.ok) { await load(); await open(id); }
    } finally {
      setBusyId(null);
    }
  }, [load, open]);

  return (
    <section className="rounded-lg border border-emerald-500/30 bg-black/60 p-4 space-y-4">
      <h2 className="text-emerald-300 font-semibold inline-flex items-center gap-1.5">
        <Users2 className="w-4 h-4" /> Communes
      </h2>
      <p className="text-xs text-gray-400">
        A commune is a federated peer-set with a shared lens-anchor pool — join to co-organise across
        instances, not just trust-peer with them.
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Commune name"
          className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-400"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <button
          type="button"
          onClick={create}
          disabled={creating || !name.trim()}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create
        </button>
      </div>
      {err && <p className="text-rose-300 text-xs">{err}</p>}

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading communes…</p>
      ) : communes.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No public communes yet. Create the first one above.</p>
      ) : (
        <ul className="space-y-2">
          {communes.map((c) => (
            <li key={c.id} className="border border-white/10 rounded p-3">
              <button type="button" onClick={() => open(c.id)} className="w-full text-left flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-100 truncate">{c.name}</div>
                  {c.description && <div className="text-[11px] text-gray-400 truncate">{c.description}</div>}
                  <div className="text-[10px] text-gray-400 mt-0.5">{c.member_count} member{c.member_count === 1 ? '' : 's'} · created {new Date(c.created_at * 1000).toLocaleDateString()}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              </button>

              {detail?.commune.id === c.id && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  {!detail.isMember && (
                    <button
                      type="button"
                      onClick={() => join(c.id)}
                      disabled={busyId === c.id}
                      className="mb-2 px-2 py-1 text-xs bg-emerald-700/60 hover:bg-emerald-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />}
                      Join commune
                    </button>
                  )}
                  {detail.isMember && (
                    <p className="mb-2 text-[11px] text-emerald-300">You're a member.</p>
                  )}
                  <ul className="space-y-1">
                    {detail.members.map((m) => (
                      <li key={m.user_id} className="text-[11px] text-gray-400 flex items-center gap-1.5">
                        {m.role === 'founder' && <Crown className="w-3 h-3 text-amber-400" />}
                        <span className="font-mono">{m.user_id}</span>
                        <span className="text-gray-400">· {m.role}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
