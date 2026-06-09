'use client';

/**
 * DebateTree — Kialo 2026-shape argument tree: a thesis at the root
 * with recursively-nested pro / con claims, impact voting, and a live
 * support score. Wires the debate.debate-* and debate.claim-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Scale, Plus, Trash2, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Claim { id: string; parentId: string | null; stance: string; text: string; weight: number; voteCount: number }
interface Score { proTotal: number; conTotal: number; supportPct: number; verdict: string }
interface Debate { id: string; thesis: string; claims: Claim[] }
interface DebateMeta { id: string; thesis: string; claimCount: number; score: Score }

export function DebateTree() {
  const [debates, setDebates] = useState<DebateMeta[]>([]);
  const [active, setActive] = useState<Debate | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [loading, setLoading] = useState(true);
  const [newThesis, setNewThesis] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('debate', 'debate-list', {});
    setDebates((r.data?.result?.debates as DebateMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('debate', 'debate-detail', { id });
    if (r.data?.ok) { setActive(r.data.result?.debate as Debate); setScore(r.data.result?.score as Score); }
  }, []);
  async function reload() { if (active) await open(active.id); }

  async function create() {
    if (newThesis.trim().length < 8) return;
    const r = await lensRun('debate', 'debate-create', { thesis: newThesis.trim() });
    setNewThesis('');
    await refresh();
    if (r.data?.ok) await open(r.data.result?.debate.id);
  }
  async function del(id: string) {
    if (!confirm('Delete this debate?')) return;
    await lensRun('debate', 'debate-delete', { id });
    if (active?.id === id) { setActive(null); setScore(null); }
    await refresh();
  }
  async function addClaim(parentId: string | null, stance: 'pro' | 'con', text: string) {
    if (!active || text.trim().length < 4) return;
    await lensRun('debate', 'claim-add', { debateId: active.id, parentId, stance, text: text.trim() });
    await reload(); await refresh();
  }
  async function vote(claimId: string, weight: number) {
    if (!active) return;
    await lensRun('debate', 'claim-vote', { debateId: active.id, claimId, weight });
    await reload(); await refresh();
  }
  async function deleteClaim(claimId: string) {
    if (!active) return;
    await lensRun('debate', 'claim-delete', { debateId: active.id, claimId });
    await reload(); await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Scale className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-white">Argument Trees</h3>
        <span className="text-[11px] text-gray-400">Kialo shape</span>
      </div>

      <div className="flex gap-1.5 mb-3">
        <input value={newThesis} onChange={e => setNewThesis(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }}
          placeholder="State a thesis to debate…"
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1.5 text-sm text-white" />
        <button onClick={create} disabled={newThesis.trim().length < 8}
          className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40">New debate</button>
      </div>

      <div className="grid sm:grid-cols-[220px_1fr] gap-3">
        <ul className="space-y-1">
          {debates.length === 0 && <li className="text-[11px] text-gray-400 italic">No debates yet.</li>}
          {debates.map(d => (
            <li key={d.id} className="group flex items-center gap-1">
              <button onClick={() => open(d.id)}
                className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active?.id === d.id ? 'bg-cyan-600/15 border-cyan-700/50' : 'bg-black/30 border-white/10 hover:border-white/20')}>
                <p className="text-xs font-semibold text-white line-clamp-2">{d.thesis}</p>
                <p className="text-[10px] text-gray-400">{d.claimCount} claims · {d.score.supportPct}% for</p>
              </button>
              <button aria-label="Delete" onClick={() => del(d.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>

        {active ? (
          <div className="bg-black/30 border border-white/10 rounded-lg p-3">
            <div className="flex items-start gap-2 mb-2">
              <p className="text-sm font-bold text-white flex-1">{active.thesis}</p>
              {score && (
                <div className="text-right shrink-0">
                  <p className={cn('text-lg font-bold',
                    score.supportPct >= 65 ? 'text-emerald-400' : score.supportPct >= 50 ? 'text-cyan-400' : score.supportPct >= 35 ? 'text-amber-400' : 'text-rose-400')}>
                    {score.supportPct}%
                  </p>
                  <p className="text-[9px] text-gray-400 capitalize">{score.verdict.replace(/-/g, ' ')}</p>
                </div>
              )}
            </div>
            {score && (
              <div className="flex h-1.5 rounded overflow-hidden mb-3">
                <div className="bg-emerald-500" style={{ width: `${score.supportPct}%` }} />
                <div className="bg-rose-500" style={{ width: `${100 - score.supportPct}%` }} />
              </div>
            )}
            <ClaimChildren claims={active.claims} parentId={null} depth={0} onAdd={addClaim} onVote={vote} onDelete={deleteClaim} />
          </div>
        ) : (
          <div className="bg-black/20 border border-dashed border-white/10 rounded-lg flex items-center justify-center text-xs text-gray-400 min-h-[160px]">
            Select or create a debate.
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimChildren({ claims, parentId, depth, onAdd, onVote, onDelete }: {
  claims: Claim[]; parentId: string | null; depth: number;
  onAdd: (parentId: string | null, stance: 'pro' | 'con', text: string) => void;
  onVote: (claimId: string, weight: number) => void;
  onDelete: (claimId: string) => void;
}) {
  const kids = claims.filter(c => c.parentId === parentId);
  const [draft, setDraft] = useState('');
  const [stance, setStance] = useState<'pro' | 'con'>('pro');
  return (
    <div className={cn(depth > 0 && 'pl-3 border-l border-white/10 ml-1')}>
      {kids.map(c => (
        <div key={c.id} className="mb-1.5">
          <div className={cn('group rounded px-2 py-1.5 border-l-2',
            c.stance === 'pro' ? 'bg-emerald-950/20 border-emerald-600' : 'bg-rose-950/20 border-rose-600')}>
            <div className="flex items-start gap-2">
              <span className={cn('text-[9px] font-bold uppercase mt-0.5', c.stance === 'pro' ? 'text-emerald-400' : 'text-rose-400')}>
                {c.stance}
              </span>
              <p className="text-xs text-gray-200 flex-1">{c.text}</p>
              <span className="text-[10px] text-gray-400 shrink-0">{c.weight.toFixed(1)}</span>
              <button aria-label="Thumbs up" onClick={() => onVote(c.id, 5)} className="text-gray-600 hover:text-emerald-400"><ThumbsUp className="w-3 h-3" /></button>
              <button aria-label="Thumbs down" onClick={() => onVote(c.id, 1)} className="text-gray-600 hover:text-rose-400"><ThumbsDown className="w-3 h-3" /></button>
              <button aria-label="Delete" onClick={() => onDelete(c.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
          <ClaimChildren claims={claims} parentId={c.id} depth={depth + 1} onAdd={onAdd} onVote={onVote} onDelete={onDelete} />
        </div>
      ))}
      <div className="flex gap-1 mt-1">
        <select value={stance} onChange={e => setStance(e.target.value as 'pro' | 'con')}
          className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-[10px] text-white">
          <option value="pro">Pro</option>
          <option value="con">Con</option>
        </select>
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && draft.trim().length >= 4) { onAdd(parentId, stance, draft); setDraft(''); } }}
          placeholder={depth === 0 ? 'Add a claim…' : 'Add a counter-claim…'}
          className="flex-1 bg-black/40 border border-white/15 rounded px-1.5 py-0.5 text-[11px] text-white" />
        <button aria-label="Add" onClick={() => { if (draft.trim().length >= 4) { onAdd(parentId, stance, draft); setDraft(''); } }}
          className="px-1.5 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white"><Plus className="w-3 h-3" /></button>
      </div>
    </div>
  );
}
