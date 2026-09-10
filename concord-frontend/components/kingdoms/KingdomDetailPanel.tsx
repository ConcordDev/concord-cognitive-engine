'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Hammer, Users } from 'lucide-react';
import { WarCampaignSession } from '@/components/kingdoms/WarCampaignSession';
import type { Decree, DecreeKindMeta, Kingdom, Resident } from './types';

export function KingdomDetailPanel({ kingdomId }: { kingdomId: string }) {
  const [detail, setDetail] = useState<{ kingdom: Kingdom; decrees: Decree[]; residents: Resident[] } | null>(null);
  const [decreeKinds, setDecreeKinds] = useState<Record<string, DecreeKindMeta>>({});
  const [decreeKind, setDecreeKind] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [contestKind, setContestKind] = useState<'siege' | 'subversion' | 'annexation'>('siege');

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/kingdoms/${id}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) setDetail({ kingdom: j.kingdom, decrees: j.decrees, residents: j.residents });
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/kingdoms/_meta/decree-kinds', { credentials: 'same-origin' });
        const j = await r.json();
        if (j?.ok) setDecreeKinds(j.kinds);
      } catch { /* ok */ }
    })();
  }, []);

  useEffect(() => { if (kingdomId) fetchDetail(kingdomId); }, [kingdomId, fetchDetail]);

  if (!detail) {
    return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">Loading kingdom…</div>;
  }

  const { kingdom, decrees, residents } = detail;
  const onRefresh = () => fetchDetail(kingdomId);

  const enact = async () => {
    if (!decreeKind) return;
    setSubmitting(true);
    try {
      await fetch(`/api/kingdoms/${kingdom.id}/decree`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decreeKind, parameters: {} }),
      });
      onRefresh();
    } finally { setSubmitting(false); }
  };

  const contest = async () => {
    setSubmitting(true);
    try {
      await fetch(`/api/kingdoms/${kingdom.id}/contest`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestKind }),
      });
      onRefresh();
    } finally { setSubmitting(false); }
  };

  const join = async () => {
    await fetch(`/api/kingdoms/${kingdom.id}/join`, { method: 'POST', credentials: 'same-origin' });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <WarCampaignSession kingdomId={kingdom.id} kingdomName={kingdom.name} />
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-amber-100">{kingdom.name}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {kingdom.world_id} · founded {new Date(kingdom.founded_at * 1000).toISOString().split('T')[0]}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Ruler: <span className="font-mono">{kingdom.ruler_user_id || kingdom.ruler_faction_id || '—'}</span> ·
              Region: {kingdom.region_polygon?.length ?? 0} vertices ·
              Strength: <span className="tabular-nums">{Math.round(kingdom.claim_strength)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={join} className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <Users className="h-3.5 w-3.5" /> Join
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-200">
            <Hammer className="h-4 w-4" /> Decrees
          </h3>
          <div className="mb-4 rounded border border-slate-700 bg-slate-800 p-3">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Enact (ruler only)</label>
            <select
              value={decreeKind}
              onChange={(e) => setDecreeKind(e.target.value)}
              className="w-full rounded bg-slate-900 px-2 py-1 text-sm"
            >
              <option value="">— select decree kind —</option>
              {Object.entries(decreeKinds).map(([k, meta]) => (
                <option key={k} value={k}>{k}: {meta.description}</option>
              ))}
            </select>
            <button
              onClick={enact}
              disabled={!decreeKind || submitting}
              className="mt-2 w-full rounded bg-amber-700 px-3 py-1.5 text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'Enacting…' : 'Enact decree'}
            </button>
          </div>
          {decrees.length === 0 ? (
            <div className="text-sm text-slate-400">No decrees yet.</div>
          ) : (
            <ul className="space-y-2">
              {decrees.map((d) => (
                <li key={d.id} className="rounded bg-slate-800 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-amber-200">{d.decree_kind}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                      d.activation_state === 'enforced' ? 'bg-emerald-900/40 text-emerald-300' :
                      d.activation_state === 'tension'  ? 'bg-amber-900/40 text-amber-300' :
                      'bg-rose-900/40 text-rose-300'
                    }`}>
                      {d.activation_state}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    Alignment: {Math.round(d.alignment_score * 100)}%
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-200">
            <AlertTriangle className="h-4 w-4" /> Contest
          </h3>
          <div className="mb-3 rounded border border-slate-700 bg-slate-800 p-3">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Contest kind</label>
            <div className="flex gap-1">
              {(['siege', 'subversion', 'annexation'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setContestKind(c)}
                  className={`flex-1 rounded px-1.5 py-1 text-[10px] capitalize ${
                    contestKind === c ? 'bg-rose-700 text-rose-50' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              onClick={contest}
              disabled={submitting}
              className="mt-2 w-full rounded bg-rose-700 px-3 py-1.5 text-sm font-medium hover:bg-rose-600 disabled:opacity-50"
            >
              Begin contest
            </button>
          </div>

          <h4 className="mb-2 mt-3 text-xs font-semibold text-slate-300">Residents ({residents.length})</h4>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {residents.map((r) => (
              <li key={r.user_id} className="flex items-center justify-between rounded px-2 py-1 text-[11px]">
                <span className="font-mono">{r.user_id.slice(0, 14)}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] capitalize text-slate-400">{r.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
