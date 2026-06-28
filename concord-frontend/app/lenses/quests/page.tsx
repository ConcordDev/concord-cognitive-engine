'use client';

/**
 * /lenses/quests — quest log lens.
 *
 * Active / Completed / Available tabs. Each active quest shows
 * objectives + progress + share-with-party button (visible when the
 * user is in a party).
 *
 * Backend: the real quest state machine in server/lib/quests/quest-engine.js,
 * surfaced through the `quests` domain macros (server/domains/quests.js).
 * `quests.mine` returns the lens-shaped active quests with merged objective
 * progress. Party sharing rides the real /api/parties routes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText, Check, Clock, Users2, RefreshCcw, AlertCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { lensRun } from '@/lib/api/client';

interface Objective {
  id?: string;
  title?: string;
  description?: string;
  progress?: number;
  target?: number;
  complete?: boolean;
}
interface Quest {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  objectives?: Objective[];
  reward?: { cc?: number; dtuIds?: string[]; title?: string };
}

type Tab = 'active' | 'completed' | 'available';
type LoadState = 'loading' | 'error' | 'ready';

export default function QuestsLensPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [quests, setQuests] = useState<Quest[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setState('loading');
    setErrMsg(null);
    try {
      // Real quest state machine via the quests domain macro. The party lookup
      // is best-effort (no party is a valid state, not an error).
      const [qRes, p] = await Promise.all([
        lensRun<{ ok: boolean; quests?: Quest[] }>('quests', 'mine', {}),
        fetch('/api/parties/me', { credentials: 'include' })
          .then((r) => r.json())
          .catch(() => null),
      ]);

      const node = qRes?.data;
      if (!node || node.ok === false || !node.result || node.result.ok === false) {
        throw new Error(node?.error || 'Could not load your quests.');
      }
      setQuests(node.result.quests || []);

      if (p?.ok && p.party) setPartyId(p.party.party_id);
      else setPartyId(null);

      setState('ready');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Could not load your quests.');
      setState('error');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleShare = useCallback(async (questId: string) => {
    if (!partyId) return;
    setBusy(`share-${questId}`);
    try {
      const r = await fetch(`/api/parties/${partyId}/share-quest`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questId }),
      });
      const j = await r.json();
      if (j.ok) showFlash('ok', 'Shared with party.');
      else showFlash('err', j.error || 'share failed');
    } catch {
      showFlash('err', 'share failed');
    } finally { setBusy(null); }
  }, [partyId, showFlash]);

  const filtered = useMemo(() => {
    return quests.filter((q) => {
      if (tab === 'active') return !q.status || q.status === 'active' || q.status === 'accepted';
      if (tab === 'completed') return q.status === 'completed' || q.status === 'rewarded';
      return q.status === 'available' || q.status === 'open';
    });
  }, [quests, tab]);

  return (
    <LensShell lensId="quests" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <ScrollText className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Quest log</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">{quests.length} total quest{quests.length === 1 ? '' : 's'}</p>
            </div>
            <button onClick={refresh} aria-label="Refresh quests" className="rounded-full border border-amber-500/30 bg-amber-500/10 p-1.5 text-amber-300 hover:bg-amber-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mx-auto mt-2 flex max-w-screen-2xl gap-1" role="tablist" aria-label="Quest filters">
            {(['active', 'completed', 'available'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md border px-3 py-1 text-[11px] font-medium capitalize ${tab === t ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-700/40'}`}>{t}</button>
            ))}
          </div>
          {flash && (
            <div role="status" className={`mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md px-3 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {flash.msg}
            </div>
          )}
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {state === 'loading' ? (
            <ul className="space-y-3" aria-busy="true" aria-label="Loading quests">
              {[0, 1, 2].map((i) => <li key={i} className="h-16 animate-pulse rounded-xl border border-amber-500/15 bg-amber-500/5" />)}
            </ul>
          ) : state === 'error' ? (
            <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p className="text-sm font-medium text-rose-200">Couldn&apos;t load your quests</p>
              <p className="text-[12px] text-slate-400">{errMsg}</p>
              <button onClick={refresh} className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-200 hover:bg-amber-500/20">
                <RefreshCcw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
              <ScrollText className="h-7 w-7 text-amber-400/50" />
              <p className="text-[13px] font-medium text-slate-300">
                {tab === 'active' ? 'No active quests' : tab === 'completed' ? 'No completed quests yet' : 'No quests available'}
              </p>
              <p className="text-[12px] text-slate-500">
                {tab === 'active'
                  ? 'Talk to an NPC in the world to accept a quest — it will appear here with its objectives.'
                  : tab === 'completed'
                    ? 'Finish a quest and it will move here.'
                    : 'Available offers show up here when an NPC has work for you.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((q) => (
                <li key={q.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-amber-100">{q.title || q.id}</h2>
                      {q.description && <p className="mt-0.5 text-[11px] text-amber-200/80">{q.description}</p>}
                    </div>
                    {tab === 'active' && partyId && (
                      <button onClick={() => handleShare(q.id)} disabled={busy === `share-${q.id}`} aria-label={`Share ${q.title || q.id} with party`} className="flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40">
                        <Users2 className="h-3 w-3" />
                        Share
                      </button>
                    )}
                  </div>
                  {q.objectives && q.objectives.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {q.objectives.map((o, i) => (
                        <li key={o.id || i} className="flex items-center gap-2 text-[11px]">
                          {o.complete ? <Check className="h-3 w-3 text-emerald-400" /> : <Clock className="h-3 w-3 text-amber-300/60" />}
                          <span className={o.complete ? 'text-slate-400 line-through' : 'text-amber-100'}>{o.title || o.description || `objective ${i + 1}`}</span>
                          {o.target != null && (
                            <span className="ml-auto text-[10px] text-amber-300/60">{o.progress ?? 0} / {o.target}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.reward && (q.reward.cc || q.reward.title) && (
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                      {q.reward.cc != null && q.reward.cc > 0 && <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-yellow-200">+{q.reward.cc} CC</span>}
                      {q.reward.title && <span className="rounded bg-fuchsia-500/30 px-1.5 py-0.5 text-fuchsia-100">Title: {q.reward.title}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </LensShell>
  );
}
