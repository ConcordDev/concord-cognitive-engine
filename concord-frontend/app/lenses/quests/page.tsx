'use client';

/**
 * /lenses/quests — quest log lens.
 *
 * Active / Completed / Available tabs. Each active quest shows objectives +
 * progress + share-with-party button (visible when the user is in a party);
 * each completed-but-unclaimed quest shows a Claim rewards button.
 *
 * Backend: the real quest state machine in server/lib/quests/quest-engine.js,
 * surfaced through the `quests` domain macros (server/domains/quests.js).
 * `quests.mine` returns the lens-shaped ACTIVE quests with merged objective
 * progress; `quests.completed` returns the completed/rewarded history (a
 * separate macro because `quests.mine`'s underlying query deliberately
 * excludes non-active rows — see quest-engine.js#getActiveQuests). Reward
 * claims go through `quests.claimRewards`. Party sharing rides the real
 * /api/parties routes.
 *
 * The Available tab lists the world catalog the player has not accepted
 * yet (`quests.available`) — NPC offers and web-posted quests share the
 * same world_quests records — with an Accept button (`quests.accept`),
 * and a Post-a-quest form (`quests.create`) so a web user can author
 * one into the catalog. (FIX-quests-001: neither path existed on the
 * web before; the tab filtered for statuses nothing ever returned.)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText, Check, Clock, Users2, RefreshCcw, AlertCircle, Gift } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
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

  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => {
    setState('loading');
    setErrMsg(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `quests.mine` only returns ACTIVE quests (quest-engine.js excludes
      // completed/rewarded rows), so Completed needs the separate
      // `quests.completed` macro; that call and the party lookup are
      // best-effort so a hiccup there never blocks the primary active list.
      const [qRes, completedRes, availableRes, p] = await Promise.all([
        lensRun<{ ok: boolean; quests?: Quest[] }>('quests', 'mine', {}),
        Promise.resolve(lensRun<{ ok: boolean; quests?: Quest[] }>('quests', 'completed', {})).catch(() => null),
        Promise.resolve(lensRun<{ ok: boolean; quests?: Quest[] }>('quests', 'available', {})).catch(() => null),
        fetch('/api/parties/me', { credentials: 'include' })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      const node = qRes?.data;
      if (!node || node.ok === false || !node.result || node.result.ok === false) {
        throw new Error(node?.error || 'Could not load your quests.');
      }
      const completedNode = completedRes?.data;
      const completedQuests =
        completedNode && completedNode.ok !== false && completedNode.result?.ok !== false
          ? completedNode.result?.quests || []
          : [];
      const availableNode = availableRes?.data;
      const availableQuests =
        availableNode && availableNode.ok !== false && availableNode.result?.ok !== false
          ? (availableNode.result?.quests || []).map((q) => ({ ...q, status: q.status || 'available' }))
          : [];
      const merged = new Map<string, Quest>();
      // Available first so an accepted/completed row for the same quest
      // (mine/completed) wins over its catalog entry.
      for (const q of [...availableQuests, ...completedQuests, ...(node.result.quests || [])]) merged.set(q.id, q);
      return { list: Array.from(merged.values()), party: p?.ok && p.party ? (p.party.party_id as string) : null };
    })()
      .then(({ list, party }) => {
        if (cancelled) return;
        setQuests(list);
        setPartyId(party);
        setState('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setErrMsg(e instanceof Error ? e.message : 'Could not load your quests.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const handleClaim = useCallback(async (questId: string) => {
    setBusy(`claim-${questId}`);
    try {
      const r = await lensRun<{ ok: boolean; rewards?: unknown[]; error?: string }>(
        'quests', 'claimRewards', { questId },
      );
      const node = r?.data;
      if (!node || node.ok === false || !node.result || node.result.ok === false) {
        showFlash('err', node?.result?.error || node?.error || 'Could not claim rewards.');
      } else {
        showFlash('ok', 'Rewards claimed.');
        setQuests((prev) => prev.map((q) => (q.id === questId ? { ...q, status: 'rewarded' } : q)));
      }
    } catch {
      showFlash('err', 'Could not claim rewards.');
    } finally {
      setBusy(null);
    }
  }, [showFlash]);


  const handleAccept = useCallback(async (questId: string) => {
    setBusy(`accept-${questId}`);
    try {
      const r = await lensRun<{ ok: boolean; reason?: string; error?: string }>(
        'quests', 'accept', { questId },
      );
      const node = r?.data;
      if (!node || node.ok === false || !node.result || node.result.ok === false) {
        const reason = node?.result?.reason || node?.result?.error || node?.error;
        showFlash('err', reason === 'quest_not_found' ? 'That quest is no longer available.' : 'Could not accept that quest.');
      } else {
        showFlash('ok', 'Quest accepted — find it under Active.');
        setQuests((prev) => prev.map((q) => (q.id === questId ? { ...q, status: 'active' } : q)));
      }
    } catch {
      showFlash('err', 'Could not accept that quest.');
    } finally {
      setBusy(null);
    }
  }, [showFlash]);

  // FIX-quests-001: post a quest into the world catalog from the web.
  const [showCreate, setShowCreate] = useState(false);
  const [cTitle, setCTitle] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cType, setCType] = useState('gather');
  const [cTarget, setCTarget] = useState('');
  const [cCount, setCCount] = useState('1');
  const [cXp, setCXp] = useState('50');
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!cTitle.trim() || !cTarget.trim()) return;
    setCreating(true);
    try {
      const r = await lensRun<{ ok: boolean; reason?: string; error?: string }>(
        'quests', 'create',
        {
          title: cTitle.trim(),
          description: cDesc.trim(),
          objectives: [{ type: cType, target: cTarget.trim(), requiredCount: Math.max(1, Number(cCount) || 1) }],
          rewardXp: Math.max(0, Number(cXp) || 0),
        },
      );
      const node = r?.data;
      if (!node || node.ok === false || !node.result || node.result.ok === false) {
        showFlash('err', 'Could not post that quest — check the title and objective.');
      } else {
        showFlash('ok', 'Quest posted — it is listed under Available for anyone in this world.');
        setShowCreate(false);
        setCTitle(''); setCDesc(''); setCTarget(''); setCCount('1'); setCXp('50');
        refresh();
      }
    } catch {
      showFlash('err', 'Could not post that quest.');
    } finally {
      setCreating(false);
    }
  }, [cTitle, cDesc, cType, cTarget, cCount, cXp, showFlash, refresh]);

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

  const counts = useMemo(() => ({
    active: quests.filter((q) => !q.status || q.status === 'active' || q.status === 'accepted').length,
    completed: quests.filter((q) => q.status === 'completed' || q.status === 'rewarded').length,
    available: quests.filter((q) => q.status === 'available' || q.status === 'open').length,
  }), [quests]);
  const unclaimed = quests.filter((q) => q.status === 'completed').length;

  return (
    <LensShell lensId="quests" asMain={false}>
      <NorthStarFrame
        lensId="quests"
        crumb="Quest log"
        subtitle={`${quests.length} total quest${quests.length === 1 ? '' : 's'}${partyId ? ' · in a party, so active quests can be shared' : ''}`}
        actions={
          <button onClick={refresh} aria-label="Refresh quests" title="Refresh quests" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-400 hover:text-zinc-100">
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        }
        tabs={[
          { id: 'active', label: `Active (${counts.active})`, icon: Clock, hint: 'Quests you have accepted' },
          { id: 'completed', label: `Completed (${counts.completed})`, icon: Check, hint: 'Finished quests and unclaimed rewards' },
          { id: 'available', label: `Available (${counts.available})`, icon: ScrollText, hint: 'Offers from NPCs and posted by players' },
        ]}
        activeTab={tab}
        onTab={(id) => setTab(id as Tab)}
        tabsLabel="Quest filters"
        cta={
          unclaimed > 0
            ? { label: `Claim rewards (${unclaimed})`, icon: Gift, onClick: () => setTab('completed'), title: 'Jump to completed quests with unclaimed rewards' }
            : { label: 'Refresh quests', icon: RefreshCcw, onClick: () => void refresh(), title: 'Reload your quest log' }
        }
      >
        {flash && (
          <div role="status" className={`mb-4 flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
            {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {flash.msg}
          </div>
        )}
        <section>
          {tab === 'available' && state === 'ready' && (
            <div className="mb-4">
              {!showCreate ? (
                <button onClick={() => setShowCreate(true)} className="flex min-h-11 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-200 hover:bg-amber-500/20">
                  <ScrollText className="h-3.5 w-3.5" /> Post a quest
                </button>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <h2 className="text-sm font-semibold text-amber-100">Post a quest</h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">It joins this world&apos;s catalog — anyone here can accept it, including you. The reward is XP; a posted quest mints no currency.</p>
                  <div className="mt-3 space-y-2">
                    <input id="quest-create-title" name="title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} maxLength={120}
                      aria-label="Quest title" placeholder="Quest title"
                      className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/50" />
                    <textarea id="quest-create-description" name="description" value={cDesc} onChange={(e) => setCDesc(e.target.value)} maxLength={600}
                      aria-label="Quest description" placeholder="What needs doing? (optional)" rows={2}
                      className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/50" />
                    <div className="flex flex-wrap gap-2">
                      <select id="quest-create-objective-type" name="objectiveType" value={cType} onChange={(e) => setCType(e.target.value)}
                        aria-label="Objective type"
                        className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/50">
                        <option value="gather">Gather</option>
                        <option value="kill">Defeat</option>
                        <option value="talk_to">Talk to</option>
                        <option value="deliver">Deliver</option>
                        <option value="reach_location">Reach</option>
                        <option value="interact">Interact</option>
                        <option value="observe">Observe</option>
                      </select>
                      <input id="quest-create-objective-target" name="objectiveTarget" value={cTarget} onChange={(e) => setCTarget(e.target.value)} maxLength={120}
                        aria-label="Objective target" placeholder="Target (e.g. ember herb, gate warden)"
                        className="min-w-[180px] flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/50" />
                      <input id="quest-create-objective-count" name="objectiveCount" type="number" min={1} max={100} value={cCount} onChange={(e) => setCCount(e.target.value)}
                        aria-label="Objective count"
                        className="w-24 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/50" />
                      <input id="quest-create-reward-xp" name="rewardXp" type="number" min={0} max={500} value={cXp} onChange={(e) => setCXp(e.target.value)}
                        aria-label="Reward XP"
                        className="w-24 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/50" />
                    </div>
                    <p className="text-[11px] text-slate-500">Objective count is how many the target needs; reward XP is paid on completion (0–500).</p>
                    <div className="flex gap-2">
                      <button onClick={handleCreate} disabled={creating || !cTitle.trim() || !cTarget.trim()} className="flex min-h-11 items-center rounded-md bg-amber-500/20 px-3 py-1.5 text-[12px] font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-40">
                        {creating ? 'Posting…' : 'Post quest'}
                      </button>
                      <button onClick={() => setShowCreate(false)} className="flex min-h-11 items-center rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-white/5">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {state === 'loading' ? (
            <ul className="space-y-3" role="status" aria-busy="true" aria-label="Loading quests">
              {[0, 1, 2].map((i) => <li key={i} className="h-16 animate-pulse rounded-xl border border-amber-500/15 bg-amber-500/5" />)}
            </ul>
          ) : state === 'error' ? (
            <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p className="text-sm font-medium text-rose-200">Couldn&apos;t load your quests</p>
              <p className="text-[12px] text-slate-400">{errMsg}</p>
              <button onClick={refresh} className="mt-1 flex min-h-11 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-200 hover:bg-amber-500/20">
                <RefreshCcw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
              <ScrollText className="h-7 w-7 text-amber-400/50" />
              <p className="text-[13px] font-medium text-slate-300">
                {tab === 'active' ? 'No active quests' : tab === 'completed' ? 'No completed quests yet' : 'No quests available'}
              </p>
              <p className="text-[12px] text-slate-400">
                {tab === 'active'
                  ? 'Accept a quest from the Available tab — or talk to an NPC in the world — and it will appear here with its objectives.'
                  : tab === 'completed'
                    ? 'Finish a quest and it will move here.'
                    : 'No offers right now. Post one above, or check back when an NPC has work for you.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((q) => (
                <li key={q.id} className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-amber-100">{q.title || q.id}</h2>
                      {q.description && <p className="mt-0.5 text-[11px] text-amber-200/80">{q.description}</p>}
                    </div>
                    {tab === 'available' && (
                      <button onClick={() => handleAccept(q.id)} disabled={busy === `accept-${q.id}`} aria-label={`Accept ${q.title || q.id}`} className="flex min-h-11 shrink-0 items-center gap-1 rounded bg-amber-500/20 px-3 text-[10px] text-amber-200 hover:bg-amber-500/30 disabled:opacity-40">
                        <ScrollText className="h-3 w-3" />
                        Accept
                      </button>
                    )}
                    {tab === 'active' && partyId && (
                      <button onClick={() => handleShare(q.id)} disabled={busy === `share-${q.id}`} aria-label={`Share ${q.title || q.id} with party`} className="flex min-h-11 shrink-0 items-center gap-1 rounded bg-cyan-500/20 px-3 text-[10px] text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40">
                        <Users2 className="h-3 w-3" />
                        Share
                      </button>
                    )}
                    {tab === 'completed' && q.status === 'completed' && (
                      <button onClick={() => handleClaim(q.id)} disabled={busy === `claim-${q.id}`} aria-label={`Claim rewards for ${q.title || q.id}`} className="flex min-h-11 shrink-0 items-center gap-1 rounded bg-yellow-500/20 px-3 text-[10px] text-yellow-200 hover:bg-yellow-500/30 disabled:opacity-40">
                        <Gift className="h-3 w-3" />
                        Claim
                      </button>
                    )}
                    {tab === 'completed' && q.status === 'rewarded' && (
                      <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                        <Check className="h-3 w-3" />
                        Claimed
                      </span>
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
      </NorthStarFrame>
    </LensShell>
  );
}
