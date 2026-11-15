'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Hammer, Users } from 'lucide-react';
import { WarCampaignSession } from '@/components/kingdoms/WarCampaignSession';
import type { Decree, DecreeKindMeta, Kingdom, Resident } from './types';

export function KingdomDetailPanel({ kingdomId }: { kingdomId: string }) {
  const [detail, setDetail] = useState<{ kingdom: Kingdom; decrees: Decree[]; residents: Resident[]; viewer?: { resident: boolean; role: string | null } } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decreeKinds, setDecreeKinds] = useState<Record<string, DecreeKindMeta>>({});
  const [decreeKind, setDecreeKind] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [contestKind, setContestKind] = useState<'siege' | 'subversion' | 'annexation'>('siege');
  // Lifecycle controls (FIX-kingdoms-001): rename / leave / abdicate / dissolve.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmAction, setConfirmAction] = useState<'leave' | 'abdicate' | 'dissolve' | null>(null);
  const [gone, setGone] = useState(false);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/kingdoms/${id}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) setDetail({ kingdom: j.kingdom, decrees: j.decrees, residents: j.residents, viewer: j.viewer });
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

  if (gone) {
    return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">This kingdom has been dissolved.</div>;
  }

  if (!detail) {
    return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">Loading kingdom…</div>;
  }

  const { kingdom, decrees, residents, viewer } = detail;
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
    setNotice(null);
    try {
      const r = await fetch(`/api/kingdoms/${kingdom.id}/contest`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestKind }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) setNotice(j?.error || j?.reason || 'Contest was not started.');
      else setNotice(`Contest started (${contestKind}).`);
      onRefresh();
    } finally { setSubmitting(false); }
  };

  const rename = async () => {
    if (!nameDraft.trim()) { setNotice('Name cannot be empty.'); return; }
    const r = await fetch(`/api/kingdoms/${kingdom.id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameDraft.trim() }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.ok === false) { setNotice(j?.error || 'Rename failed.'); return; }
    setEditingName(false);
    setNotice('Kingdom renamed.');
    onRefresh();
  };

  const lifecycle = async (action: 'leave' | 'abdicate' | 'dissolve') => {
    const url = action === 'dissolve'
      ? `/api/kingdoms/${kingdom.id}`
      : `/api/kingdoms/${kingdom.id}/${action}`;
    const r = await fetch(url, {
      method: action === 'dissolve' ? 'DELETE' : 'POST',
      credentials: 'same-origin',
    });
    const j = await r.json().catch(() => null);
    setConfirmAction(null);
    if (!r.ok || j?.ok === false) { setNotice(j?.error || 'That did not work.'); return; }
    if (action === 'leave') { setNotice('You have left this kingdom.'); onRefresh(); return; }
    if (action === 'dissolve' || j?.outcome === 'dissolved') { setGone(true); return; }
    setNotice('You abdicated — the crown has passed to your heir.');
    onRefresh();
  };

  const join = async () => {
    setNotice(null);
    const r = await fetch(`/api/kingdoms/${kingdom.id}/join`, { method: 'POST', credentials: 'same-origin' });
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.ok === false) setNotice(j?.error || j?.reason || 'Could not join.');
    else if (j?.alreadyResident) setNotice(j.role === 'ruler' ? 'You already rule this kingdom.' : 'You already live here.');
    else setNotice('Joined as a citizen.');
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
              Ruler: <span>{kingdom.ruler_display_name || kingdom.ruler_faction_id || '—'}</span> ·
              Region: {kingdom.region_polygon?.length ?? 0} vertices ·
              Strength: <span className="tabular-nums">{Math.round(kingdom.claim_strength)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            {viewer?.resident ? (
              <span className="rounded bg-slate-800 px-3 py-1.5 text-sm capitalize text-slate-300">You are {viewer.role || 'a resident'}</span>
            ) : (
              <button onClick={join} className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-amber-500">
                <Users className="h-3.5 w-3.5" /> Join
              </button>
            )}
          </div>
        </div>
        {notice && <p className="mt-3 text-sm text-amber-200" role="status">{notice}</p>}

        {(viewer?.role === 'ruler' || (viewer?.resident && viewer?.role !== 'ruler')) && (
          <div className="mt-4 border-t border-slate-800 pt-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">
              {viewer?.role === 'ruler' ? 'Your rule' : 'Your residency'}
            </p>
            {viewer?.role === 'ruler' && (
              editingName ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Kingdom name"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  />
                  <button onClick={() => void rename()} className="rounded bg-amber-700 px-3 py-1.5 text-sm hover:bg-amber-600">Save name</button>
                  <button onClick={() => setEditingName(false)} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => { setNameDraft(kingdom.name); setEditingName(true); }}
                    className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
                  >
                    Rename kingdom
                  </button>
                  {confirmAction === 'abdicate' ? (
                    <>
                      <button onClick={() => void lifecycle('abdicate')} className="rounded bg-amber-800 px-3 py-1.5 text-sm text-amber-100">Confirm abdication</button>
                      <button onClick={() => setConfirmAction(null)} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
                    </>
                  ) : confirmAction === 'dissolve' ? (
                    <>
                      <button onClick={() => void lifecycle('dissolve')} className="rounded bg-rose-800 px-3 py-1.5 text-sm text-rose-100">Confirm dissolve</button>
                      <button onClick={() => setConfirmAction(null)} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setConfirmAction('abdicate')} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-amber-200 hover:bg-slate-700">Abdicate</button>
                      <button onClick={() => setConfirmAction('dissolve')} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-rose-300 hover:bg-slate-700">Dissolve kingdom</button>
                    </>
                  )}
                </div>
              )
            )}
            {viewer?.resident && viewer?.role !== 'ruler' && (
              confirmAction === 'leave' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => void lifecycle('leave')} className="rounded bg-rose-800 px-3 py-1.5 text-sm text-rose-100">Confirm leave</button>
                  <button onClick={() => setConfirmAction(null)} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmAction('leave')} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-rose-300 hover:bg-slate-700">Leave kingdom</button>
              )
            )}
          </div>
        )}
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
              disabled={submitting || viewer?.role === 'ruler'}
              title={viewer?.role === 'ruler' ? 'You already rule this kingdom' : 'Start a contest'}
              className="mt-2 w-full rounded bg-rose-700 px-3 py-1.5 text-sm font-medium hover:bg-rose-600 disabled:opacity-50"
            >
              {viewer?.role === 'ruler' ? 'You rule this kingdom' : 'Begin contest'}
            </button>
          </div>

          <h4 className="mb-2 mt-3 text-xs font-semibold text-slate-300">Residents ({residents.length})</h4>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {residents.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded px-2 py-1 text-[11px]">
                <span>{r.display_name}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] capitalize text-slate-400">{r.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
