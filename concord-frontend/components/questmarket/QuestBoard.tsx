/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Coins, Swords, Target, Search, Plus, Loader2, Tag, Filter,
  CheckCircle2, Clock, X,
} from 'lucide-react';

interface Quest {
  id: string;
  kind: 'quest' | 'bounty';
  title: string;
  description: string;
  reward: number;
  difficulty: string;
  tags: string[];
  maxClaimants: number;
  poster: string;
  status: string;
  claimCount: number;
  myClaimStatus: string | null;
  myClaimId: string | null;
  guildId: string | null;
  createdAt: string;
}

const DIFF_COLOR: Record<string, string> = {
  easy: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  medium: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
  hard: 'text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10',
  legendary: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
};
const STATUS_COLOR: Record<string, string> = {
  open: 'text-emerald-300',
  in_progress: 'text-sky-300',
  resolved: 'text-zinc-400',
  cancelled: 'text-red-300',
};

export function QuestBoard({
  kind,
  guildId,
  onChanged,
}: {
  kind: 'quest' | 'bounty';
  guildId?: string;
  onChanged?: () => void;
}) {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState('');
  const [minReward, setMinReward] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('recent');
  const [mine, setMine] = useState(false);

  const [showPost, setShowPost] = useState(false);
  const [pTitle, setPTitle] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pReward, setPReward] = useState('');
  const [pDiff, setPDiff] = useState('medium');
  const [pTags, setPTags] = useState('');
  const [pMax, setPMax] = useState('1');

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, unknown> = { kind, sort };
    if (search) params.search = search;
    if (difficulty) params.difficulty = difficulty;
    if (status) params.status = status;
    if (minReward) params.minReward = Number(minReward);
    if (tag) params.tag = tag;
    if (mine) params.mine = true;
    if (guildId) params.guildId = guildId;
    const r = await lensRun<any>('questmarket', 'listQuests', params);
    if (r.data?.ok && r.data.result) {
      setQuests(r.data.result.quests || []);
      setAllTags(r.data.result.allTags || []);
      setErr(null);
    } else {
      setErr(r.data?.error || 'failed to load');
    }
    setLoading(false);
  }, [kind, sort, search, difficulty, status, minReward, tag, mine, guildId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [kind, sort, difficulty, status, minReward, tag, mine, guildId]);

  const post = async () => {
    if (!pTitle.trim()) return;
    setBusy('post');
    const r = await lensRun<any>('questmarket', 'postQuest', {
      title: pTitle.trim(),
      description: pDesc.trim(),
      kind,
      reward: Number(pReward) || 0,
      difficulty: pDiff,
      tags: pTags.split(',').map((t) => t.trim()).filter(Boolean),
      maxClaimants: Number(pMax) || 1,
      guildId: guildId || undefined,
    });
    setBusy(null);
    if (r.data?.ok) {
      setShowPost(false);
      setPTitle(''); setPDesc(''); setPReward(''); setPTags(''); setPMax('1');
      load();
      onChanged?.();
    } else {
      setErr(r.data?.error || 'post failed');
    }
  };

  const accept = async (q: Quest) => {
    setBusy(q.id);
    const r = await lensRun<any>('questmarket', 'acceptQuest', { questId: q.id });
    setBusy(null);
    if (r.data?.ok) { load(); onChanged?.(); }
    else setErr(r.data?.error || 'accept failed');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full rounded border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-2 text-xs text-white"
            placeholder={`Search ${kind === 'bounty' ? 'bounties' : 'quests'}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
        </div>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          <option value="">All difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
          <option value="legendary">Legendary</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          <option value="">All status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="number" value={minReward} onChange={(e) => setMinReward(e.target.value)}
          placeholder="Min CC"
          className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          <option value="recent">Recent</option>
          <option value="reward">Reward</option>
          <option value="difficulty">Difficulty</option>
        </select>
        <button onClick={() => setMine(!mine)}
          className={`flex items-center gap-1 rounded border px-2 py-1.5 text-xs ${
            mine ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-zinc-800 bg-zinc-950 text-zinc-400'}`}>
          <Filter className="h-3 w-3" /> Mine
        </button>
        <button onClick={() => setShowPost(true)}
          className="flex items-center gap-1 rounded bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30">
          <Plus className="h-3.5 w-3.5" /> Post {kind === 'bounty' ? 'Bounty' : 'Quest'}
        </button>
      </div>

      {err && (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : quests.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-10 text-center text-xs text-zinc-500">
          No {kind === 'bounty' ? 'bounties' : 'quests'} match. Post one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {quests.map((q) => {
            const dc = DIFF_COLOR[q.difficulty] || DIFF_COLOR.medium;
            return (
              <div key={q.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 hover:border-zinc-700">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {q.kind === 'bounty'
                        ? <Target className="h-4 w-4 shrink-0 text-amber-400" />
                        : <Swords className="h-4 w-4 shrink-0 text-fuchsia-400" />}
                      <span className="truncate text-sm font-medium text-white">{q.title}</span>
                    </div>
                    {q.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{q.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className={`rounded-full border px-1.5 py-0.5 ${dc}`}>{q.difficulty}</span>
                      <span className={`rounded-full bg-zinc-800 px-1.5 py-0.5 ${STATUS_COLOR[q.status] || 'text-zinc-400'}`}>
                        {q.status.replace('_', ' ')}
                      </span>
                      <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                        {q.claimCount}/{q.maxClaimants} claimed
                      </span>
                      {q.tags.map((t) => (
                        <span key={t} className="flex items-center gap-0.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                          <Tag className="h-2.5 w-2.5" />{t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {q.reward > 0 && (
                      <span className="flex items-center gap-1 text-sm font-bold text-amber-300">
                        <Coins className="h-3.5 w-3.5" />{q.reward}
                      </span>
                    )}
                    {q.myClaimStatus ? (
                      <span className="flex items-center gap-1 rounded bg-sky-500/15 px-2 py-1 text-[10px] text-sky-300">
                        <CheckCircle2 className="h-3 w-3" /> claim {q.myClaimStatus}
                      </span>
                    ) : (q.status === 'open' || q.status === 'in_progress') ? (
                      <button onClick={() => accept(q)} disabled={busy === q.id}
                        className="rounded bg-amber-500/20 px-3 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
                        {busy === q.id ? '…' : 'Accept'}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                        <Clock className="h-3 w-3" /> closed
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-zinc-800/60 pt-2 text-[10px] text-zinc-600">
                  <span>by {q.poster}</span>
                  <span className="flex items-center gap-2">
                    <span>{new Date(q.createdAt).toLocaleDateString()}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowPost(false)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Post {kind === 'bounty' ? 'Bounty' : 'Quest'}
              </h3>
              <button onClick={() => setShowPost(false)} aria-label="Close">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            </div>
            <div className="space-y-3">
              <input value={pTitle} onChange={(e) => setPTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
              <textarea value={pDesc} onChange={(e) => setPDesc(e.target.value)}
                placeholder="Description" rows={3}
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-500">Reward (CC, escrowed)</label>
                  <input type="number" value={pReward} onChange={(e) => setPReward(e.target.value)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500">Difficulty</label>
                  <select value={pDiff} onChange={(e) => setPDiff(e.target.value)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white">
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                    <option value="legendary">Legendary</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-500">Tags (comma-sep)</label>
                  <input value={pTags} onChange={(e) => setPTags(e.target.value)}
                    placeholder="code, combat"
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500">Max claimants</label>
                  <input type="number" value={pMax} onChange={(e) => setPMax(e.target.value)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
                </div>
              </div>
              {Number(pReward) > 0 && (
                <p className="text-[10px] text-amber-400/80">
                  {pReward} CC will be locked in escrow and released to the verified claimant.
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowPost(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300">
                Cancel
              </button>
              <button onClick={post} disabled={!pTitle.trim() || busy === 'post'}
                className="rounded bg-amber-500/20 px-4 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
                {busy === 'post' ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
